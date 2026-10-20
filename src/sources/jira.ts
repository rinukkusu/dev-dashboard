import type { JiraConfig } from "../config.ts";
import { getJson, iso, mapLimit, message, preview } from "../http.ts";
import type { Comment, Issue, StatusCategory } from "../model.ts";
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
    status: { name: string; statusCategory?: { key: string } };
    assignee?: RawUser | null;
    comment?: { comments: RawComment[] };
  };
};

type RawHistory = { author?: RawUser; created: string; items: { field: string }[] };

type SearchResult = { startAt: number; maxResults: number; total: number; issues: RawIssue[] };

const FIELDS = "summary,status,assignee,updated,issuetype,comment";
const PAGE_SIZE = 50;

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

  async function search(jql: string, me: RawUser, scope: Issue["scope"]): Promise<Issue[]> {
    const out: Issue[] = [];
    for (let startAt = 0; ; startAt += PAGE_SIZE) {
      const q = new URLSearchParams({
        jql,
        startAt: String(startAt),
        maxResults: String(PAGE_SIZE),
        fields: FIELDS,
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
      at: iso(c.created),
    }));
    return {
      id: `jira:${i.key}`,
      source: "jira",
      ref: i.key,
      url: `${cfg.baseUrl}/browse/${i.key}`,
      title: i.fields.summary,
      type: i.fields.issuetype?.name ?? "",
      status: i.fields.status.name,
      statusCategory: toCategory(i.fields.status.statusCategory?.key),
      assignee: i.fields.assignee?.displayName,
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

  async function fetchIssues(ctx: FetchContext): Promise<FetchResult> {
    const me = await get<RawUser>("/rest/api/2/myself");
    const warnings: string[] = [];
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
    return { issues, warnings };
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
