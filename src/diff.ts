import type { Change, Snapshot, Vote } from "./model.ts";

export const VOTE_LABEL: Record<Vote, string> = {
  approved: "approved",
  approvedWithSuggestions: "approved mit Vorschlägen",
  none: "kein Vote",
  waiting: "wartet auf Autor",
  rejected: "rejected",
};

const byId = <T, K>(items: T[], key: (t: T) => K) => new Map(items.map((i) => [key(i), i]));

/** Compares two snapshots and describes what changed. Only things other people did. */
export function diff(prev: Snapshot, next: Snapshot): Change[] {
  const at = next.takenAt;
  const out: Change[] = [];

  // --- Pull requests ---------------------------------------------------------
  const prevPrs = byId(prev.prs, (p) => p.id);
  for (const pr of next.prs) {
    const ref = `!${pr.id}`;
    const base = { at, ref, url: pr.url };
    const old = prevPrs.get(pr.id);

    if (!old) {
      if (pr.role === "reviewer") {
        out.push({ ...base, id: `pr:${pr.id}:review-request`, kind: "pr-review-request",
          title: `Review angefragt: ${pr.title}`, detail: `von ${pr.author}` });
      }
      continue;
    }

    if (old.status === "active" && pr.status === "completed") {
      out.push({ ...base, id: `pr:${pr.id}:merged`, kind: "pr-merged", title: `Gemerged: ${pr.title}` });
    }

    const oldVotes = byId(old.reviewers, (r) => r.id);
    for (const r of pr.reviewers) {
      const before = oldVotes.get(r.id)?.vote ?? "none";
      if (r.isMe || r.vote === before) continue;
      out.push({ ...base, id: `pr:${pr.id}:vote:${r.id}:${r.vote}:${at}`, kind: "pr-vote",
        title: `${r.name}: ${VOTE_LABEL[r.vote]}`, detail: pr.title });
    }

    const oldComments = new Set(old.comments.map((c) => c.id));
    for (const c of pr.comments) {
      if (c.authorIsMe || oldComments.has(c.id)) continue;
      out.push({ ...base, at: c.at, id: `pr:${pr.id}:c:${c.id}`, kind: "pr-comment",
        title: `${c.author} kommentiert „${pr.title}“`, detail: c.text });
    }
  }

  const nextPrIds = new Set(next.prs.map((p) => p.id));
  for (const old of prev.prs) {
    if (old.status === "active" && !nextPrIds.has(old.id)) {
      out.push({ at, ref: `!${old.id}`, url: old.url, id: `pr:${old.id}:gone`, kind: "pr-gone",
        title: `Nicht mehr offen: ${old.title}`, detail: "gemerged, abgebrochen oder Reviewer entfernt" });
    }
  }

  // --- Issues ------------------------------------------------------------------
  const prevIssues = byId(prev.issues, (i) => i.key);
  for (const issue of next.issues) {
    const base = { at, ref: issue.key, url: issue.url };
    const old = prevIssues.get(issue.key);

    if (!old) {
      if (issue.inScope) {
        out.push({ ...base, id: `issue:${issue.key}:added:${at}`, kind: "issue-added",
          title: `Neu in deiner Liste: ${issue.summary}`, detail: issue.status });
      }
      continue;
    }

    if (old.status !== issue.status) {
      out.push({ ...base, id: `issue:${issue.key}:status:${issue.status}:${at}`, kind: "issue-status",
        title: `${old.status} → ${issue.status}`, detail: issue.summary });
    }

    const oldComments = new Set(old.comments.map((c) => c.id));
    for (const c of issue.comments) {
      if (c.authorIsMe || oldComments.has(c.id)) continue;
      out.push({ ...base, at: c.at, id: `issue:${issue.key}:c:${c.id}`, kind: "issue-comment",
        title: `${c.author} kommentiert „${issue.summary}“`, detail: c.text });
    }
  }

  const nextKeys = new Set(next.issues.filter((i) => i.inScope).map((i) => i.key));
  for (const old of prev.issues) {
    if (old.inScope && !nextKeys.has(old.key)) {
      out.push({ at, ref: old.key, url: old.url, id: `issue:${old.key}:removed:${at}`, kind: "issue-removed",
        title: `Nicht mehr in deiner Liste: ${old.summary}`, detail: "Sprint gewechselt, umgehängt oder erledigt" });
    }
  }

  return out;
}

/** Appends new changes to the log, drops duplicates and anything older than keepHours. */
export function mergeLog(log: Change[], fresh: Change[], keepHours: number, now = Date.now()): Change[] {
  const cutoff = now - keepHours * 3_600_000;
  const seen = new Set<string>();
  return [...fresh, ...log]
    .filter((c) => Date.parse(c.at) >= cutoff && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
