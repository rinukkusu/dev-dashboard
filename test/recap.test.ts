import { expect, test } from "bun:test";
import { activityByDay, bookingText, gaps, groupByTicket, isBooked, minutes, projectTotals, recapDays, sessionsByDay, uncovered } from "../web/src/lib/recap.ts";
import type { Comment, Issue, PullRequest, Timesheet, WorkSession } from "../src/model.ts";

const pr = (over: Partial<PullRequest>): PullRequest => ({
  id: "ado:pr:28857", source: "ado", ref: "!28857", number: 28857, title: "Export", url: "u", repo: "app", branch: "feature/CT-1978", targetBranch: "main",
  author: "me", role: "author", status: "active", createdAt: "2026-11-12T08:00:00", isDraft: false, hasConflicts: false,
  reviewers: [], openThreads: 0, comments: [], ticketKeys: ["CT-1978"], ownKeys: ["CT-1978"], ...over,
});
const issue = (key: string, comments: Comment[]): Issue => ({
  id: `jira:${key}`, source: "jira", ref: key, url: "u", title: "Rundung", type: "Story", status: "In Arbeit",
  statusCategory: "indeterminate", updatedAt: "2026-11-13T10:00:00", comments, scope: "list",
});
const comment = (id: string, at: string, mine = true): Comment => ({ id, author: mine ? "me" : "Pat", authorIsMe: mine, text: "x", at });
const sheet = (task: string, description: string, over: Partial<Timesheet> = {}): Timesheet => ({
  id: task, begin: "2026-11-13T08:00:00", end: "2026-11-13T09:00:00", hours: 1, project: "CTJP", task, description, ...over,
});

test("five working days back from Monday: the weekend in between, not the one before", () => {
  const days = recapDays(new Date(2026, 10, 16, 9), 5); // Monday 16.11.
  expect(days.map((d) => d.day)).toEqual(["2026-11-16", "2026-11-15", "2026-11-14", "2026-11-13", "2026-11-12", "2026-11-11", "2026-11-10"]);
  expect(days.filter((d) => d.weekend).map((d) => d.day)).toEqual(["2026-11-15", "2026-11-14"]);
  // on a Saturday: the Saturday itself, then Friday back to Monday
  expect(recapDays(new Date(2026, 10, 14, 9), 5).map((d) => d.day)).toEqual(["2026-11-14", "2026-11-13", "2026-11-12", "2026-11-11", "2026-11-10", "2026-11-09"]);
});

test("what I did per day: one entry per PR (opened and merged), my comments counted, to-dos checked off", () => {
  const days = activityByDay(
    [
      pr({ createdAt: "2026-11-13T06:53:00", status: "completed", closedAt: "2026-11-13T15:00:00", comments: [comment("c1", "2026-11-13T09:00:00"), comment("c2", "2026-11-13T08:30:00"), comment("c3", "2026-11-13T10:00:00", false)] }),
      pr({ id: "ado:pr:1", ref: "!1", number: 1, role: "reviewer", author: "Tobi", status: "completed", closedAt: "2026-11-13T11:00:00", comments: [comment("c4", "2026-11-12T16:00:00")] }),
    ],
    [issue("DEMA-30", [comment("c5", "2026-11-13T07:00:00"), comment("c6", "2026-11-12T07:00:00", false)])],
    [{ id: "t1", text: "Pat fragen", createdAt: "2026-11-12T08:00:00", doneAt: "2026-11-13T12:00:00" }, { id: "t2", text: "offen", createdAt: "2026-11-13T08:00:00" }],
  );
  const short = (day: string) => days.get(day)?.map((d) => `${d.ref ?? "-"} ${d.events.map((e) => `${e.kind}${e.count ? ` ${e.count}` : ""}`).join(", ")}`);
  expect(short("2026-11-12")).toEqual(["!1 commented 1"]);
  // someone else's PR merged by someone else isn't mine to list
  expect(short("2026-11-13")).toEqual(["!28857 opened, commented 2, merged", "DEMA-30 commented 1", "- todo"]);
  expect(days.get("2026-11-13")![0]!.events[1]!.at).toBe("2026-11-13T08:30:00");
});

test("grouped by ticket: the ticket's own comments first, then its PRs; things without a ticket on their own", () => {
  const dids = activityByDay(
    [pr({ createdAt: "2026-11-13T09:00:00" }), pr({ id: "ado:pr:2", ref: "!2", number: 2, createdAt: "2026-11-13T08:00:00", ownKeys: [], ticketKeys: [] })],
    [issue("CT-1978", [comment("c1", "2026-11-13T10:00:00")])],
    [],
  ).get("2026-11-13")!;
  expect(groupByTicket(dids).map((g) => `${g.ticket ?? "-"}: ${g.dids.map((d) => d.ref).join(" ")}`)).toEqual(["-: !2", "CT-1978: CT-1978 !28857"]);
});

test("booked when a booking names the ticket or the PR; reviews also count on 'PR Review'", () => {
  const [opened] = activityByDay([pr({})], [], []).get("2026-11-12")!;
  expect(isBooked(opened!, [sheet("CT-1978", "CT-1978 | Export")])).toBe(true);
  expect(isBooked(opened!, [sheet("Maintenance", "Pipeline für CT-1978 repariert")])).toBe(true);
  expect(isBooked(opened!, [sheet("PR Review", "PR 28857 nachgebessert")])).toBe(true);
  expect(isBooked(opened!, [sheet("CT-19780", "x"), sheet("PR Review", "!288570")])).toBe(false);
  // a bare number from four digits on, or within a range
  expect(isBooked(opened!, [sheet("Renovate PRs", "Renovate | 28857 gemergt")])).toBe(true);
  expect(isBooked(opened!, [sheet("Renovate PRs", "Fix-PRs 28855-28860 (CVEs)")])).toBe(true);
  expect(isBooked(opened!, [sheet("Renovate PRs", "Fix-PRs 28858-28860, 2.28857, 28857.5")])).toBe(false);
  const [review] = activityByDay([pr({ role: "reviewer", ownKeys: [], ticketKeys: [], comments: [comment("c", "2026-11-13T09:00:00")] })], [], []).get("2026-11-13")!;
  expect(isBooked(review!, [sheet("CT-2052", "x")])).toBe(false);
  expect(isBooked(review!, [sheet("PR Review", "Tobis MRs")])).toBe(true);
});

test("a booking's text without its task code; hours per project, biggest first", () => {
  expect(bookingText(sheet("CT-2052", "CT-2052 | Umsetzungsplan"))).toBe("Umsetzungsplan");
  expect(bookingText(sheet("Sprint Daily", "Daily"))).toBe("Daily");
  expect(bookingText(sheet("DEMA-25", "DEMA-25"))).toBe("");
  expect(projectTotals([sheet("a", "", { hours: 0.5, project: "DEMA" }), sheet("b", "", { hours: 2 }), sheet("c", "", { hours: 1, project: "DEMA" })])).toEqual([["CTJP", 2], ["DEMA", 1.5]]);
});

const at = (hm: string) => new Date(`2026-11-13T${hm}:00`).getTime();
const work = (session: string, from: string, to: string, prompts = 1, keys: string[] = []): WorkSession => ({
  id: `${session}:${from}`, session, title: session, project: "CleverTax", start: new Date(at(from)).toISOString(), end: new Date(at(to)).toISOString(), prompts, keys,
});

test("Claude work no booking covers; overlapping sessions count once in a gap", () => {
  const booked = [{ start: at("08:00"), end: at("09:00") }, { start: at("10:00"), end: at("11:00") }];
  expect(uncovered({ start: at("07:30"), end: at("10:30") }, booked)).toEqual([{ start: at("07:30"), end: at("08:00") }, { start: at("09:00"), end: at("10:00") }]);
  expect(minutes(uncovered({ start: at("08:15"), end: at("08:45") }, booked))).toBe(0);

  const sheets = [
    sheet("CT-2052", "x", { id: "a", begin: "2026-11-13T08:00:00", end: "2026-11-13T09:00:00" }),
    sheet("CT-2052", "x", { id: "b", begin: "2026-11-13T09:10:00", end: "2026-11-13T10:00:00" }), // 10 min: no gap worth showing
    sheet("CT-2052", "x", { id: "c", begin: "2026-11-13T11:00:00", end: "2026-11-13T12:00:00" }),
  ];
  const g = gaps(sheets, [work("s1", "10:10", "10:30"), work("s2", "10:20", "10:40")]);
  expect([...g.keys()]).toEqual(["c"]);
  expect(g.get("c")).toEqual({ start: at("10:00"), end: at("11:00"), worked: 30 });
});

test("sessions per day: stretches of a session together, keys merged, in the order they started", () => {
  const days = sessionsByDay([work("b", "13:00", "13:20", 2, ["CT-2052"]), work("a", "07:00", "07:10", 1, ["DEMA-25"]), work("b", "10:00", "10:30", 3, ["CT-2005", "CT-2052"])]);
  expect(days.get("2026-11-13")!.map((s) => `${s.title} ${s.prompts} ${s.keys.join(",")} ${s.stretches.length}`)).toEqual(["a 1 DEMA-25 1", "b 5 CT-2052,CT-2005 2"]);
});
