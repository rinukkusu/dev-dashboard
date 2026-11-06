import { join } from "node:path";
import type { Config } from "./config.ts";
import { link, makeKeyExtractor } from "./correlate.ts";
import { diff, mergeLog } from "./diff.ts";
import { message, takeApiStats, type ApiStats } from "./http.ts";
import type { Herdr } from "./herdr.ts";
import type { AgentJob, Change, Hint, Prefs, Snapshot, SourceId, Space } from "./model.ts";
import type { ViewData } from "./view.ts";
import { evaluate } from "./rules.ts";
import type { Source, SourceItems } from "./sources/types.ts";
import { readJson, writeAtomic } from "./store.ts";
import { bookedHours } from "./timecockpit.ts";

/** Bump when the snapshot format changes; an older state.json then starts a fresh baseline. */
const STATE_VERSION = 2;

export type State = {
  version: typeof STATE_VERSION;
  snapshot: Snapshot;
  changes: Change[];
  /** per-source memory, see Source.fetch */
  memos: Partial<Record<SourceId, unknown>>;
};

export const statePath = (cfg: Config) => join(cfg.outDir, "state.json");

export async function loadState(path: string): Promise<State | undefined> {
  const s = await readJson<State>(path);
  return s?.version === STATE_VERSION ? s : undefined;
}

const itemsOf = (s: Snapshot, id: SourceId): SourceItems => ({
  prs: s.prs.filter((p) => p.source === id),
  issues: s.issues.filter((i) => i.source === id),
  runs: s.runs.filter((r) => r.source === id),
});

/** Agents that want something from me: waiting at a question, or finished and not looked at yet. */
function agentHints(spaces: Space[]): Hint[] {
  return spaces.flatMap((s) =>
    s.agents
      .filter((a) => a.status === "blocked" || a.status === "done")
      .map((a): Hint => ({
        level: a.status === "blocked" ? "action" : "ready",
        reason: a.status === "blocked" ? "agent-blocked" : "agent-done",
        resource: `herdr:${s.id}`,
        ref: s.label,
        msg: [a.status === "blocked" ? "agentBlocked" : "agentDone", a.kind ?? "Agent"],
        url: "#spaces",
        pane: a.paneId,
      })),
  );
}

/**
 * Autopilot jobs on the to-do list: the newest one per PR/ticket that's running, or answered/failed
 * and not looked at yet. It joins a to-do about the same PR/ticket (🤖 next to it), or becomes one.
 */
export function withJobs(hints: Hint[], jobs: AgentJob[]): Hint[] {
  const latest = new Map<string, AgentJob>();
  for (const j of jobs) {
    const shown = j.status === "answered" || j.status === "failed" ? !j.read : true;
    if (shown) latest.set(j.resource, j); // jobs are in creation order: the last one wins
  }
  const out = hints.map((h) => {
    const job = latest.get(h.resource);
    if (!job) return h;
    latest.delete(h.resource);
    return { ...h, job };
  });
  for (const job of latest.values()) {
    out.push({
      level: job.status === "failed" ? "action" : job.status === "answered" ? "ready" : "info",
      reason: "agent-reply",
      resource: job.resource,
      ref: job.ref,
      msg: ["job", job.status, job.waiting],
      url: job.url,
      job,
    });
  }
  return out;
}

/** Everything the page needs, derived from a stored state – as data, the page puts it into words. */
export function buildView(cfg: Config, state: State, prefs: Prefs, sources: Source[], herdr?: Herdr): ViewData {
  const { snapshot, changes } = state;
  const muted = new Set(prefs.muted);
  const links = link(snapshot.prs, snapshot.issues);
  const spaces = herdr?.spaces() ?? [];
  const hints = withJobs(
    [
      ...agentHints(spaces),
      ...evaluate(snapshot, {
        ...links,
        postMergeStatuses: cfg.jira?.postMergeStatuses ?? [],
        now: Date.now(),
      }),
    ],
    prefs.jobs,
  ).filter((h) => !muted.has(h.resource));
  return {
    snapshot,
    changes,
    hints,
    muted: prefs.muted,
    watched: prefs.watches.map((w) => w.id),
    sent: prefs.sent,
    runsKeepHours: cfg.runsKeepHours,
    statusOrder: cfg.jira?.statusOrder ?? [],
    hoursPerPoint: cfg.timecockpit?.hoursPerPoint,
    sources: sources.map((s) => s.id),
    herdr: herdr && { spaces, error: herdr.error(), canStart: !!cfg.herdr?.workdir },
    defaultLang: cfg.lang,
  };
}

/** One poll: fetch all sources, diff against the stored state, persist it. */
/** extraTicketKeys: more Jira keys to fetch by key, e.g. the ones herdr spaces are named after. */
export async function update(cfg: Config, sources: Source[], prefs: Prefs, extraTicketKeys: string[] = []): Promise<{ state: State; fresh: Change[]; api: ApiStats }> {
  const path = statePath(cfg);
  const state = await loadState(path);
  const prev = state?.snapshot;
  const memos = { ...state?.memos };
  const now = Date.now();
  const errors: string[] = [];
  const extractKeys = makeKeyExtractor(cfg.jira?.projectKeys ?? []);
  const items = new Map<SourceId, SourceItems>();
  let board = prev?.board;

  const run = async (source: Source, ticketKeys: string[]) => {
    const old = prev && itemsOf(prev, source.id);
    try {
      const r = await source.fetch({
        extractKeys,
        watches: prefs.watches.filter((w) => w.source === source.id),
        ticketKeys,
        prev: old,
        memo: memos[source.id],
        now,
      });
      items.set(source.id, { prs: r.prs ?? [], issues: r.issues ?? [], runs: r.runs ?? [] });
      if (r.memo !== undefined) memos[source.id] = r.memo;
      if (source.id === "jira") board = r.board;
      errors.push(...(r.warnings ?? []).map((w) => `${source.label}: ${w}`));
    } catch (e) {
      errors.push(`${source.label}: ${message(e)}`);
      // Keep what we had: the page stays useful and the next successful poll doesn't report everything as new.
      items.set(source.id, old ?? { prs: [], issues: [], runs: [] });
    }
  };

  // Jira goes last: it also fetches the tickets that PRs of all other sources mention.
  await Promise.all(sources.filter((s) => !s.needsTicketKeys).map((s) => run(s, [])));
  const ticketKeys = [...new Set([...[...items.values()].flatMap((i) => i.prs.flatMap((p) => p.ticketKeys)), ...extraTicketKeys])];
  await Promise.all(sources.filter((s) => s.needsTicketKeys).map((s) => run(s, ticketKeys)));

  if (cfg.timecockpit) {
    const sprint = (items.get("jira")?.issues ?? []).filter((i) => i.scope === "list");
    try {
      const hours = await bookedHours(cfg.timecockpit, sprint.map((i) => i.ref));
      for (const i of sprint) i.bookedHours = hours.get(i.ref) ?? 0;
    } catch (e) {
      errors.push(`time cockpit: ${message(e)}`);
      const old = new Map(prev?.issues.map((i) => [i.id, i.bookedHours]));
      for (const i of sprint) i.bookedHours = old.get(i.id);
    }
  }

  const all = [...items.values()];
  const snapshot: Snapshot = {
    takenAt: new Date(now).toISOString(),
    prs: all.flatMap((i) => i.prs),
    issues: all.flatMap((i) => i.issues),
    runs: all.flatMap((i) => i.runs),
    board: sources.some((s) => s.id === "jira") ? board : undefined,
    errors,
  };
  const fresh = prev ? diff(prev, snapshot) : []; // first run = baseline, no flood of "changes"
  const changes = mergeLog(state?.changes ?? [], fresh, cfg.changesKeepHours);
  const next: State = { version: STATE_VERSION, snapshot, changes, memos };
  await writeAtomic(path, JSON.stringify(next));

  const stamp = new Date().toLocaleTimeString("en-GB");
  // API calls since the last poll – the poll's own plus whatever the page asked for in between
  const api = takeApiStats();
  const hosts = Object.entries(api.calls).map(([h, c]) => `${h.split(".")[0]} ${c.total}`).join(", ");
  const limits = Object.entries(api.limits).map(([h, l]) => `${h.split(".")[0]} ${l} left`).join(", ");
  console.log(
    `[${stamp}] ${snapshot.prs.length} PRs, ${snapshot.issues.length} issues, ${snapshot.runs.length} runs, ${fresh.length} new changes` +
      ` – ${api.total} API calls (${hosts})${limits ? `, rate limits: ${limits}` : ""}${api.throttled ? `, ${api.throttled} THROTTLED` : ""}`,
  );
  for (const e of errors) console.error(`[${stamp}] Error: ${e}`);
  return { state: next, fresh, api };
}
