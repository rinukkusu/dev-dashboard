import { expect, test } from "bun:test";
import type { Change, Hint, Prefs } from "../src/model.ts";
import { holdingResolves, resolveHints } from "../src/prefs.ts";

const hint = (resource: string, reason: Hint["reason"], msg: Hint["msg"]): Hint => ({ level: "action", reason, resource, ref: resource, url: "u", msg });
const move = (prs: string[], status = "In Refinement") => hint("jira:DEMA-30", "move-ticket", ["ticketToMove", prs, status]);
const change = (resource: string, detectedAt: string): Change => ({ id: `${resource}@${detectedAt}`, at: detectedAt, detectedAt, kind: "issue-comment", resource, ref: "x", url: "u", subject: "s" });
const prefs = (): Prefs => ({ watches: [], muted: [], sent: [], routes: {}, jobs: [], resolved: [], notes: {} });
const NOW = Date.parse("2026-11-10T10:00:00Z");

test("resolve: holds while the to-dos are the same and nothing new came in", () => {
  const p = prefs();
  resolveHints(p, "jira:DEMA-30", [move(["!44"])], NOW);
  expect(holdingResolves(p.resolved, [move(["!44"]), hint("other", "checks", ["checksFailing", "t"])], [change("jira:DEMA-30", "2026-11-10T09:00:00Z")])).toHaveLength(1);
});

test("resolve: over once something new comes in about it", () => {
  const p = prefs();
  resolveHints(p, "jira:DEMA-30", [move(["!44"])], NOW);
  expect(holdingResolves(p.resolved, [move(["!44"])], [change("jira:DEMA-30", "2026-11-10T11:00:00Z")])).toEqual([]);
  // news about something else doesn't count
  expect(holdingResolves(p.resolved, [move(["!44"])], [change("jira:DEMA-31", "2026-11-10T11:00:00Z")])).toHaveLength(1);
});

test("resolve: over when a to-do changes, a new one turns up, or they're gone", () => {
  const p = prefs();
  resolveHints(p, "jira:DEMA-30", [move(["!44"])], NOW);
  expect(holdingResolves(p.resolved, [move(["!44", "!51"])], [])).toEqual([]);
  expect(holdingResolves(p.resolved, [move(["!44"]), hint("jira:DEMA-30", "feedback", ["feedback", "Anna", "?"])], [])).toEqual([]);
  expect(holdingResolves(p.resolved, [], [])).toEqual([]);
});

test("resolve: the agent job riding along isn't part of what a to-do says", () => {
  const p = prefs();
  resolveHints(p, "pr", [hint("pr", "threads", ["openThreads", 2, "t"])], NOW);
  const withJob = { ...hint("pr", "threads", ["openThreads", 2, "t"]), job: { id: "j" } as Hint["job"] };
  expect(holdingResolves(p.resolved, [withJob], [])).toHaveLength(1);
});

test("notes: trimmed and kept, an empty one removes it", async () => {
  const { setNote } = await import("../src/prefs.ts");
  const p = prefs();
  setNote(p, "jira:DEMA-30", "  wartet auf Pat  ", NOW);
  expect(p.notes).toEqual({ "jira:DEMA-30": { text: "wartet auf Pat", at: "2026-11-10T10:00:00.000Z" } });
  setNote(p, "jira:DEMA-30", "   ");
  expect(p.notes).toEqual({});
});
