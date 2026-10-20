import { join } from "node:path";
import type { Config } from "./config.ts";
import type { Prefs, Snapshot, Watch } from "./model.ts";
import type { Source } from "./sources/types.ts";
import { readJson, writeAtomic } from "./store.ts";

// Watches and mutes are user settings, not a cache – they live in their own file
// so deleting state.json (or a format change) never loses them.

const prefsPath = (cfg: Config) => join(cfg.outDir, "prefs.json");

export async function loadPrefs(cfg: Config): Promise<Prefs> {
  const p = await readJson<Partial<Prefs>>(prefsPath(cfg));
  return { watches: p?.watches ?? [], muted: p?.muted ?? [] };
}

export const savePrefs = (cfg: Config, prefs: Prefs) => writeAtomic(prefsPath(cfg), JSON.stringify(prefs, null, 2));

export type AddWatchResult = { ok: true; watch: Watch } | { ok: false; error: "unsupported" | "exists" };

/** Asks every source whether it knows the link. */
export function addWatch(prefs: Prefs, sources: Source[], rawUrl: string, now = Date.now()): AddWatchResult {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { ok: false, error: "unsupported" };
  }
  for (const source of sources) {
    const target = source.parseWatchUrl(url);
    if (!target) continue;
    if (prefs.watches.some((w) => w.id === target.id)) return { ok: false, error: "exists" };
    const watch: Watch = { ...target, source: source.id, url: url.href, addedAt: new Date(now).toISOString() };
    prefs.watches.push(watch);
    return { ok: true, watch };
  }
  return { ok: false, error: "unsupported" };
}

export function removeWatch(prefs: Prefs, id: string): boolean {
  const before = prefs.watches.length;
  prefs.watches = prefs.watches.filter((w) => w.id !== id);
  return prefs.watches.length !== before;
}

export function setMuted(prefs: Prefs, id: string, muted: boolean) {
  prefs.muted = prefs.muted.filter((m) => m !== id);
  if (muted) prefs.muted.push(id);
}

/** A watched run that finished a while ago has nothing more to say – stop watching it. */
export function pruneFinishedRuns(prefs: Prefs, snapshot: Snapshot, keepHours: number, now = Date.now()): boolean {
  const done = new Set(
    snapshot.runs
      .filter((r) => r.status === "completed" && now - Date.parse(r.updatedAt) > keepHours * 3_600_000)
      .map((r) => r.id),
  );
  const before = prefs.watches.length;
  prefs.watches = prefs.watches.filter((w) => !(w.kind === "run" && done.has(w.id)));
  return prefs.watches.length !== before;
}
