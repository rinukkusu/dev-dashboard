import { expect, test } from "bun:test";
import { kanban } from "../src/board.ts";
import type { Issue, StatusCategory } from "../src/model.ts";

const ticket = (ref: string, status: string, statusId: string, statusCategory: StatusCategory = "indeterminate"): Issue => ({
  id: `jira:${ref}`, source: "jira", ref, url: "u", title: ref, type: "Story", status, statusId, statusCategory,
  updatedAt: "2026-10-20T10:00:00.000Z", comments: [], scope: "list",
});

const names = (cols: ReturnType<typeof kanban>) => cols.map((c) => `${c.name}:${c.issues.map((i) => i.ref).join(",")}`);

test("board config decides columns and order, empty columns stay", () => {
  const board = [
    { name: "To Do", statusIds: ["1"] },
    { name: "In Arbeit", statusIds: ["3", "10010"] },
    { name: "Review & Test", statusIds: ["10001", "10002"] },
    { name: "Done", statusIds: ["10003"] },
  ];
  const cols = kanban([ticket("CT-1", "In Test", "10002"), ticket("CT-2", "In Arbeit", "3"), ticket("CT-3", "In Review", "10001")], board, []);
  expect(names(cols)).toEqual(["To Do:", "In Arbeit:CT-2", "Review & Test:CT-1,CT-3", "Done:"]);
});

test("statuses the board doesn't know get their own column", () => {
  const board = [{ name: "In Progress", statusIds: ["3"] }];
  const cols = kanban([ticket("A-1", "Backlog", "99", "new"), ticket("A-2", "In Progress", "3"), ticket("A-3", "Blocked", "98")], board, []);
  expect(names(cols)).toEqual(["Backlog:A-1", "In Progress:A-2", "Blocked:A-3"]);
});

test("without board: JIRA_STATUS_ORDER first, then category, then name", () => {
  const tickets = [
    ticket("A-1", "Done", "5", "done"),
    ticket("A-2", "In Test", "4"),
    ticket("A-3", "To Do", "1", "new"),
    ticket("A-4", "In Arbeit", "2"),
    ticket("A-5", "In Review", "3"),
  ];
  expect(names(kanban(tickets, undefined, [])).map((n) => n.split(":")[0])).toEqual(["To Do", "In Arbeit", "In Review", "In Test", "Done"]);
  expect(names(kanban(tickets, undefined, ["in test", "in review"])).map((n) => n.split(":")[0])).toEqual([
    "In Test", "In Review", "To Do", "In Arbeit", "Done",
  ]);
});
