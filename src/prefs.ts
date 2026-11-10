import { join } from "node:path";
import type { Config } from "./config.ts";
import type { Change, Hint, Prefs, Resolved, Snapshot, Watch } from "./model.ts";

export const NOTE_MAX = 2000;
import type { Source } from "./sources/types.ts";
import { readJson, writeAtomic } from "./store.ts";

// Watches and mutes are user settings, not a cache – they live in their own file
// so deleting state.json (or a format change) never loses them.

const prefsPath = (cfg: Config) => join(cfg.outDir, "prefs.json");

export async function loadPrefs(cfg: Config): Promise<Prefs> {
  const p = await readJson<Partial<Prefs>>(prefsPath(cfg));
  return { watches: p?.watches ?? [], muted: p?.muted ?? [], sent: p?.sent ?? [], routes: p?.routes ?? {}, jobs: p?.jobs ?? [], resolved: p?.resolved ?? [], notes: p?.notes ?? {} };
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

/** Remembers that a comment went to an agent; only the newest few hundred are worth keeping. */
export function markSent(prefs: Prefs, changeId: string) {
  prefs.sent = [...prefs.sent.filter((id) => id !== changeId), changeId].slice(-500);
}

export function setMuted(prefs: Prefs, id: string, muted: boolean) {
  prefs.muted = prefs.muted.filter((m) => m !== id);
  if (muted) prefs.muted.push(id);
}

/** Writes a note on a resource; an empty one removes it. */
export function setNote(prefs: Prefs, id: string, text: string, now = Date.now()) {
  const clean = text.trim().slice(0, NOTE_MAX);
  if (clean) prefs.notes[id] = { text: clean, at: new Date(now).toISOString() };
  else delete prefs.notes[id];
}

/** What a hint says – the agent job riding along isn't part of it, that one has its own "read". */
export const hintSig = (h: Hint) => `${h.reason}:${JSON.stringify(h.msg)}`;

/** Sets the resource's current to-dos aside (hints = its hints, unfiltered). */
export function resolveHints(prefs: Prefs, resource: string, hints: Hint[], now = Date.now()) {
  prefs.resolved = prefs.resolved.filter((r) => r.resource !== resource);
  prefs.resolved.push({ resource, at: new Date(now).toISOString(), sigs: [...new Set(hints.map(hintSig))] });
}

/**
 * The resolves that still hold: the resource still has to-dos, all of them as they were, and nothing
 * new came in about it since. The others are over – the to-dos are back, or gone, so they come back
 * when they turn up again. (hints = all current hints, unfiltered)
 */
export function holdingResolves(resolved: Resolved[], hints: Hint[], changes: Change[]): Resolved[] {
  return resolved.filter((r) => {
    const own = hints.filter((h) => h.resource === r.resource);
    if (!own.length || own.some((h) => !r.sigs.includes(hintSig(h)))) return false;
    const at = Date.parse(r.at);
    return !changes.some((c) => c.resource === r.resource && Date.parse(c.detectedAt ?? c.at) > at);
  });
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
