import type { JiraConfig } from "../config.ts";
import { getJson, iso, mapLimit, message, preview } from "../http.ts";
import type { BoardColumn, Comment, Issue, StatusCategory } from "../model.ts";
import { pathBelow, type FetchContext, type FetchResult, type Source } from "./types.ts";

// Jira Data Center REST API v2. For Jira Cloud you'd swap auth (Basic email:token),
// the endpoint (/rest/api/3/search/jql + nextPageToken) and parse ADF comment bodies.

type RawUser = { name: string; key?: string; displayName: string };

type RawComment = { id: string; author?: RawUser; body: string; created: string };

type RawIssue = {
  key: string;
  fields: {
    summary: string;
    updated: string;
    issuetype?: { name: string };
    status: { id?: string; name: string; statusCategory?: { key: string } };
    assignee?: RawUser | null;
    comment?: { comments: RawComment[] };
    [custom: string]: unknown;
  };
};

type RawHistory = { author?: RawUser; created: string; items: { field: string }[] };

type SearchResult = { startAt: number; maxResults: number; total: number; issues: RawIssue[] };

type RawBoard = { id: number; name: string; type: string };
type RawBoardConfig = { columnConfig: { columns: { name: string; statuses: { id: string }[] }[] } };
type RawField = { id: string; name: string };

/** Board columns and the story points field change rarely – ask again after a few hours. */
type Memo = {
  board?: { at: string; key: string; columns: BoardColumn[] };
  pointsField?: { at: string; id: string | null };
};
const BOARD_TTL_MS = 6 * 3_600_000;

const FIELDS = "summary,status,assignee,updated,issuetype,comment";
const PAGE_SIZE = 50;
/** Jira Server/DC calls it "Story Points", team-managed projects "Story point estimate". */
const POINTS_FIELD_NAME = /^story points?( estimate)?$/i;

/** Strips the noisiest bits of Jira wiki markup for a one-line preview. */
const cleanWiki = (s: string) =>
  preview(
    s
      .replace(/\[~([^\]]+)\]/g, "@$1") // mentions
      .replace(/\{(code|noformat|quote|color)[^}]*\}/g, " ") // block macros
      .replace(/!\S+?!/g, "[image]") // embedded images
      .replace(/\{\{(.+?)\}\}/g, "$1") // monospace
      .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, "$1$2") // bold
      .replace(/\[([^|\]]+)\|[^\]]+\]/g, "$1"), // [text|link]
  );

const toCategory = (key?: string): StatusCategory =>
  key === "done" ? "done" : key === "new" ? "new" : "indeterminate";

export function createJiraSource(cfg: JiraConfig): Source {
  const headers = { Authorization: `Bearer ${cfg.pat}` };
  const get = <T>(path: string) => getJson<T>(`${cfg.baseUrl}${path}`, headers);
  const sameUser = (me: RawUser, u?: RawUser | null) =>
    !!u && (u.name === me.name || (!!u.key && u.key === me.key));

  /** Set per fetch once the story points field is known. */
  let pointsField: string | undefined;

  async function search(jql: string, me: RawUser, scope: Issue["scope"]): Promise<Issue[]> {
    const out: Issue[] = [];
    for (let startAt = 0; ; startAt += PAGE_SIZE) {
      const q = new URLSearchParams({
        jql,
        startAt: String(startAt),
        maxResults: String(PAGE_SIZE),
        fields: pointsField ? `${FIELDS},${pointsField}` : FIELDS,
        validateQuery: "false", // unknown keys in "key in (...)" → warning instead of 400
      });
      const page = await get<SearchResult>(`/rest/api/2/search?${q}`);
      out.push(...page.issues.map((i) => mapIssue(i, me, scope)));
      if (page.issues.length === 0 || startAt + page.issues.length >= page.total) break;
    }
    return out;
  }

  function mapIssue(i: RawIssue, me: RawUser, scope: Issue["scope"]): Issue {
    const comments: Comment[] = (i.fields.comment?.comments ?? []).map((c) => ({
      id: c.id,
      author: c.author?.displayName ?? "Unknown",
      authorIsMe: sameUser(me, c.author),
      text: cleanWiki(c.body),
      wiki: c.body,
      at: iso(c.created),
    }));
    const points = pointsField ? i.fields[pointsField] : undefined;
    return {
      id: `jira:${i.key}`,
      source: "jira",
      ref: i.key,
      url: `${cfg.baseUrl}/browse/${i.key}`,
      title: i.fields.summary,
      type: i.fields.issuetype?.name ?? "",
      status: i.fields.status.name,
      statusId: i.fields.status.id,
      statusCategory: toCategory(i.fields.status.statusCategory?.key),
      assignee: i.fields.assignee?.displayName,
      points: typeof points === "number" ? points : undefined,
      updatedAt: iso(i.fields.updated),
      comments,
      scope,
    };
  }

  /** Was the latest change to one of these fields made by me? One request, only for issues that changed. */
  async function latestChangeIsMine(key: string, fields: string[], me: RawUser): Promise<boolean> {
    const r = await get<{ changelog?: { histories: RawHistory[] } }>(
      `/rest/api/2/issue/${encodeURIComponent(key)}?fields=status&expand=changelog`,
    );
    const latest = (r.changelog?.histories ?? [])
      .filter((h) => h.items.some((it) => fields.includes(it.field.toLowerCase())))
      .sort((a, b) => Date.parse(iso(b.created)) - Date.parse(iso(a.created)))[0];
    return !!latest && sameUser(me, latest.author);
  }

  /**
   * Columns of the board(s) the sprint tickets are on, in board order (Jira Software agile API).
   * Boards come from JIRA_BOARD_IDS or, if unset, the first board of each project in the list.
   * Without Jira Software (or access) there's simply no board and the page sorts by status category.
   */
  async function boardColumns(projectKeys: string[]): Promise<BoardColumn[] | undefined> {
    let ids = cfg.boardIds;
    if (!ids.length) {
      const found = await mapLimit(projectKeys.slice(0, 5), 3, async (key) => {
        const r = await get<{ values: RawBoard[] }>(`/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(key)}&maxResults=20`);
        // the scrum board is the one with the sprint; fall back to whatever there is
        return (r.values.find((b) => b.type === "scrum") ?? r.values[0])?.id;
      });
      ids = [...new Set(found.filter((id): id is number => id !== undefined).map(String))];
    }
    if (!ids.length) return undefined;

    // Several boards: keep the first board's order, add columns the others have at the end.
    const columns: BoardColumn[] = [];
    for (const id of ids) {
      const config = await get<RawBoardConfig>(`/rest/agile/1.0/board/${id}/configuration`);
      for (const c of config.columnConfig.columns) {
        const statusIds = c.statuses.map((s) => s.id);
        const same = columns.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
        if (same) same.statusIds = [...new Set([...same.statusIds, ...statusIds])];
        else columns.push({ name: c.name, statusIds });
      }
    }
    return columns.filter((c) => c.statusIds.length);
  }

  /** JIRA_STORY_POINTS_FIELD, or the custom field named "Story Points" (cached). */
  async function findPointsField(memo: Memo, now: number): Promise<string | undefined> {
    if (cfg.storyPointsField.toLowerCase() === "off") return undefined;
    if (cfg.storyPointsField) return cfg.storyPointsField;
    const cached = memo.pointsField;
    if (cached && now - Date.parse(cached.at) <= BOARD_TTL_MS) return cached.id ?? undefined;
    let id: string | null = null;
    try {
      const fields = await get<RawField[]>("/rest/api/2/field");
      id = fields.find((f) => f.id.startsWith("customfield_") && POINTS_FIELD_NAME.test(f.name.trim()))?.id ?? null;
    } catch {
      // no points then, try again later
    }
    memo.pointsField = { at: new Date(now).toISOString(), id };
    return id ?? undefined;
  }

  async function fetchIssues(ctx: FetchContext): Promise<FetchResult> {
    const me = await get<RawUser>("/rest/api/2/myself");
    const warnings: string[] = [];
    const memo: Memo = { ...(ctx.memo as Memo | undefined) };
    pointsField = await findPointsField(memo, ctx.now);
    const issues = await search(cfg.jql, me, "list");
    const known = () => new Set(issues.map((i) => i.ref));

    if (cfg.involvedJql) {
      const k = known();
      issues.push(...(await search(cfg.involvedJql, me, "involved")).filter((i) => !k.has(i.ref)));
    }

    // By key: watched by hand, then referenced by PRs. A bogus key in a branch name must not break the rest.
    const byKey = async (keys: string[], scope: Issue["scope"]) => {
      const k = known();
      const missing = [...new Set(keys)].filter((key) => !k.has(key));
      if (!missing.length) return;
      try {
        issues.push(...(await search(`key in (${missing.join(",")})`, me, scope)));
      } catch (e) {
        if (scope === "watched") warnings.push(message(e));
      }
    };
    await byKey(ctx.watches.flatMap((w) => w.locator.key ?? []), "watched");
    await byKey(ctx.ticketKeys, "linked");

    // Notifications are about what others did. For issues that changed, ask who did it.
    if (ctx.prev) {
      const prev = new Map(ctx.prev.issues.map((i) => [i.id, i]));
      const toCheck = issues.flatMap((i) => {
        const old = prev.get(i.id);
        if (old && old.status !== i.status) return [{ i, fields: ["status"] }];
        if ((i.scope === "list") !== (old?.scope === "list")) return [{ i, fields: ["assignee", "sprint"] }];
        return [];
      });
      await mapLimit(toCheck, 4, async ({ i, fields }) => {
        try {
          i.lastChangeByMe = await latestChangeIsMine(i.ref, fields, me);
        } catch {
          // unknown → treat it as someone else's change
        }
      });
    }
    // Board columns for the kanban, cached; projects changing (new sprint, other board) refreshes them.
    const projects = [...new Set(issues.filter((i) => i.scope === "list").map((i) => i.ref.split("-")[0]!))].sort();
    const key = cfg.boardIds.length ? `ids:${cfg.boardIds.join(",")}` : `projects:${projects.join(",")}`;
    const cached = memo.board;
    if (!cached || cached.key !== key || ctx.now - Date.parse(cached.at) > BOARD_TTL_MS) {
      try {
        const columns = await boardColumns(projects);
        memo.board = { at: new Date(ctx.now).toISOString(), key, columns: columns ?? [] };
      } catch {
        // no Jira Software / no permission: sort by status category instead, try again later
        memo.board = { at: new Date(ctx.now).toISOString(), key, columns: [] };
      }
    }
    const board = memo.board?.columns.length ? memo.board.columns : undefined;
    return { issues, board, memo, warnings };
  }

  return {
    id: "jira",
    label: "Jira",
    needsTicketKeys: true,
    fetch: fetchIssues,
    parseWatchUrl(url) {
      const key = pathBelow(url, cfg.baseUrl)?.match(/^\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)\/?$/)?.[1]?.toUpperCase();
      return key ? { id: `jira:${key}`, kind: "issue", locator: { key } } : undefined;
    },
  };
}
