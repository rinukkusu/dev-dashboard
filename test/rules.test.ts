import { expect, test } from "bun:test";
import { link } from "../src/correlate.ts";
import type { Issue, PullRequest, Snapshot } from "../src/model.ts";
import { evaluate } from "../src/rules.ts";

const pr = (ref: string, ticketKeys: string[], ownKeys?: string[]) =>
  ({ id: ref, ref, source: "gitlab", role: "author", status: "completed", reviewers: [], ticketKeys, ownKeys }) as unknown as PullRequest;
const issue = (key: string) =>
  ({ id: `jira:${key}`, ref: key, source: "jira", url: "u", status: "In Refinement", statusCategory: "new", comments: [], scope: "linked" }) as unknown as Issue;

const moves = (prs: PullRequest[], issues: Issue[]) => {
  const s = { takenAt: "", prs, issues, runs: [], errors: [] } satisfies Snapshot;
  return evaluate(s, { ...link(prs, issues), postMergeStatuses: [], now: 0 }).filter((h) => h.reason === "move-ticket").map((h) => h.ref);
};

test("move ticket: a merged PR for the ticket counts, one only mentioning it in its description doesn't", () => {
  // !44 is for DEMA-20 (title/branch) and mentions DEMA-30 in its description
  expect(moves([pr("!44", ["DEMA-20", "DEMA-30"], ["DEMA-20"])], [issue("DEMA-20"), issue("DEMA-30")])).toEqual(["DEMA-20"]);
});

test("move ticket: a PR from an older state without ownKeys goes by all its keys", () => {
  expect(moves([pr("!44", ["DEMA-30"])], [issue("DEMA-30")])).toEqual(["DEMA-30"]);
});
