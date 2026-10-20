import { join } from "node:path";
import type { Config } from "./config.ts";
import { link, makeKeyExtractor } from "./correlate.ts";
import { diff, mergeLog } from "./diff.ts";
import { message } from "./http.ts";
import { dict, type Lang } from "./i18n.ts";
import type { Change, Prefs, Snapshot, SourceId } from "./model.ts";
import type { View } from "./render.ts";
import { evaluate } from "./rules.ts";
import type { Source, SourceItems } from "./sources/types.ts";
import { readJson, writeAtomic } from "./store.ts";

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

/** Everything the page needs, derived from a stored state, in one language. */
export function buildView(cfg: Config, state: State, prefs: Prefs, sources: Source[], lang: Lang = cfg.lang): View {
  const { snapshot, changes } = state;
  const muted = new Set(prefs.muted);
  const links = link(snapshot.prs, snapshot.issues);
  const hints = evaluate(snapshot, {
    ...links,
    postMergeStatuses: cfg.jira?.postMergeStatuses ?? [],
    now: Date.now(),
    t: dict(lang),
  }).filter((h) => !muted.has(h.resource));
  return {
    lang,
    snapshot,
    changes,
    hints,
    links,
    muted,
    watched: new Set(prefs.watches.map((w) => w.id)),
    refreshSeconds: cfg.refreshSeconds,
    runsKeepHours: cfg.runsKeepHours,
    statusOrder: cfg.jira?.statusOrder ?? [],
    sources: sources.map((s) => s.id),
  };
}

/** One poll: fetch all sources, diff against the stored state, persist it. */
export async function update(cfg: Config, sources: Source[], prefs: Prefs): Promise<{ state: State; fresh: Change[] }> {
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
  const ticketKeys = [...new Set([...items.values()].flatMap((i) => i.prs.flatMap((p) => p.ticketKeys)))];
  await Promise.all(sources.filter((s) => s.needsTicketKeys).map((s) => run(s, ticketKeys)));

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
  console.log(
    `[${stamp}] ${snapshot.prs.length} PRs, ${snapshot.issues.length} issues, ${snapshot.runs.length} runs, ${fresh.length} new changes`,
  );
  for (const e of errors) console.error(`[${stamp}] Error: ${e}`);
  return { state: next, fresh };
}
