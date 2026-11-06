import { expect, test } from "bun:test";
import type { Change, Hint, PullRequest, Space } from "../src/model.ts";
import type { ViewData } from "../src/view.ts";
import { agentsAtWork, groupChanges, inbox, waitingOnOthers } from "../web/src/lib/derive.ts";
import { freshHints, notifyKey } from "../web/src/lib/notify.ts";

const change = (id: string, at: string, over: Partial<Change>): Change => ({ id, at, kind: "pr-comment", ref: "r", url: "u", subject: "s", ...over });

test("feed: a pipeline's runs are one entry, so are a PR's changes; newest entry first", () => {
  const groups = groupChanges([
    change("r1", "2026-11-06T08:00:00Z", { kind: "run-finished", resource: "ado:run:1", subject: "jp-ci", conclusion: "failure" }),
    change("c1", "2026-11-06T09:00:00Z", { resource: "ado:pr:7" }),
    change("r2", "2026-11-06T10:00:00Z", { kind: "run-finished", resource: "ado:run:2", subject: "jp-ci", conclusion: "success" }),
    change("v1", "2026-11-06T09:30:00Z", { kind: "pr-vote", resource: "ado:pr:7" }),
    change("r3", "2026-11-06T07:00:00Z", { kind: "run-finished", resource: "ado:run:3", subject: "other-ci" }),
  ]);
  expect(groups.map((g) => g.changes.map((c) => c.id))).toEqual([["r2", "r1"], ["v1", "c1"], ["r3"]]);
});

const pr = (id: string, over: Partial<PullRequest> = {}) => ({ id, ref: id, title: id, url: "u", role: "author", status: "active", ...over }) as PullRequest;
const hint = (resource: string, reason: Hint["reason"]): Hint => ({ level: "action", reason, resource, ref: resource, url: "u", msg: ["conflicts", "x"] });
const view = (over: Partial<ViewData>) =>
  ({ snapshot: { takenAt: "x", prs: [], issues: [], runs: [], errors: [] }, hints: [], changes: [], muted: [], watched: [], sent: [], runsKeepHours: 24, statusOrder: [], sources: ["ado"], defaultLang: "en", ...over }) as ViewData;

test("below the inbox: my open PRs it doesn't list, and spaces with a busy agent", () => {
  const space = (id: string, status: Space["agents"][number]["status"]): Space => ({ id, number: 1, label: id, status, ticketKeys: [], focused: false, agents: [{ paneId: `${id}:p1`, kind: "claude", status }] });
  const v = view({
    snapshot: { takenAt: "x", prs: [pr("mine"), pr("todo"), pr("muted"), pr("review", { role: "reviewer" }), pr("done", { status: "completed" })], issues: [], runs: [], errors: [] },
    hints: [hint("todo", "checks"), hint("herdr:w2", "agent-blocked")],
    muted: ["muted"],
    herdr: { spaces: [space("w1", "working"), space("w2", "working"), space("w3", "idle")], canStart: false },
  });
  const items = inbox(v);
  expect(waitingOnOthers(v, items).map((p) => p.id)).toEqual(["mine"]);
  expect(agentsAtWork(v, items).map((sp) => sp.id)).toEqual(["w1"]);
});

test("notifications: only new hints worth one, not muted ones, each thing once", () => {
  const before = new Set([notifyKey(hint("a", "review"))]);
  const fresh = freshHints([hint("a", "review"), hint("b", "review"), hint("b", "review"), hint("c", "threads"), hint("d", "agent-blocked"), hint("e", "run-failed")], before, new Set(["e"]));
  expect(fresh.map((h) => h.resource)).toEqual(["b", "d"]);
});
