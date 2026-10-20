import type { Issue, PullRequest } from "./model.ts";

export type KeyExtractor = (text: string) => string[];

/**
 * Finds Jira keys in free text (PR title, branch, description).
 * With project keys configured only those match, so "UTF-8" or "ISO-8859" don't.
 */
export function makeKeyExtractor(projectKeys: string[]): KeyExtractor {
  const prefix = projectKeys.length ? `(?:${projectKeys.join("|")})` : "[A-Z][A-Z0-9]+";
  // Branch names are often lower-case (feature/abc-123-foo), hence the i flag.
  const re = new RegExp(`(?<![A-Za-z0-9])${prefix}-\\d+(?!\\d)`, "gi");
  return (text) => [...new Set((text.match(re) ?? []).map((k) => k.toUpperCase()))];
}

export type Links = {
  /** Jira key → PRs that mention it */
  prsByTicket: Map<string, PullRequest[]>;
  /** Jira key → Jira issue */
  issueByTicket: Map<string, Issue>;
};

export function link(prs: PullRequest[], issues: Issue[]): Links {
  const prsByTicket = new Map<string, PullRequest[]>();
  for (const pr of prs) {
    for (const key of pr.ticketKeys) {
      prsByTicket.set(key, [...(prsByTicket.get(key) ?? []), pr]);
    }
  }
  const jira = issues.filter((i) => i.source === "jira");
  return { prsByTicket, issueByTicket: new Map(jira.map((i) => [i.ref, i])) };
}
