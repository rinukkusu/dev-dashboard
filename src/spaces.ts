// Which herdr spaces and agents belong to a ticket or PR. Pure functions without the socket client,
// so the web app can use them too.
import type { Agent, Issue, PullRequest, Space } from "./model.ts";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The spaces of a ticket (its key in the space name) or a PR (one of its ticket keys, or its own ref
 * like "!25233" or "app#12" in the name – that's how spaces started for a PR are named).
 */
export function spacesOf(spaces: Space[], keys: string[], prRef?: string): Space[] {
  const ref = prRef && new RegExp(`(^|[^\\w])${escapeRe(prRef)}(?!\\w)`);
  return spaces.filter((s) => s.ticketKeys.some((k) => keys.includes(k)) || (ref && ref.test(s.label)));
}

/**
 * The spaces of a ticket or PR: Jira tickets by their key in the space name, PRs by their ticket
 * keys or their ref, other issues (GitLab, GitHub) by their ref ("app#7").
 */
export function spacesForItem(spaces: Space[], item: { kind: "ticket"; issue: Issue } | { kind: "pr"; pr: PullRequest }): Space[] {
  if (item.kind === "pr") return spacesOf(spaces, item.pr.ticketKeys, item.pr.ref);
  return item.issue.source === "jira" ? spacesOf(spaces, [item.issue.ref]) : spacesOf(spaces, [], item.issue.ref);
}

/** The agent to talk to in a space: a Claude if there is one, otherwise the most urgent. */
export const agentOf = (s: Space) => s.agents.find((a) => /claude/i.test(a.kind ?? "")) ?? s.agents[0];

/**
 * Where comments on a ticket/PR go when its spaces have several agents (one per tab, say):
 * 1. sticky – the pane the last ones went to, while it still hosts an agent
 * 2. an agent in the tab last shown in its space
 * 3. the agent that did something most recently (herdr's state_change_seq)
 * Claudes first – only their answers can be read back from a transcript.
 */
export function pickAgent(spaces: Space[], sticky?: string): { space: Space; agent: Agent } | undefined {
  const all = spaces.flatMap((space) => space.agents.map((agent) => ({ space, agent })));
  if (!all.length) return undefined;
  const pinned = sticky && all.find((x) => x.agent.paneId === sticky);
  if (pinned) return pinned;
  const claudes = all.filter((x) => /claude/i.test(x.agent.kind ?? ""));
  const pool = claudes.length ? claudes : all;
  const active = pool.filter((x) => x.space.activeTabId && x.agent.tabId === x.space.activeTabId);
  const recent = (xs: typeof pool) => [...xs].sort((a, b) => (b.agent.seq ?? -1) - (a.agent.seq ?? -1))[0];
  return recent(active) ?? recent(pool);
}

