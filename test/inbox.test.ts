import { expect, test } from "bun:test";
import type { Hint, PullRequest } from "../src/model.ts";
import type { ViewData } from "../src/view.ts";
import { inbox } from "../web/src/lib/derive.ts";

const pr = (id: string, title: string) => ({ id, title, ref: id, url: `u/${id}` }) as PullRequest;
const hint = (resource: string, level: Hint["level"], reason: Hint["reason"]): Hint => ({ level, reason, resource, ref: resource, url: `u/${resource}`, msg: ["conflicts", "x"] });
const view = (hints: Hint[], prs: PullRequest[]) =>
  ({ snapshot: { takenAt: "2026-11-06T10:00:00Z", prs, issues: [], runs: [], errors: [] }, hints, changes: [], muted: [], watched: [], sent: [], runsKeepHours: 24, statusOrder: [], sources: ["ado"], defaultLang: "en" }) as ViewData;

test("inbox: one entry per PR with all its reasons, most urgent level first", () => {
  const items = inbox(
    view(
      [hint("a", "ready", "ready"), hint("b", "action", "review"), hint("a", "action", "checks"), hint("a", "action", "threads"), hint("c", "info", "agent-reply")],
      [pr("a", "PR A"), pr("b", "PR B")],
    ),
  );
  expect(items.map((i) => [i.resource, i.level, i.title, i.hints.map((h) => h.reason)])).toEqual([
    // "a" became an action item through its checks, which the rules listed after "b"s review
    ["b", "action", "PR B", ["review"]],
    ["a", "action", "PR A", ["checks", "threads", "ready"]],
    ["c", "info", undefined, ["agent-reply"]],
  ]);
  expect(items[1]!.kind).toBe("pr");
  expect(items[2]!.kind).toBe("other");
});
