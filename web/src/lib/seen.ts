import type { Change } from "@shared/model.ts";
import { create } from "zustand";
import { KEYS, storage } from "./storage.ts";

/**
 * Which changes are new to this browser. "Mark all seen" stores a time; single entries marked on top
 * of that are kept as ids (and forgotten once they leave the change log).
 */
type Seen = {
  lastSeen: number;
  ids: Set<string>;
  markAll(): void;
  mark(ids: string[]): void;
  /** drop ids of changes that are gone */
  prune(present: Change[]): void;
};

export const useSeen = create<Seen>((set, get) => ({
  lastSeen: Number(storage.get(KEYS.lastSeen)) || 0,
  ids: new Set(storage.json<string[]>(KEYS.seenIds, [])),
  markAll() {
    const now = Date.now();
    storage.set(KEYS.lastSeen, String(now));
    storage.set(KEYS.seenIds, "[]");
    set({ lastSeen: now, ids: new Set() });
  },
  mark(ids) {
    if (!ids.length) return;
    const next = new Set(get().ids);
    ids.forEach((id) => next.add(id));
    storage.set(KEYS.seenIds, JSON.stringify([...next]));
    set({ ids: next });
  },
  prune(present) {
    const have = new Set(present.map((c) => c.id));
    const kept = [...get().ids].filter((id) => have.has(id));
    if (kept.length === get().ids.size) return;
    storage.set(KEYS.seenIds, JSON.stringify(kept));
    set({ ids: new Set(kept) });
  },
}));

/** When a change counts as arrived: when the poll found it, not when it happened. */
export const arrivedAt = (c: Change) => Date.parse(c.detectedAt ?? c.at);

/** New to me: arrived after "mark all seen", not marked on its own – and not muted (those never count). */
export const isUnseen = (c: Change, s: { lastSeen: number; ids: Set<string> }, muted: Set<string>) =>
  !(c.resource && muted.has(c.resource)) && arrivedAt(c) > s.lastSeen && !s.ids.has(c.id);

/** What opening a change marks: every unseen change about the same PR/issue/run. */
export const sameThing = (c: Change) => c.resource ?? c.url;
