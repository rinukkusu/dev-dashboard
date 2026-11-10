import type { Links } from "./correlate.ts";
import type { Hint, HintLevel, Snapshot } from "./model.ts";

export type RuleContext = Links & {
  /** lower-case status names that are fine for a ticket whose PR is merged */
  postMergeStatuses: string[];
  now: number;
};

/** A rule looks at the current state and says what deserves attention. Add your own here. */
export type Rule = (s: Snapshot, ctx: RuleContext) => Hint[];

const FEEDBACK_DAYS = 7;
const RUN_FAILED_HOURS = 24;
const isApproval = (v: string) => v === "approved" || v === "approvedWithSuggestions";

// --- PRs I authored ----------------------------------------------------------

const myActivePrs = (s: Snapshot) => s.prs.filter((p) => p.role === "author" && p.status === "active");

const prBlockedByReviewer: Rule = (s) =>
  myActivePrs(s).flatMap((p) =>
    p.reviewers
      .filter((r) => r.vote === "waiting" || r.vote === "rejected")
      .map((r) => ({
        level: "action" as const,
        reason: r.vote === "rejected" ? ("rejected" as const) : ("waiting" as const),
        resource: p.id,
        ref: p.ref,
        url: p.url,
        msg: r.vote === "rejected" ? (["reviewerRejected", r.name, p.title] as const) : (["reviewerWaiting", r.name, p.title] as const),
      })),
  );

const prOpenThreads: Rule = (s) =>
  myActivePrs(s)
    .filter((p) => p.openThreads > 0)
    .map((p) => ({ level: "action", reason: "threads", resource: p.id, ref: p.ref, url: p.url, msg: ["openThreads", p.openThreads, p.title] as const }));

const prConflicts: Rule = (s) =>
  myActivePrs(s)
    .filter((p) => p.hasConflicts)
    .map((p) => ({ level: "action", reason: "conflicts", resource: p.id, ref: p.ref, url: p.url, msg: ["conflicts", p.title] as const }));

const prChecksFailing: Rule = (s) =>
  myActivePrs(s)
    .filter((p) => p.checks === "failure")
    .map((p) => ({ level: "action", reason: "checks", resource: p.id, ref: p.ref, url: p.url, msg: ["checksFailing", p.title] as const }));

const prReadyToMerge: Rule = (s) =>
  myActivePrs(s)
    .filter((p) => !p.isDraft && !p.hasConflicts && p.openThreads === 0 && p.checks !== "failure" && p.checks !== "pending")
    .filter((p) => p.reviewers.some((r) => isApproval(r.vote)))
    .filter((p) => p.reviewers.every((r) => (r.required ? isApproval(r.vote) : r.vote !== "waiting" && r.vote !== "rejected")))
    .map((p) => ({ level: "ready", reason: "ready", resource: p.id, ref: p.ref, url: p.url, msg: ["readyToMerge", p.title] as const }));

// --- PRs where I'm a reviewer ------------------------------------------------

const reviewPending: Rule = (s) =>
  s.prs
    .filter((p) => p.role === "reviewer" && p.status === "active" && !p.isDraft)
    .filter((p) => p.reviewers.some((r) => r.isMe && r.vote === "none"))
    .map((p) => ({ level: "action", reason: "review", resource: p.id, ref: p.ref, url: p.url, msg: ["reviewRequested", p.author, p.title] as const }));

// --- Tickets -----------------------------------------------------------------

/**
 * PR is merged, nothing else open for the ticket, but the ticket still sits in an earlier column.
 * Only PRs that are for the ticket (key in title or branch) count – one that merely mentions it in
 * its description says nothing about where the ticket should be.
 */
const ticketToMove: Rule = (_, ctx) =>
  [...ctx.prsByTicket]
    .map(([key, prs]) => ({ issue: ctx.issueByTicket.get(key), prs: prs.filter((p) => (p.ownKeys ?? p.ticketKeys).includes(key)) }))
    .filter(({ prs }) => prs.length > 0)
    .filter(({ issue }) => issue && issue.statusCategory !== "done")
    .filter(({ issue }) => !ctx.postMergeStatuses.includes(issue!.status.toLowerCase()))
    .filter(({ prs }) => prs.some((p) => p.status === "completed") && !prs.some((p) => p.status === "active"))
    .map(({ issue, prs }) => ({
      level: "action" as const,
      reason: "move-ticket" as const,
      resource: issue!.id,
      ref: issue!.ref,
      url: issue!.url,
      msg: ["ticketToMove", prs.filter((p) => p.status === "completed").map((p) => p.ref), issue!.status] as const,
    }));

/**
 * Latest comment is from someone else and I haven't answered (e.g. test feedback) –
 * on my tickets, or anywhere I took part in the discussion.
 */
const unansweredFeedback: Rule = (s, ctx) =>
  s.issues
    .filter((i) => i.statusCategory !== "done")
    .filter((i) => i.scope === "list" || i.comments.some((c) => c.authorIsMe))
    .flatMap((i) => {
      const last = i.comments.at(-1);
      if (!last || last.authorIsMe) return [];
      if (ctx.now - Date.parse(last.at) > FEEDBACK_DAYS * 86_400_000) return [];
      return [{ level: "action" as const, reason: "feedback" as const, resource: i.id, ref: i.ref, url: i.url, msg: ["feedback", last.author, last.text] as const, comment: `issue:${i.id}:c:${last.id}` }];
    });

// --- CI runs -------------------------------------------------------------------

/** Failed recently and nothing newer for the same workflow + branch since. */
const runFailed: Rule = (s, ctx) => {
  const latest = new Map<string, (typeof s.runs)[number]>();
  for (const r of s.runs) {
    const key = `${r.source}|${r.repo}|${r.name}|${r.branch}`;
    const seen = latest.get(key);
    if (!seen || Date.parse(r.createdAt) > Date.parse(seen.createdAt)) latest.set(key, r);
  }
  return [...latest.values()]
    .filter((r) => r.status === "completed" && r.conclusion === "failure")
    .filter((r) => ctx.now - Date.parse(r.updatedAt) < RUN_FAILED_HOURS * 3_600_000)
    .map((r) => ({ level: "action", reason: "run-failed", resource: r.id, ref: r.ref, url: r.url, msg: ["runFailed", r.name, r.branch] as const }));
};

export const rules: Rule[] = [
  reviewPending,
  prBlockedByReviewer,
  prConflicts,
  prChecksFailing,
  runFailed,
  prOpenThreads,
  unansweredFeedback,
  ticketToMove,
  prReadyToMerge,
];

const ORDER: Record<HintLevel, number> = { action: 0, ready: 1, info: 2 };

export const evaluate = (s: Snapshot, ctx: RuleContext, all: Rule[] = rules): Hint[] =>
  all.flatMap((r) => r(s, ctx)).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
