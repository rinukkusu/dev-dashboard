import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spacesOf } from "../src/herdr.ts";
import { agentName, DEFAULTS, fill, loadPrompts, prepare } from "../src/launch.ts";
import type { Issue, PullRequest, Space } from "../src/model.ts";

const issue: Issue = {
  id: "jira:CT-2089", source: "jira", ref: "CT-2089", url: "https://jira/browse/CT-2089", title: "Vorjahreswerte im Export übernehmen",
  type: "Story", status: "In Arbeit", statusCategory: "indeterminate", updatedAt: "2026-10-20T10:00:00Z", comments: [], scope: "list",
};
const pr = {
  id: "ado:pr:25233", source: "ado", ref: "!25233", number: 25233, title: "Export: Vorjahr", url: "https://ado/pr/25233", repo: "taxcore",
  branch: "feature/CT-2089-vorjahr", targetBranch: "main", author: "Anna", ticketKeys: ["CT-2089"], comments: [],
} as unknown as PullRequest;

test("fill keeps unknown placeholders", () => {
  expect(fill("{ref}: {nope}", { ref: "CT-1" })).toBe("CT-1: {nope}");
});

test("labels follow the space naming, titles are cut short", () => {
  expect(prepare(DEFAULTS, { kind: "ticket", issue }).label).toBe("CT-2089 - Vorjahreswerte im Export über…");
  expect(prepare(DEFAULTS, { kind: "pr", pr }).label).toBe("!25233 CT-2089 - Export: Vorjahr");
  expect(prepare(DEFAULTS, { kind: "pr", pr: { ...pr, ticketKeys: [] } }).label).toBe("!25233 - Export: Vorjahr");
});

test("prompts get the values; a comment is quoted with its id", () => {
  expect(prepare(DEFAULTS, { kind: "pr", pr }).prompt).toStartWith('Review pull request !25233 in taxcore (https://ado/pr/25233): "Export: Vorjahr" by Anna, feature/CT-2089-vorjahr → main.');
  const comment = { id: "77:1", author: "Lisa", authorIsMe: false, text: "Bitte\nnochmal prüfen", at: "2026-10-20T10:00:00Z" };
  const p = prepare(DEFAULTS, { kind: "pr", pr }, comment).prompt;
  expect(p).toContain("from Lisa (comment id 77:1)");
  expect(p).toContain("> Bitte\n> nochmal prüfen");
});

test("agent names are what herdr accepts and unique", () => {
  expect(agentName("CT-2089", new Set())).toBe("ct-2089");
  expect(agentName("!25233", new Set())).toBe("pr-25233");
  expect(agentName("app#12", new Set(["app-12"]))).toBe("app-12-2");
});

test("spaces belong to a PR by its ticket keys or its ref in the name", () => {
  const space = (label: string, ticketKeys: string[] = []): Space => ({ id: label, number: 1, label, status: "idle", ticketKeys, agents: [], focused: false });
  const spaces = [space("CT-2089 - x", ["CT-2089"]), space("!25233 - y"), space("!252330 - z"), space("CT-1 - w", ["CT-1"])];
  expect(spacesOf(spaces, pr.ticketKeys, pr.ref).map((s) => s.label)).toEqual(["CT-2089 - x", "!25233 - y"]);
});

const dir = await mkdtemp(join(tmpdir(), "prompts-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("prompts.json overrides parts, the rest stays default; a broken file is an error", async () => {
  const path = join(dir, "prompts.json");
  expect((await loadPrompts(join(dir, "missing.json"))).ticket.prompt).toEqual(DEFAULTS.ticket.prompt);
  await writeFile(path, JSON.stringify({ ticket: { args: ["--permission-mode", "plan"] } }));
  const p = await loadPrompts(path);
  expect(p.ticket.args).toEqual(["--permission-mode", "plan"]);
  expect(p.ticket.label).toBe(DEFAULTS.ticket.label);
  expect(p.pr).toEqual(DEFAULTS.pr);
  await writeFile(path, "{ nope");
  await expect(loadPrompts(path)).rejects.toThrow("prompts.json");
});
