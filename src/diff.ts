import type { Change, Snapshot } from "./model.ts";

const byId = <T, K>(items: T[], key: (t: T) => K) => new Map(items.map((i) => [key(i), i]));

/** Compares two snapshots and describes what changed. Only things other people did. */
export function diff(prev: Snapshot, next: Snapshot): Change[] {
  const at = next.takenAt;
  const out: Change[] = [];

  // --- Pull requests ---------------------------------------------------------
  const prevPrs = byId(prev.prs, (p) => p.id);
  for (const pr of next.prs) {
    const base = { at, ref: `!${pr.id}`, url: pr.url, subject: pr.title };
    const old = prevPrs.get(pr.id);

    if (!old) {
      if (pr.role === "reviewer") {
        out.push({ ...base, id: `pr:${pr.id}:review-request`, kind: "pr-review-request", actor: pr.author });
      }
      continue;
    }

    if (old.status === "active" && pr.status === "completed") {
      out.push({ ...base, id: `pr:${pr.id}:merged`, kind: "pr-merged" });
    }

    const oldVotes = byId(old.reviewers, (r) => r.id);
    for (const r of pr.reviewers) {
      const before = oldVotes.get(r.id)?.vote ?? "none";
      if (r.isMe || r.vote === before) continue;
      out.push({ ...base, id: `pr:${pr.id}:vote:${r.id}:${r.vote}:${at}`, kind: "pr-vote", actor: r.name, vote: r.vote });
    }

    const oldComments = new Set(old.comments.map((c) => c.id));
    for (const c of pr.comments) {
      if (c.authorIsMe || oldComments.has(c.id)) continue;
      out.push({ ...base, at: c.at, id: `pr:${pr.id}:c:${c.id}`, kind: "pr-comment", actor: c.author, text: c.text });
    }
  }

  const nextPrIds = new Set(next.prs.map((p) => p.id));
  for (const old of prev.prs) {
    if (old.status === "active" && !nextPrIds.has(old.id)) {
      out.push({ at, ref: `!${old.id}`, url: old.url, subject: old.title, id: `pr:${old.id}:gone`, kind: "pr-gone" });
    }
  }

  // --- Issues ------------------------------------------------------------------
  const prevIssues = byId(prev.issues, (i) => i.key);
  for (const issue of next.issues) {
    const base = { at, ref: issue.key, url: issue.url, subject: issue.summary };
    const old = prevIssues.get(issue.key);

    if (!old) {
      if (issue.inScope) {
        out.push({ ...base, id: `issue:${issue.key}:added:${at}`, kind: "issue-added", to: issue.status });
      }
      continue;
    }

    if (old.status !== issue.status) {
      out.push({ ...base, id: `issue:${issue.key}:status:${issue.status}:${at}`, kind: "issue-status",
        from: old.status, to: issue.status });
    }

    const oldComments = new Set(old.comments.map((c) => c.id));
    for (const c of issue.comments) {
      if (c.authorIsMe || oldComments.has(c.id)) continue;
      out.push({ ...base, at: c.at, id: `issue:${issue.key}:c:${c.id}`, kind: "issue-comment", actor: c.author, text: c.text });
    }
  }

  const nextKeys = new Set(next.issues.filter((i) => i.inScope).map((i) => i.key));
  for (const old of prev.issues) {
    if (old.inScope && !nextKeys.has(old.key)) {
      out.push({ at, ref: old.key, url: old.url, subject: old.summary, id: `issue:${old.key}:removed:${at}`, kind: "issue-removed" });
    }
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
