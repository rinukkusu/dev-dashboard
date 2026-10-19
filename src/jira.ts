import type { JiraConfig } from "./config.ts";
import { getJson, iso, preview } from "./http.ts";
import type { Comment, Issue, StatusCategory } from "./model.ts";

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

type SearchResult = { startAt: number; maxResults: number; total: number; issues: RawIssue[] };

const FIELDS = "summary,status,assignee,updated,issuetype,comment";
const PAGE_SIZE = 50;

/** Strips the noisiest bits of Jira wiki markup for a one-line preview. */
const cleanWiki = (s: string) =>
  preview(
    s
      .replace(/\[~([^\]]+)\]/g, "@$1") // mentions
      .replace(/\{(code|noformat|quote|color)[^}]*\}/g, " ") // block macros
      .replace(/!\S+?!/g, "[Bild]") // embedded images
      .replace(/\{\{(.+?)\}\}/g, "$1") // monospace
      .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, "$1$2") // bold
      .replace(/\[([^|\]]+)\|[^\]]+\]/g, "$1"), // [text|link]
  );

const toCategory = (key?: string): StatusCategory =>
  key === "done" ? "done" : key === "new" ? "new" : "indeterminate";

export function createJiraClient(cfg: JiraConfig) {
  const headers = { Authorization: `Bearer ${cfg.pat}` };
  const get = <T>(path: string) => getJson<T>(`${cfg.baseUrl}${path}`, headers);

  async function search(jql: string, me: RawUser, inScope: boolean): Promise<Issue[]> {
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
      out.push(...page.issues.map((i) => mapIssue(i, me, inScope)));
      if (page.issues.length === 0 || startAt + page.issues.length >= page.total) break;
    }
    return out;
  }

  function mapIssue(i: RawIssue, me: RawUser, inScope: boolean): Issue {
    const isMe = (u?: RawUser | null) => !!u && (u.name === me.name || (!!u.key && u.key === me.key));
    const comments: Comment[] = (i.fields.comment?.comments ?? []).map((c) => ({
      id: c.id,
      author: c.author?.displayName ?? "Unbekannt",
      authorIsMe: isMe(c.author),
      text: cleanWiki(c.body),
      at: iso(c.created),
    }));
    return {
      key: i.key,
      url: `${cfg.baseUrl}/browse/${i.key}`,
      summary: i.fields.summary,
      type: i.fields.issuetype?.name ?? "",
      status: i.fields.status.name,
      statusCategory: toCategory(i.fields.status.statusCategory?.key),
      assignee: i.fields.assignee?.displayName,
      updatedAt: iso(i.fields.updated),
      comments,
      inScope,
    };
  }

  /** Issues from the main JQL plus any issues referenced by PRs but not in that result. */
  async function fetchIssues(referencedKeys: string[]): Promise<Issue[]> {
    const me = await get<RawUser>("/rest/api/2/myself");
    const scoped = await search(cfg.jql, me, true);

    const known = new Set(scoped.map((i) => i.key));
    const missing = [...new Set(referencedKeys)].filter((k) => !known.has(k));
    if (missing.length === 0) return scoped;

    try {
      const extra = await search(`key in (${missing.join(",")})`, me, false);
      return [...scoped, ...extra];
    } catch {
      // A bogus key in a branch name must not break the whole Jira part.
      return scoped;
    }
  }

  return { fetchIssues };
}
