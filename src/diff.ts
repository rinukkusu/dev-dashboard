import type { Change, Snapshot } from "./model.ts";

const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));

/**
 * Compares two snapshots and describes what changed – only what *other people* did
 * (or what finished on its own, like a CI run). My own votes, comments, merges and
 * status changes are no news to me.
 */
export function diff(prev: Snapshot, next: Snapshot): Change[] {
  const at = next.takenAt;
  const out: Change[] = [];

  // --- Pull requests ---------------------------------------------------------
  const prevPrs = byId(prev.prs);
  for (const pr of next.prs) {
    const base = { at, resource: pr.id, ref: pr.ref, url: pr.url, subject: pr.title };
    const old = prevPrs.get(pr.id);

    if (!old) {
      // New to the list. Only a pending review request is news; a PR that shows up because
      // I commented on it or added it by hand is not.
      if (pr.role === "reviewer" && pr.status === "active" && pr.reviewers.some((r) => r.isMe && r.vote === "none")) {
        out.push({ ...base, id: `pr:${pr.id}:review-request`, kind: "pr-review-request", actor: pr.author });
      }
      continue;
    }

    if (old.status === "active" && pr.status === "completed" && !pr.closedByMe) {
      out.push({ ...base, id: `pr:${pr.id}:merged`, kind: "pr-merged" });
    }
    if (old.status === "active" && pr.status === "abandoned" && !pr.closedByMe) {
      out.push({ ...base, id: `pr:${pr.id}:gone`, kind: "pr-gone" });
    }

    const oldVotes = new Map(old.reviewers.map((r) => [r.id, r.vote]));
    for (const r of pr.reviewers) {
      const before = oldVotes.get(r.id) ?? "none";
      if (r.isMe || r.vote === before) continue;
      out.push({ ...base, id: `pr:${pr.id}:vote:${r.id}:${r.vote}:${at}`, kind: "pr-vote", actor: r.name, vote: r.vote });
    }

    const oldComments = new Set(old.comments.map((c) => c.id));
    for (const c of pr.comments) {
      if (c.authorIsMe || oldComments.has(c.id)) continue;
      out.push({ ...base, at: c.at, id: `pr:${pr.id}:c:${c.id}`, kind: "pr-comment", actor: c.author, text: c.text });
    }

    // CI result on my own PRs: went red, or turned green again.
    if (pr.role === "author" && pr.status === "active" && old.checks && pr.checks !== old.checks && pr.checks && pr.checks !== "pending") {
      out.push({ ...base, id: `pr:${pr.id}:checks:${pr.checks}:${at}`, kind: "pr-checks", checks: pr.checks });
    }
  }

  // Gone from the list entirely: only worth mentioning for PRs I wrote or review
  // (involved ones simply age out of the search).
  const nextPrIds = new Set(next.prs.map((p) => p.id));
  for (const old of prev.prs) {
    if (old.status === "active" && (old.role === "author" || old.role === "reviewer") && !nextPrIds.has(old.id)) {
      out.push({ at, resource: old.id, ref: old.ref, url: old.url, subject: old.title, id: `pr:${old.id}:gone`, kind: "pr-gone" });
    }
  }

  // --- Issues ------------------------------------------------------------------
  const prevIssues = byId(prev.issues);
  for (const issue of next.issues) {
    const base = { at, resource: issue.id, ref: issue.ref, url: issue.url, subject: issue.title };
    const old = prevIssues.get(issue.id);

    // New in the main list (sprint planned, assigned to me, …) – unless I did that myself.
    const joinedList = issue.scope === "list" && old?.scope !== "list";
    if (joinedList && !issue.lastChangeByMe) {
      out.push({ ...base, id: `issue:${issue.id}:added:${at}`, kind: "issue-added", to: issue.status });
    }
    if (!old) continue;

    if (old.status !== issue.status && !issue.lastChangeByMe) {
      out.push({ ...base, id: `issue:${issue.id}:status:${issue.status}:${at}`, kind: "issue-status",
        from: old.status, to: issue.status });
    }

    const oldComments = new Set(old.comments.map((c) => c.id));
    for (const c of issue.comments) {
      if (c.authorIsMe || oldComments.has(c.id)) continue;
      out.push({ ...base, at: c.at, id: `issue:${issue.id}:c:${c.id}`, kind: "issue-comment", actor: c.author, text: c.text });
    }
  }

  // Left the main list (sprint changed, reassigned, …) – unless I did that myself.
  const nextById = byId(next.issues);
  for (const old of prev.issues) {
    const now = nextById.get(old.id);
    if (old.scope === "list" && now?.scope !== "list" && !now?.lastChangeByMe) {
      out.push({ at, resource: old.id, ref: old.ref, url: old.url, subject: old.title, id: `issue:${old.id}:removed:${at}`, kind: "issue-removed" });
    }
  }

  // --- CI runs -------------------------------------------------------------------
  // Finished since the last poll: either it was running before, or it's new and short enough
  // to have started and finished in between. Starting is no news, finishing is.
  const prevRuns = byId(prev.runs);
  for (const run of next.runs) {
    const old = prevRuns.get(run.id);
    if (run.status !== "completed" || old?.status === "completed") continue;
    if (!old && Date.parse(run.updatedAt) < Date.parse(prev.takenAt)) continue; // finished long ago, just newly watched
    out.push({ at, resource: run.id, ref: run.ref, url: run.url, subject: run.name, id: `run:${run.id}:finished`,
      kind: "run-finished", conclusion: run.conclusion, text: run.branch });
  }

  // Comments carry their own timestamp, which can be older than the last "seen" click.
  return out.map((c) => ({ ...c, detectedAt: at }));
}

/** Appends new changes to the log, drops duplicates and anything older than keepHours. */
export function mergeLog(log: Change[], fresh: Change[], keepHours: number, now = Date.now()): Change[] {
  const cutoff = now - keepHours * 3_600_000;
  const seen = new Set<string>();
  return [...fresh, ...log]
    .filter((c) => Date.parse(c.at) >= cutoff && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
