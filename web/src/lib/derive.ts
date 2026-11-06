// What the pages show, derived from the view the server sends. Pure functions, so they're easy to test.
import { link, type Links } from "@shared/correlate.ts";
import type { AgentJob, Hint, HintLevel, Issue, PullRequest, Run, Space } from "@shared/model.ts";
import type { ViewData } from "@shared/view.ts";

export type Lists = {
  links: Links;
  hasCode: boolean;
  hasJira: boolean;
  mine: PullRequest[];
  reviews: PullRequest[];
  involvedPrs: PullRequest[];
  merged: PullRequest[];
  involvedIssues: Issue[];
  /** the sprint (Jira list) */
  tickets: Issue[];
  runs: Run[];
  spaces: Space[];
  /** badges of the menu: only what wants something from me */
  counts: { inbox: number; pendingReviews: number; runsActive: number; runFailed: boolean; agentsBlocked: number };
};

export function lists(v: ViewData): Lists {
  const s = v.snapshot;
  const now = Date.parse(s.takenAt);
  const muted = new Set(v.muted);
  const active = s.prs.filter((p) => p.status === "active");
  const reviews = active.filter((p) => p.role === "reviewer");
  const runs = s.runs
    .filter((r) => r.status !== "completed" || now - Date.parse(r.updatedAt) < v.runsKeepHours * 3_600_000)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const spaces = v.herdr?.spaces ?? [];
  return {
    links: link(s.prs, s.issues),
    hasCode: v.sources.some((id) => id !== "jira"),
    hasJira: v.sources.includes("jira"),
    mine: active.filter((p) => p.role === "author"),
    reviews,
    involvedPrs: s.prs.filter((p) => (p.role === "involved" && p.status === "active") || p.role === "watched"),
    merged: s.prs.filter((p) => p.role === "author" && p.status === "completed"),
    involvedIssues: s.issues.filter((i) => (i.scope === "involved" && i.statusCategory !== "done") || i.scope === "watched"),
    tickets: s.issues.filter((i) => i.scope === "list"),
    runs,
    spaces,
    counts: {
      inbox: inbox(v).length,
      pendingReviews: reviews.filter((p) => p.reviewers.some((r) => r.isMe && r.vote === "none") && !muted.has(p.id)).length,
      runsActive: runs.filter((r) => r.status !== "completed").length,
      runFailed: v.hints.some((h) => h.reason === "run-failed"),
      agentsBlocked: spaces.flatMap((sp) => sp.agents).filter((a) => a.status === "blocked").length,
    },
  };
}

// --- inbox -----------------------------------------------------------------------

export type InboxItem = {
  /** PR/issue/run id, or herdr:<space> */
  resource: string;
  kind: "pr" | "issue" | "run" | "space" | "other";
  ref: string;
  url: string;
  /** what the item is called; undefined when it's no longer in the snapshot */
  title?: string;
  /** the most urgent level of its hints */
  level: HintLevel;
  /** in the order the rules gave them, most urgent first */
  hints: Hint[];
  job?: AgentJob;
  /** the agent a hint is about, to open its chat */
  pane?: string;
  pr?: PullRequest;
  issue?: Issue;
  run?: Run;
  space?: Space;
};

const LEVEL_ORDER: Record<HintLevel, number> = { action: 0, ready: 1, info: 2 };

/**
 * The to-dos, one entry per PR/ticket/run/space instead of one per hint: a PR with failing checks,
 * an open thread and a reviewer waiting is one line with three reasons. Most urgent first; within a
 * level, in the order the rules list them (reviews for me first, see rules.ts).
 */
export function inbox(v: ViewData): InboxItem[] {
  const s = v.snapshot;
  const prs = new Map(s.prs.map((p) => [p.id, p]));
  const issues = new Map(s.issues.map((i) => [i.id, i]));
  const runs = new Map(s.runs.map((r) => [r.id, r]));
  const spaces = new Map((v.herdr?.spaces ?? []).map((sp) => [`herdr:${sp.id}`, sp]));
  const items = new Map<string, InboxItem>();
  for (const h of v.hints) {
    let item = items.get(h.resource);
    if (!item) {
      const pr = prs.get(h.resource);
      const issue = issues.get(h.resource);
      const run = runs.get(h.resource);
      const space = spaces.get(h.resource);
      item = {
        resource: h.resource,
        kind: pr ? "pr" : issue ? "issue" : run ? "run" : space ? "space" : "other",
        ref: h.ref,
        url: h.url,
        title: pr?.title ?? issue?.title ?? (run && `${run.name} · ${run.title}`) ?? space?.label,
        level: h.level,
        hints: [],
        pr,
        issue,
        run,
        space,
      };
      items.set(h.resource, item);
    }
    item.hints.push(h);
    if (LEVEL_ORDER[h.level] < LEVEL_ORDER[item.level]) item.level = h.level;
    item.job ??= h.job;
    item.pane ??= h.pane;
  }
  // an item sits where its most urgent hint is: by level, then where the rules listed that hint
  const position = new Map(v.hints.map((h, i) => [h, LEVEL_ORDER[h.level] * v.hints.length + i]));
  const rank = (item: InboxItem) => Math.min(...item.hints.map((h) => position.get(h)!));
  return [...items.values()]
    .sort((a, b) => rank(a) - rank(b))
    .map((item) => ({ ...item, hints: [...item.hints].sort((a, b) => position.get(a)! - position.get(b)!) }));
}
