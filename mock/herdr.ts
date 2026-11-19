// A pretend herdr for `bun run dev` (MOCK_HERDR=1): a few spaces with Claude agents and their
// transcripts, so the agent chat and the remote control can be tried without herdr. A prompt shows
// up in the chat and gets an answer a moment later; the blocked agent takes "1" or "enter".
import { mkdir, appendFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { projectDirName } from "../src/transcript.ts";

type Status = "idle" | "working" | "blocked" | "done";
type FakeAgent = { pane: string; workspace: string; tab: string; status: Status; title: string; cwd: string; session: string; screen: string };

const workspaces = [
  { workspace_id: "w1", number: 1, label: "DEMA-20 - Form. Versand", focused: true },
  { workspace_id: "w2", number: 2, label: "CT-7 Login timeout", focused: false },
  { workspace_id: "w3", number: 3, label: "PR Reviews", focused: false },
];
const tabs = [
  { tab_id: "w1:t1", workspace_id: "w1", label: "1", number: 1 },
  { tab_id: "w1:t2", workspace_id: "w1", label: "comments", number: 2 },
  { tab_id: "w2:t1", workspace_id: "w2", label: "1", number: 1 },
  { tab_id: "w3:t1", workspace_id: "w3", label: "1", number: 1 },
];
// what Claude's AskUserQuestion looks like on screen: the conversation, a rule, then the question
const QUESTION = `● Die Validierung läuft jetzt clientseitig. Bevor ich die Fehlermeldungen umbaue:

  Ran 3 shell commands
────────────────────────────────────────────────────────────────────────────────
 ☐ Fehlertexte

Wo sollen die Fehlermeldungen des Formulars stehen?

❯ 1. Unter jedem Feld (Recommended)
     Direkt am Feld, verschwindet beim Korrigieren.
  2. Gesammelt oben
     Eine Liste über dem Formular, mit Sprungmarken.
  3. Beides
     Liste oben und Hinweis am Feld.
  4. Type something.
────────────────────────────────────────────────────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel`;

const agents: FakeAgent[] = [
  { pane: "w1:p1", workspace: "w1", tab: "w1:t1", status: "blocked", title: "Form validation", cwd: "C:\\work\\shop", session: "s-form", screen: QUESTION },
  { pane: "w1:p2", workspace: "w1", tab: "w1:t2", status: "done", title: "Review comments", cwd: "C:\\work\\shop", session: "s-comments", screen: "> " },
  { pane: "w2:p1", workspace: "w2", tab: "w2:t1", status: "working", title: "Login timeout", cwd: "C:\\work\\auth", session: "s-login", screen: "✻ Reading src/session.ts…" },
];

let uuid = 0;
const line = (type: "user" | "assistant", content: unknown) =>
  JSON.stringify({ type, uuid: `m${++uuid}`, timestamp: new Date().toISOString(), message: { content } }) + "\n";

async function write(projects: string, a: FakeAgent, text: string) {
  const dir = join(projects, projectDirName(a.cwd));
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${a.session}.jsonl`), text);
}

export async function startFakeHerdr(projects: string) {
  await write(projects, agents[0]!, [
    JSON.stringify({ type: "ai-title", aiTitle: "Form validation for the shipping form" }) + "\n",
    line("user", "DEMA-20: the shipping form accepts empty postcodes. Add validation and a test."),
    line("assistant", [{ type: "text", text: "I'll look at the form first." }, { type: "tool_use", name: "Read", input: { file_path: "src/forms/shipping.ts" } }]),
    line("assistant", [{ type: "tool_use", name: "Grep", input: { pattern: "postcode" } }, { type: "tool_use", name: "Edit", input: { file_path: "src/forms/shipping.ts" } }]),
    line("assistant", [{ type: "text", text: "The postcode is now **required** and checked against the country's format:\n\n```ts\nif (!/^\\d{4,5}$/.test(postcode)) errors.postcode = t.invalid;\n```\n\nNext I'll run the tests." }, { type: "tool_use", name: "Bash", input: { command: "bun test test/form.test.ts", description: "Run the form tests" } }]),
  ].join(""));
  await write(projects, agents[1]!, [
    line("user", "Go through the open review comments on !7 and propose answers."),
    line("assistant", [{ type: "text", text: "Two comments are open:\n\n1. *Rename `chk`* – done, it's `isValid` now.\n2. *Why no debounce?* – proposed answer: the form validates on blur, so there's nothing to debounce." }]),
  ].join(""));
  await write(projects, agents[2]!, [
    line("user", "CT-7: users get logged out after 5 minutes although the session should last 30."),
    line("assistant", [{ type: "text", text: "Let me find where the session lifetime is set." }, { type: "tool_use", name: "Grep", input: { pattern: "maxAge|ttl" } }]),
  ].join(""));

  const status = () => (w: string) => {
    const order: Status[] = ["blocked", "done", "working", "idle"];
    return agents.filter((a) => a.workspace === w).map((a) => a.status).sort((x, y) => order.indexOf(x) - order.indexOf(y))[0] ?? "idle";
  };
  const find = (pane: unknown) => agents.find((a) => a.pane === pane);
  /** working for a moment, then an answer in the transcript */
  const answer = (a: FakeAgent, text: string) => {
    a.status = "working";
    a.screen = "✻ Thinking…";
    setTimeout(async () => {
      await write(projects, a, line("assistant", [{ type: "text", text }]));
      a.status = "done";
      a.screen = "> ";
    }, 2500);
  };

  const server = createServer((sock) => {
    sock.setEncoding("utf8");
    let buf = "";
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const req = JSON.parse(buf.slice(0, nl)) as { id: string; method: string; params: Record<string, unknown> };
      const reply = (body: object) => sock.end(JSON.stringify({ id: req.id, ...body }) + "\n");
      const a = find(req.params.target);
      switch (req.method) {
        case "workspace.list":
          return reply({ result: { workspaces: workspaces.map((w) => ({ ...w, agent_status: status()(w.workspace_id), active_tab_id: `${w.workspace_id}:t1` })) } });
        case "tab.list":
          return reply({ result: { tabs } });
        case "agent.list":
          return reply({
            result: {
              agents: agents.map((x) => ({
                pane_id: x.pane, workspace_id: x.workspace, agent: "claude", agent_status: x.status, title: x.title, cwd: x.cwd, tab_id: x.tab,
                agent_session: { agent: "claude", kind: "id", value: x.session }, focused: x.pane === "w1:p1",
              })),
            },
          });
        case "events.subscribe":
          // no events: the dashboard polls every HERDR_POLL_SECONDS instead
          return reply({ error: { code: "invalid_request", message: "the mock has no events" } });
        case "agent.read":
          if (!a) return reply({ error: { code: "agent_not_found", message: "no such agent" } });
          // like herdr: a full-screen app waiting for input can't be scrolled back for more than its screen
          if (a.status === "blocked" && req.params.source === "recent" && Number(req.params.lines) > 40) {
            return reply({ error: { code: "read_failed", message: `cannot read ${req.params.lines} lines while ${a.pane} is blocked: its alternate-screen history can only be captured by scrolling while idle. Wait and retry, or use --source visible` } });
          }
          return reply({ result: { read: { text: a.screen + "\n\n\n" } } });
        case "agent.prompt":
          if (!a) return reply({ error: { code: "agent_not_found", message: "no such agent" } });
          if (a.status === "blocked") return reply({ error: { code: "agent_blocked", message: "agent is blocked" } });
          void write(projects, a, line("user", String(req.params.text)));
          answer(a, `Got it: *${String(req.params.text).slice(0, 60)}* – I'm on it.`);
          return reply({ result: { type: "ok" } });
        case "agent.send_keys": {
          if (!a) return reply({ error: { code: "agent_not_found", message: "no such agent" } });
          const k = (req.params.keys as string[])[0];
          if (a.status === "blocked" && (k === "1" || k === "2" || k === "enter")) {
            void write(projects, a, line("assistant", [{ type: "tool_use", name: "Bash", input: { command: "bun test test/form.test.ts" } }]));
            answer(a, "All 12 form tests pass ✓ – the empty postcode is rejected now.");
          } else if (a.status === "blocked" && k === "esc") {
            a.status = "idle";
            a.screen = "> ";
          }
          return reply({ result: { type: "ok" } });
        }
        case "agent.focus":
        case "workspace.focus":
          return reply({ result: { type: "ok" } });
        default:
          return reply({ error: { code: "invalid_request", message: `the mock doesn't know ${req.method}` } });
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { address: `tcp://127.0.0.1:${(server.address() as AddressInfo).port}`, stop: () => server.close() };
}
