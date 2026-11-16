import { afterAll, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { bookedHours, timesheets } from "../src/timecockpit.ts";
import { startMock } from "../mock/server.ts";

const mock = startMock(0);
afterAll(() => mock.stop(true));
const cfg = { apiUrl: `${mock.url.origin}/tc`, pat: "demo", hoursPerPoint: 4 };

test("sums the bookings per key, keys without bookings are missing", async () => {
  const hours = await bookedHours(cfg, ["ABC-101", "ABC-098", "ABC-112"]);
  expect(hours.get("ABC-101")).toBe(9.5);
  expect(hours.get("ABC-098")).toBe(53.5);
  expect(hours.has("ABC-112")).toBe(false);
});

test("many keys are split over several requests", async () => {
  const filler = Array.from({ length: 60 }, (_, i) => `ZZZ-${i}`);
  const hours = await bookedHours(cfg, [...filler, "ABC-107", "ABC-107"]);
  expect([...hours]).toEqual([["ABC-107", 22.25]]);
});

test("the bookings of a range: oldest first, rounded, the description as booked", async () => {
  // a Monday to Wednesday long ago: three full days of the mock's plan
  const sheets = await timesheets(cfg, "2026-01-05", "2026-01-07");
  expect(sheets.length).toBe(15);
  expect(sheets.map((s) => s.begin.slice(0, 10))).toEqual([...Array(5).fill("2026-01-05"), ...Array(5).fill("2026-01-06"), ...Array(5).fill("2026-01-07")]);
  expect(sheets[0]).toEqual({
    id: "2026-01-05-07:45", begin: "2026-01-05T07:45:00", end: "2026-01-05T09:30:00", hours: 1.75,
    project: "ABC", task: "ABC-101", description: "ABC-101 | Export-Endpunkt umgebaut, Tests ergänzt",
  });
  // Saturday and Sunday: nothing
  expect(await timesheets(cfg, "2026-01-10", "2026-01-11")).toEqual([]);
  await expect(timesheets(cfg, "5.1.2026", "2026-01-11")).rejects.toThrow();
});

test("config: off without PAT, 4 h per point by default", () => {
  const base = { JIRA_PAT: "x", JIRA_BASE_URL: "https://jira.example.com" };
  expect(loadConfig(base).timecockpit).toBeUndefined();
  const tc = loadConfig({ ...base, TIMECOCKPIT_PAT: "t" }).timecockpit;
  expect(tc).toEqual({ apiUrl: "https://api.timecockpit.com/odata", pat: "t", hoursPerPoint: 4 });
  expect(loadConfig({ ...base, TIMECOCKPIT_PAT: "t", TIMECOCKPIT_HOURS_PER_POINT: "2.75" }).timecockpit?.hoursPerPoint).toBe(2.75);
});
