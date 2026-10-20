import { describe, expect, test } from "bun:test";
import { diff } from "../src/diff.ts";
import type { Issue, PullRequest, Run, Snapshot } from "../src/model.ts";

const T0 = "2026-10-19T10:00:00.000Z";
const T1 = "2026-10-19T10:05:00.000Z";

const snap = (takenAt: string, s: Partial<Snapshot>): Snapshot => ({ takenAt, prs: [], issues: [], runs: [], errors: [], ...s });

const pr = (p: Partial<PullRequest> = {}): PullRequest => ({
  id: "github:acme/app#1", source: "github", ref: "app#1", number: 1, title: "Fix it", url: "u", repo: "acme/app",
  branch: "fix", targetBranch: "main", author: "Me", role: "author", status: "active", createdAt: T0,
  isDraft: false, hasConflicts: false, reviewers: [], openThreads: 0, comments: [], ticketKeys: [], ...p,
});

const issue = (i: Partial<Issue> = {}): Issue => ({
  id: "jira:ABC-1", source: "jira", ref: "ABC-1", url: "u", title: "Ticket", type: "Story", status: "In Progress",
  statusCategory: "indeterminate", updatedAt: T0, comments: [], scope: "list", ...i,
});

const run = (r: Partial<Run> = {}): Run => ({
  id: "github:acme/app/runs/9", source: "github", ref: "#9", url: "u", name: "CI", title: "Fix it", repo: "acme/app",
  branch: "fix", status: "running", triggeredByMe: true, watched: false, createdAt: T0, updatedAt: T0, ...r,
});

const kinds = (prev: Snapshot, next: Snapshot) => diff(prev, next).map((c) => c.kind);

describe("only what others did", () => {
  test("my own status change is no news, someone else's is", () => {
    const before = snap(T0, { issues: [issue()] });
    expect(kinds(before, snap(T1, { issues: [issue({ status: "In Review", lastChangeByMe: true })] }))).toEqual([]);
    expect(kinds(before, snap(T1, { issues: [issue({ status: "In Review" })] }))).toEqual(["issue-status"]);
  });

  test("merging my own PR is no news, someone else merging it is", () => {
    const before = snap(T0, { prs: [pr()] });
    expect(kinds(before, snap(T1, { prs: [pr({ status: "completed", closedByMe: true })] }))).toEqual([]);
    expect(kinds(before, snap(T1, { prs: [pr({ status: "completed" })] }))).toEqual(["pr-merged"]);
  });

  test("my own comments don't show up", () => {
    const c = (id: string, mine: boolean) => ({ id, author: mine ? "Me" : "Anna", authorIsMe: mine, text: "hi", at: T1 });
    const next = snap(T1, { prs: [pr({ comments: [c("1", true), c("2", false)] })] });
    const changes = diff(snap(T0, { prs: [pr()] }), next);
    expect(changes.map((x) => x.actor)).toEqual(["Anna"]);
  });

  test("joining the sprint list by my own hand is no news", () => {
    const before = snap(T0, { issues: [issue({ scope: "involved" })] });
    expect(kinds(before, snap(T1, { issues: [issue({ lastChangeByMe: true })] }))).toEqual([]);
    expect(kinds(before, snap(T1, { issues: [issue()] }))).toEqual(["issue-added"]);
  });
});

describe("PRs", () => {
  test("review request only while my review is pending", () => {
    const me = { id: "me", name: "Me", required: false, isGroup: false, isMe: true };
    const requested = pr({ role: "reviewer", reviewers: [{ ...me, vote: "none" }] });
    const reviewed = pr({ role: "reviewer", reviewers: [{ ...me, vote: "approved" }] });
    expect(kinds(snap(T0, {}), snap(T1, { prs: [requested] }))).toEqual(["pr-review-request"]);
    expect(kinds(snap(T0, {}), snap(T1, { prs: [reviewed] }))).toEqual([]);
  });

  test("a PR I'm only involved in can age out quietly", () => {
    expect(kinds(snap(T0, { prs: [pr({ role: "involved" })] }), snap(T1, {}))).toEqual([]);
    expect(kinds(snap(T0, { prs: [pr()] }), snap(T1, {}))).toEqual(["pr-gone"]);
  });

  test("checks on my PR: red and green again are news, pending isn't", () => {
    const at = (checks: PullRequest["checks"]) => snap(T1, { prs: [pr({ checks })] });
    expect(kinds(snap(T0, { prs: [pr({ checks: "pending" })] }), at("failure"))).toEqual(["pr-checks"]);
    expect(kinds(snap(T0, { prs: [pr({ checks: "failure" })] }), at("success"))).toEqual(["pr-checks"]);
    expect(kinds(snap(T0, { prs: [pr({ checks: "success" })] }), at("pending"))).toEqual([]);
  });
});

describe("runs", () => {
  test("finishing is news, starting isn't", () => {
    expect(kinds(snap(T0, {}), snap(T1, { runs: [run()] }))).toEqual([]);
    const done = run({ status: "completed", conclusion: "failure", updatedAt: T1 });
    expect(kinds(snap(T0, { runs: [run()] }), snap(T1, { runs: [done] }))).toEqual(["run-finished"]);
  });

  test("a short run that started and finished between two polls still counts", () => {
    const quick = run({ status: "completed", conclusion: "success", createdAt: T1, updatedAt: T1 });
    expect(kinds(snap(T0, {}), snap(T1, { runs: [quick] }))).toEqual(["run-finished"]);
  });

  test("watching a run that finished long ago is no news", () => {
    const old = run({ status: "completed", conclusion: "success", updatedAt: "2026-10-18T10:00:00.000Z", watched: true });
    expect(kinds(snap(T0, {}), snap(T1, { runs: [old] }))).toEqual([]);
  });
});

test("every change knows its resource, so it can be muted", () => {
  const changes = diff(snap(T0, { issues: [issue()] }), snap(T1, { issues: [issue({ status: "Done" })] }));
  expect(changes[0]?.resource).toBe("jira:ABC-1");
});
