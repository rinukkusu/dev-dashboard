import { afterAll, expect, test } from "bun:test";
import { createServer, type AddressInfo } from "node:net";
import { link, makeKeyExtractor } from "../src/correlate.ts";
import { call, endpoint, HerdrError, startHerdr, toSpaces } from "../src/herdr.ts";
import { renderApp, type View } from "../src/render.ts";
import { dict } from "../src/i18n.ts";
import type { Issue } from "../src/model.ts";

const extract = makeKeyExtractor(["DEMA", "CT"]);

const workspaces = [
  { workspace_id: "w1", number: 1, label: "PR Reviews", focused: false, agent_status: "idle" as const },
  { workspace_id: "w2", number: 2, label: "DEMA-20 - Form. Versand", focused: true, agent_status: "blocked" as const },
];
const agents = [
  { pane_id: "w2:p1", workspace_id: "w2", agent: "claude", agent_status: "working" as const, title: "tests" },
  { pane_id: "w2:p2", workspace_id: "w2", agent: "codex", agent_status: "blocked" as const },
];

// --- a fake herdr: newline-delimited JSON, one answer per request ---
const received: { method: string; params: Record<string, unknown> }[] = [];
const fake = createServer((sock) => {
  sock.setEncoding("utf8");
  let buf = "";
  sock.on("data", (chunk: string) => {
    buf += chunk;
    const nl = buf.indexOf("\n");
    if (nl < 0) return;
    const req = JSON.parse(buf.slice(0, nl));
    received.push(req);
    const reply = (body: object) => sock.end(JSON.stringify({ id: req.id, ...body }) + "\n");
    switch (req.method) {
      case "workspace.list":
        return reply({ result: { type: "workspace_list", workspaces } });
      case "agent.list":
        return reply({ result: { type: "agent_list", agents } });
      case "agent.read":
        return reply({ result: { type: "pane_read", read: { text: "hello from w2:p1" } } });
      case "agent.prompt":
        return req.params.target === "w2:p2"
          ? reply({ error: { code: "agent_blocked", message: "agent is blocked" } })
          : reply({ result: { type: "ok" } });
      default:
        return reply({ error: { code: "invalid_request", message: "unknown method" } });
    }
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
const address = `tcp://127.0.0.1:${(fake.address() as AddressInfo).port}`;
afterAll(() => fake.close());

test("endpoint: tcp:// for the bridge, anything else is a socket path or named pipe", () => {
  expect(endpoint("tcp://host.docker.internal:7377")).toEqual({ host: "host.docker.internal", port: 7377 });
  expect(endpoint("/home/max/.config/herdr/herdr.sock")).toEqual({ path: "/home/max/.config/herdr/herdr.sock" });
  expect(endpoint("\\\\.\\pipe\\herdr")).toEqual({ path: "\\\\.\\pipe\\herdr" });
});

test("spaces get their ticket keys from the name, agents sorted by urgency", () => {
  const spaces = toSpaces(workspaces, agents, extract);
  expect(spaces.map((s) => [s.label, s.ticketKeys])).toEqual([
    ["PR Reviews", []],
    ["DEMA-20 - Form. Versand", ["DEMA-20"]],
  ]);
  expect(spaces[1]!.agents.map((a) => `${a.kind}:${a.status}`)).toEqual(["codex:blocked", "claude:working"]);
});

test("call: result on success, HerdrError with herdr's code on failure", async () => {
  expect(await call<{ agents: unknown[] }>(address, "agent.list")).toMatchObject({ agents: [{ pane_id: "w2:p1" }, { pane_id: "w2:p2" }] });
  const err = (await call(address, "nope").catch((e) => e)) as HerdrError;
  expect(err).toBeInstanceOf(HerdrError);
  expect(err.code).toBe("invalid_request");
});

test("call: unreachable herdr rejects instead of hanging", async () => {
  await expect(call("tcp://127.0.0.1:1", "agent.list", {}, 1000)).rejects.toBeDefined();
});

test("startHerdr polls, reads, prompts and passes herdr's refusal on", async () => {
  let changes = 0;
  const herdr = startHerdr(address, 60, extract, () => changes++);
  try {
    await Bun.sleep(200);
    expect(changes).toBe(1);
    expect(herdr.error()).toBeUndefined();
    expect(herdr.spaces().map((s) => s.id)).toEqual(["w1", "w2"]);
    expect(await herdr.read("w2:p1")).toBe("hello from w2:p1");
    await herdr.prompt("w2:p1", "weiter bitte");
    expect(received.find((r) => r.method === "agent.prompt")?.params).toEqual({ target: "w2:p1", text: "weiter bitte" });
    const err = await herdr.prompt("w2:p2", "x").catch((e) => e);
    expect(err.code).toBe("agent_blocked");
  } finally {
    herdr.stop();
  }
});

test("a ticket card shows the space named after it, live mode makes it clickable", () => {
  const issue: Issue = {
    id: "jira:DEMA-20", source: "jira", ref: "DEMA-20", url: "u", title: "Formular Versand", type: "Story",
    status: "In Arbeit", statusCategory: "indeterminate", updatedAt: "2026-10-20T10:00:00.000Z", comments: [], scope: "list",
  };
  const view: View = {
    lang: "de",
    snapshot: { takenAt: "2026-10-20T10:00:00.000Z", prs: [], issues: [issue], runs: [], errors: [] },
    changes: [],
    hints: [],
    links: link([], [issue]),
    muted: new Set(),
    watched: new Set(),
    refreshSeconds: 300,
    runsKeepHours: 24,
    statusOrder: [],
    sources: ["jira"],
    herdr: { spaces: toSpaces(workspaces, agents, extract) },
  };
  const live = renderApp(view, true);
  expect(live).toContain(`data-pane="w2:p2"`);
  expect(live).toContain(dict("de").herdr.status.blocked);
  expect(live).toContain("page-spaces");
  expect(renderApp(view, false)).not.toContain("data-pane=");
});
