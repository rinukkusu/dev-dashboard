// herdr (https://herdr.dev) – terminal workspace manager for coding agents.
// Its socket API speaks one JSON request per line and answers with one JSON line.
// The dashboard lists the workspaces ("spaces") with their agents, links them to tickets by the
// Jira keys in their names, and can show an agent's output, send it a prompt or focus it in herdr.
import { createConnection, type NetConnectOpts } from "node:net";
import type { KeyExtractor } from "./correlate.ts";
import { message } from "./http.ts";
import type { Agent, AgentStatus, Space } from "./model.ts";

export class HerdrError extends Error {
  constructor(
    readonly code: string,
    text: string,
  ) {
    super(text);
  }
}

/**
 * On Windows herdr listens on a named pipe, but `herdr status server` prints the socket path
 * (C:\Users\you\AppData\Roaming\herdr\herdr.sock); the pipe is that path behind \\.\pipe\.
 */
export function socketPath(path: string, platform: string = process.platform): string {
  if (platform !== "win32" || /^\\\\[.?]\\pipe\\/i.test(path)) return path;
  return `\\\\.\\pipe\\${path}`;
}

/**
 * Where herdr listens: what `herdr status server` prints as socket (a Unix socket path, on Windows
 * the path its named pipe is named after, or the pipe itself), or tcp://host:port for the bridge.
 */
export function endpoint(address: string, platform: string = process.platform): NetConnectOpts {
  const tcp = address.match(/^tcp:\/\/([^:/]+):(\d+)\/?$/);
  return tcp ? { host: tcp[1]!, port: Number(tcp[2]) } : { path: socketPath(address, platform) };
}

/** One request over a fresh connection – herdr answers with one line and that's it. */
export async function call<T = unknown>(address: string, method: string, params: object = {}, timeoutMs = 5000): Promise<T> {
  const id = `dashboard:${method}:${Date.now()}`;
  return new Promise<T>((resolve, reject) => {
    let buf = "";
    let done = false;
    const sock = createConnection(endpoint(address));
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new HerdrError("timeout", `herdr: ${method} timed out`))), timeoutMs);
    sock.setEncoding("utf8");
    sock.on("connect", () => sock.write(JSON.stringify({ id, method, params }) + "\n"));
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      finish(() => {
        try {
          const msg = JSON.parse(buf.slice(0, nl)) as { result?: T; error?: { code?: string; message?: string } };
          if (msg.error) reject(new HerdrError(msg.error.code ?? "error", msg.error.message ?? "herdr error"));
          else resolve(msg.result as T);
        } catch (e) {
          reject(e);
        }
      });
    });
    sock.on("error", (e) => finish(() => reject(e)));
    sock.on("close", () => finish(() => reject(new HerdrError("closed", `herdr: connection closed before ${method} answered`))));
  });
}

// --- raw API shapes (only what we use) -------------------------------------------

type RawWorkspace = {
  workspace_id: string;
  number: number;
  label: string;
  focused: boolean;
  agent_status: AgentStatus;
};

type RawAgent = {
  pane_id: string;
  workspace_id: string;
  agent?: string | null;
  display_agent?: string | null;
  name?: string | null;
  agent_status: AgentStatus;
  title?: string | null;
  terminal_title_stripped?: string | null;
  cwd?: string | null;
  agent_session?: { agent: string; kind: "id" | "path"; value: string } | null;
};

/** Order for "which agent is the most interesting one": waiting for me first. */
const URGENCY: AgentStatus[] = ["blocked", "done", "working", "idle", "unknown"];
const byUrgency = (a: Agent, b: Agent) => URGENCY.indexOf(a.status) - URGENCY.indexOf(b.status);

export function toSpaces(workspaces: RawWorkspace[], agents: RawAgent[], extractKeys: KeyExtractor): Space[] {
  return workspaces.map((w) => ({
    id: w.workspace_id,
    number: w.number,
    label: w.label,
    status: w.agent_status,
    ticketKeys: extractKeys(w.label),
    focused: w.focused,
    agents: agents
      .filter((a) => a.workspace_id === w.workspace_id)
      .map((a): Agent => ({
        paneId: a.pane_id,
        kind: a.display_agent ?? a.agent ?? undefined,
        name: a.name ?? undefined,
        status: a.agent_status,
        title: a.title ?? a.terminal_title_stripped ?? undefined,
        cwd: a.cwd ?? undefined,
        session: a.agent_session ? { kind: a.agent_session.kind, value: a.agent_session.value } : undefined,
      }))
      .sort(byUrgency),
  }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The spaces of a ticket (its key in the space name) or a PR (one of its ticket keys, or its own ref
 * like "!25233" or "app#12" in the name – that's how spaces started for a PR are named).
 */
export function spacesOf(spaces: Space[], keys: string[], prRef?: string): Space[] {
  const ref = prRef && new RegExp(`(^|[^\\w])${escapeRe(prRef)}(?!\\w)`);
  return spaces.filter((s) => s.ticketKeys.some((k) => keys.includes(k)) || (ref && ref.test(s.label)));
}

/** The agent to talk to in a space: a Claude if there is one, otherwise the most urgent. */
export const agentOf = (s: Space) => s.agents.find((a) => /claude/i.test(a.kind ?? "")) ?? s.agents[0];

export type Herdr = {
  spaces(): Space[];
  /** set while herdr isn't reachable */
  error(): string | undefined;
  /** last lines of the agent's terminal, ANSI stripped */
  read(paneId: string, lines?: number): Promise<string>;
  /** types the text into the agent and presses Enter; herdr refuses while the agent waits at a question */
  prompt(paneId: string, text: string): Promise<void>;
  /**
   * New workspace in cwd with an agent in it, which then gets the prompt. sent: false if the agent
   * stopped at a question first (e.g. "trust this folder?") – the prompt is then still to be sent.
   */
  start(opts: { label: string; cwd: string; name: string; kind: string; args: string[]; prompt: string }): Promise<{ pane: string; sent: boolean }>;
  /** switches the herdr window to that pane, or to a workspace without agents */
  focus(target: { pane: string } | { space: string }): Promise<void>;
  stop(): void;
};

/**
 * Polls herdr every few seconds – it's a local socket, so that's cheap – and calls onChange
 * whenever the spaces or their agents' states changed.
 */
export function startHerdr(address: string, pollSeconds: number, extractKeys: KeyExtractor, onChange: () => void): Herdr {
  let spaces: Space[] = [];
  let error: string | undefined;
  let last = "";
  let timer: Timer | undefined;
  let stopped = false;

  const refresh = async () => {
    try {
      const [ws, ag] = await Promise.all([
        call<{ workspaces: RawWorkspace[] }>(address, "workspace.list"),
        call<{ agents: RawAgent[] }>(address, "agent.list"),
      ]);
      spaces = toSpaces(ws.workspaces, ag.agents, extractKeys);
      if (error) console.log("herdr: reachable again");
      error = undefined;
    } catch (e) {
      // herdr not running is normal (e.g. after a reboot) – keep trying quietly, log once
      const text = `herdr not reachable at ${address}: ${message(e)}`;
      if (error !== text) console.error(text);
      error = text;
      spaces = [];
    }
    const now = JSON.stringify([spaces, error]);
    if (now !== last) {
      last = now;
      onChange();
    }
  };
  // setTimeout chain, so a slow herdr never gets overlapping polls
  const loop = async () => {
    await refresh();
    if (!stopped) timer = setTimeout(loop, pollSeconds * 1000);
  };
  void loop();

  return {
    spaces: () => spaces,
    error: () => error,
    async read(paneId, lines = 60) {
      const r = await call<{ read?: { text?: string }; text?: string }>(address, "agent.read", {
        target: paneId,
        source: "recent",
        lines,
        strip_ansi: true,
      });
      return r.read?.text ?? r.text ?? "";
    },
    async prompt(paneId, text) {
      await call(address, "agent.prompt", { target: paneId, text });
      void refresh(); // status flips to working right away
    },
    async start({ label, cwd, name, kind, args, prompt }) {
      const ws = await call<{ root_pane: { pane_id: string } }>(address, "workspace.create", { label, cwd, focus: false });
      const pane = ws.root_pane.pane_id;
      try {
        const started = await call<{ agent: RawAgent & { launch_pending?: boolean } }>(
          address, "agent.start", { name, kind, pane_id: pane, args, timeout_ms: 60_000 }, 65_000,
        );
        // usually ready right away; otherwise wait until it is (or asks something, e.g. "trust this folder?")
        let status = started.agent.agent_status;
        if (started.agent.launch_pending || status !== "idle") {
          const waited = await call<{ agent: RawAgent }>(address, "agent.wait", { target: pane, until: ["idle", "blocked"], timeout_ms: 60_000 }, 65_000);
          status = waited.agent.agent_status;
        }
        if (status === "blocked") return { pane, sent: false };
        await call(address, "agent.prompt", { target: pane, text: prompt });
        return { pane, sent: true };
      } catch (e) {
        // agent_not_ready = it came up but asks something first; the space is there, the prompt not yet
        if (e instanceof HerdrError && e.code === "agent_not_ready") return { pane, sent: false };
        throw e;
      } finally {
        void refresh();
      }
    },
    async focus(target) {
      if ("pane" in target) await call(address, "agent.focus", { target: target.pane });
      else await call(address, "workspace.focus", { workspace_id: target.space });
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
