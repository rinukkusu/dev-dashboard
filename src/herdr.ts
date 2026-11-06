// herdr (https://herdr.dev) – terminal workspace manager for coding agents.
// Its socket API speaks one JSON request per line and answers with one JSON line; a subscription
// keeps its connection open and sends one JSON line per event.
// The dashboard lists the workspaces ("spaces") with their agents, links them to tickets by the
// Jira keys in their names, and can show an agent's output, send it a prompt or focus it in herdr.
import { createConnection, type NetConnectOpts, type Socket } from "node:net";
import type { KeyExtractor } from "./correlate.ts";
import { message } from "./http.ts";
import type { Agent, AgentStatus, Issue, PullRequest, Space } from "./model.ts";

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
  active_tab_id?: string | null;
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
  tab_id?: string | null;
  state_change_seq?: number | null;
  focused?: boolean | null;
};

type RawTab = { tab_id: string; workspace_id: string; label: string; number: number };

/** Order for "which agent is the most interesting one": waiting for me first. */
const URGENCY: AgentStatus[] = ["blocked", "done", "working", "idle", "unknown"];
const byUrgency = (a: Agent, b: Agent) => URGENCY.indexOf(a.status) - URGENCY.indexOf(b.status);

export function toSpaces(workspaces: RawWorkspace[], agents: RawAgent[], extractKeys: KeyExtractor, tabs: RawTab[] = []): Space[] {
  return workspaces.map((w) => ({
    id: w.workspace_id,
    number: w.number,
    label: w.label,
    status: w.agent_status,
    ticketKeys: extractKeys(w.label),
    focused: w.focused,
    activeTabId: w.active_tab_id ?? undefined,
    tabs: tabs.filter((t) => t.workspace_id === w.workspace_id).map((t) => ({ id: t.tab_id, label: t.label })),
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
        tabId: a.tab_id ?? undefined,
        seq: a.state_change_seq ?? undefined,
        focused: a.focused ?? undefined,
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

/**
 * The spaces of a ticket or PR: Jira tickets by their key in the space name, PRs by their ticket
 * keys or their ref, other issues (GitLab, GitHub) by their ref ("app#7").
 */
export function spacesForItem(spaces: Space[], item: { kind: "ticket"; issue: Issue } | { kind: "pr"; pr: PullRequest }): Space[] {
  if (item.kind === "pr") return spacesOf(spaces, item.pr.ticketKeys, item.pr.ref);
  return item.issue.source === "jira" ? spacesOf(spaces, [item.issue.ref]) : spacesOf(spaces, [], item.issue.ref);
}

/** The agent to talk to in a space: a Claude if there is one, otherwise the most urgent. */
export const agentOf = (s: Space) => s.agents.find((a) => /claude/i.test(a.kind ?? "")) ?? s.agents[0];

/**
 * Where comments on a ticket/PR go when its spaces have several agents (one per tab, say):
 * 1. sticky – the pane the last ones went to, while it still hosts an agent
 * 2. an agent in the tab last shown in its space
 * 3. the agent that did something most recently (herdr's state_change_seq)
 * Claudes first – only their answers can be read back from a transcript.
 */
export function pickAgent(spaces: Space[], sticky?: string): { space: Space; agent: Agent } | undefined {
  const all = spaces.flatMap((space) => space.agents.map((agent) => ({ space, agent })));
  if (!all.length) return undefined;
  const pinned = sticky && all.find((x) => x.agent.paneId === sticky);
  if (pinned) return pinned;
  const claudes = all.filter((x) => /claude/i.test(x.agent.kind ?? ""));
  const pool = claudes.length ? claudes : all;
  const active = pool.filter((x) => x.space.activeTabId && x.agent.tabId === x.space.activeTabId);
  const recent = (xs: typeof pool) => [...xs].sort((a, b) => (b.agent.seq ?? -1) - (a.agent.seq ?? -1))[0];
  return recent(active) ?? recent(pool);
}

export type Herdr = {
  spaces(): Space[];
  /** set while herdr isn't reachable */
  error(): string | undefined;
  /** last lines of the agent's terminal, ANSI stripped */
  read(paneId: string, lines?: number): Promise<string>;
  /** types the text into the agent and presses Enter; herdr refuses while the agent waits at a question */
  prompt(paneId: string, text: string): Promise<void>;
  /**
   * New workspace in cwd with an agent in it – or, with space, a new tab in that workspace – which
   * then gets the prompt. sent: false if the agent stopped at a question first (e.g. "trust this
   * folder?") – the prompt is then still to be sent.
   */
  start(opts: { label: string; cwd: string; name: string; kind: string; args: string[]; prompt: string; space?: string }): Promise<{ pane: string; sent: boolean }>;
  /** polls herdr right away instead of waiting for the next round */
  refresh(): Promise<void>;
  /** switches the herdr window to that pane, or to a workspace without agents */
  focus(target: { pane: string } | { space: string }): Promise<void>;
  stop(): void;
};

/** Everything that changes what the dashboard shows; agent states need a subscription per pane. */
export const subscriptions = (agentPanes: string[]) => [
  ...["workspace.created", "workspace.updated", "workspace.renamed", "workspace.closed", "workspace.focused",
    "tab.created", "tab.closed", "tab.renamed", "tab.focused", "tab.moved",
    "pane.created", "pane.closed", "pane.focused", "pane.moved", "pane.exited", "pane.agent_detected"].map((type) => ({ type })),
  ...agentPanes.map((pane_id) => ({ type: "pane.agent_status_changed", pane_id })),
];

/**
 * Listens to herdr's events and reloads its state right after each one; polls on top of that in
 * case the subscription is down (or herdr too old for it): every pollSeconds, or only every
 * fallbackSeconds while the subscription works. Calls onChange whenever spaces or agents changed.
 */
export function startHerdr(address: string, pollSeconds: number, extractKeys: KeyExtractor, onChange: () => void, fallbackSeconds = 30): Herdr {
  let spaces: Space[] = [];
  let error: string | undefined;
  let last = "";
  let timer: Timer | undefined;
  let stopped = false;

  // --- event subscription ---
  let sub: Socket | undefined;
  /** the agent panes the open subscription covers – a different set means subscribing anew */
  let subPanes: string | undefined;
  let live = false;
  let unsupported = false;
  let soon: Timer | undefined;
  /** a burst of events (switching tabs sends several) becomes one reload */
  const reloadSoon = () => {
    clearTimeout(soon);
    soon = setTimeout(() => void refresh(), 100);
  };
  const subscribe = () => {
    if (stopped || unsupported) return;
    const panes = spaces.flatMap((s) => s.agents.map((a) => a.paneId)).sort().join(",");
    if (sub && panes === subPanes) return;
    sub?.destroy();
    subPanes = panes;
    const sock = createConnection(endpoint(address));
    sub = sock;
    let buf = "";
    const gone = () => {
      if (sub !== sock) return; // replaced on purpose
      if (live) console.log("herdr: event subscription closed, polling until it's back");
      sub = undefined;
      subPanes = undefined;
      live = false;
    };
    sock.setEncoding("utf8");
    sock.on("connect", () =>
      sock.write(JSON.stringify({ id: "dashboard:events", method: "events.subscribe", params: { subscriptions: subscriptions(panes ? panes.split(",") : []) } }) + "\n"),
    );
    sock.on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        let msg: { result?: { type?: string }; error?: { code?: string; message?: string }; event?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.error) {
          // herdr without events: polling it is
          unsupported = true;
          console.log(`herdr: no event subscription (${msg.error.message ?? msg.error.code}), polling every ${pollSeconds} s`);
          sock.destroy();
          return;
        }
        if (msg.result?.type === "subscription_started") {
          if (!live) console.log("herdr: subscribed to events");
          live = true;
          // something may have changed between the last reload and now
          reloadSoon();
        } else if (msg.event) reloadSoon();
      }
    });
    sock.on("error", gone);
    sock.on("close", gone);
  };

  let reloading: Promise<void> | undefined;
  let again = false;
  /** One reload at a time; asked again while one runs, it runs once more afterwards. */
  const refresh = (): Promise<void> => {
    if (reloading) {
      again = true;
      return reloading;
    }
    reloading = (async () => {
      do {
        again = false;
        await reload();
      } while (again && !stopped);
    })().finally(() => (reloading = undefined));
    return reloading;
  };

  const reload = async () => {
    try {
      const [ws, ag, tabs] = await Promise.all([
        call<{ workspaces: RawWorkspace[] }>(address, "workspace.list"),
        call<{ agents: RawAgent[] }>(address, "agent.list"),
        // only for the names of tabs – not worth failing over
        call<{ tabs: RawTab[] }>(address, "tab.list").then((r) => r.tabs, () => [] as RawTab[]),
      ]);
      spaces = toSpaces(ws.workspaces, ag.agents, extractKeys, tabs);
      if (error) console.log("herdr: reachable again");
      error = undefined;
      subscribe();
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
    if (!stopped) timer = setTimeout(loop, (live ? Math.max(fallbackSeconds, pollSeconds) : pollSeconds) * 1000);
  };
  void loop();

  return {
    spaces: () => spaces,
    error: () => error,
    refresh,
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
    async start({ label, cwd, name, kind, args, prompt, space }) {
      const created = space
        ? await call<{ root_pane: { pane_id: string } }>(address, "tab.create", { workspace_id: space, label, cwd, focus: false })
        : await call<{ root_pane: { pane_id: string } }>(address, "workspace.create", { label, cwd, focus: false });
      const pane = created.root_pane.pane_id;
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
      clearTimeout(soon);
      sub?.destroy();
      sub = undefined;
    },
  };
}
