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
const isApproval = (v: string) => v === "approved" || v === "approvedWithSuggestions";

// --- PRs I authored ----------------------------------------------------------

const prBlockedByReviewer: Rule = (s) =>
  s.prs
    .filter((p) => p.role === "author" && p.status === "active")
    .flatMap((p) =>
      p.reviewers
        .filter((r) => r.vote === "waiting" || r.vote === "rejected")
        .map((r) => ({
          level: "action" as const,
          ref: `!${p.id}`,
          url: p.url,
          text: `${r.name} ${r.vote === "rejected" ? "hat abgelehnt" : "wartet auf dich"}: ${p.title}`,
        })),
    );

const prOpenThreads: Rule = (s) =>
  s.prs
    .filter((p) => p.role === "author" && p.status === "active" && p.openThreads > 0)
    .map((p) => ({
      level: "action",
      ref: `!${p.id}`,
      url: p.url,
      text: `${p.openThreads} offene${p.openThreads === 1 ? "r" : ""} Kommentar-Thread${p.openThreads === 1 ? "" : "s"}: ${p.title}`,
    }));

const prConflicts: Rule = (s) =>
  s.prs
    .filter((p) => p.role === "author" && p.status === "active" && p.hasConflicts)
    .map((p) => ({ level: "action", ref: `!${p.id}`, url: p.url, text: `Merge-Konflikte: ${p.title}` }));

const prReadyToMerge: Rule = (s) =>
  s.prs
    .filter((p) => p.role === "author" && p.status === "active" && !p.isDraft && !p.hasConflicts)
    .filter((p) => p.openThreads === 0)
    .filter((p) => p.reviewers.some((r) => isApproval(r.vote)))
    .filter((p) => p.reviewers.every((r) => (r.required ? isApproval(r.vote) : r.vote !== "waiting" && r.vote !== "rejected")))
    .map((p) => ({ level: "ready", ref: `!${p.id}`, url: p.url, text: `Bereit zum Mergen: ${p.title}` }));

// --- PRs where I'm a reviewer ------------------------------------------------

const reviewPending: Rule = (s) =>
  s.prs
    .filter((p) => p.role === "reviewer" && p.status === "active" && !p.isDraft)
    .filter((p) => p.reviewers.some((r) => r.isMe && r.vote === "none"))
    .map((p) => ({ level: "action", ref: `!${p.id}`, url: p.url, text: `Review von dir angefragt (${p.author}): ${p.title}` }));

// --- Tickets -----------------------------------------------------------------

/** PR is merged, nothing else open for the ticket, but the ticket still sits in an earlier column. */
const ticketToMove: Rule = (s, ctx) =>
  s.prs
    .filter((p) => p.status === "completed")
    .flatMap((p) => p.ticketKeys.map((key) => ({ p, issue: ctx.issueByKey.get(key) })))
    .filter(({ issue }) => issue && issue.statusCategory !== "done")
    .filter(({ issue }) => !ctx.postMergeStatuses.includes(issue!.status.toLowerCase()))
    .filter(({ issue }) => !(ctx.prsByKey.get(issue!.key) ?? []).some((o) => o.status === "active"))
    .map(({ p, issue }) => ({
      level: "action" as const,
      ref: issue!.key,
      url: issue!.url,
      text: `!${p.id} ist gemerged, Ticket steht noch auf „${issue!.status}“ – weiterschieben?`,
    }));

/** Latest comment is from someone else and I haven't answered (e.g. test feedback). */
const unansweredFeedback: Rule = (s, ctx) =>
  s.issues
    .filter((i) => i.statusCategory !== "done")
    .flatMap((i) => {
      const last = i.comments.at(-1);
      if (!last || last.authorIsMe) return [];
      if (ctx.now - Date.parse(last.at) > FEEDBACK_DAYS * 86_400_000) return [];
      return [{ level: "action" as const, ref: i.key, url: i.url, text: `Feedback von ${last.author}: „${last.text}“` }];
    });

export const rules: Rule[] = [
  reviewPending,
  prBlockedByReviewer,
  prConflicts,
  prOpenThreads,
  unansweredFeedback,
  ticketToMove,
  prReadyToMerge,
];

const ORDER: Record<HintLevel, number> = { action: 0, ready: 1, info: 2 };

export const evaluate = (s: Snapshot, ctx: RuleContext, all: Rule[] = rules): Hint[] =>
  all.flatMap((r) => r(s, ctx)).sort((a, b) => ORDER[a.level] - ORDER[b.level]);
