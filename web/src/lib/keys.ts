import { useEffect } from "react";
import { create } from "zustand";
import type { Data } from "./data.ts";
import type { InboxItem } from "./derive.ts";
import { PAGES } from "./hash.ts";
import { useSeen } from "./seen.ts";
import { api } from "./store.ts";
import { useUi } from "./ui.ts";

/** The inbox entry j/k are on (none until j/k is pressed). Kept by resource, so a poll reordering the list doesn't move it. */
export const useCursor = create<{ resource?: string; set(resource?: string): void }>((set) => ({
  set: (resource) => set({ resource }),
}));

/** Typing somewhere, or a dialog/menu is open: the keys belong to that. */
function busy(e: KeyboardEvent) {
  const el = e.target;
  if (el instanceof Element && el.closest("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]")) return true;
  const ui = useUi.getState();
  return !!(ui.agent || ui.threads || ui.start || ui.watch || ui.palette || ui.keys);
}

/** What the keyboard can do with an inbox entry. */
export function act(key: string, item: InboxItem, data: Data) {
  const ui = useUi.getState();
  switch (key) {
    case "Enter":
    case "o":
      if (item.pane) ui.openAgent({ pane: item.pane, label: item.ref });
      else window.open(item.url, "_blank", "noopener");
      // opening something counts as having seen what changed about it, as a click in the feed does
      useSeen.getState().mark(data.view.changes.filter((c) => c.resource === item.resource).map((c) => c.id));
      return true;
    case "e":
      useSeen.getState().mark(data.view.changes.filter((c) => c.resource === item.resource).map((c) => c.id));
      return true;
    case "r":
      void api("POST", "/api/resolve", { id: item.resource }).catch(() => {});
      return true;
    case "n":
      ui.set({ note: item.resource });
      return true;
    case "m":
      void api("POST", "/api/mute", { id: item.resource, muted: !data.muted.has(item.resource) }).catch(() => {});
      return true;
    case "t": {
      const pr = data.prs.get(item.resource);
      const issue = data.issues.get(item.resource);
      if ((pr?.openThreads && pr.threads) || issue?.comments.length) ui.set({ threads: item.resource });
      return true;
    }
  }
  return false;
}

/**
 * The page's shortcuts: Ctrl+K or / searches, ? lists the shortcuts, 1–6 switch pages, and on the
 * inbox j/k walk the entries and Enter/o, e, r, n, m, t act on the one you're on.
 */
export function useShortcuts(data: Data, items: InboxItem[], onInbox: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.set({ palette: !ui.palette });
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || busy(e)) return;
      if (e.key === "/") {
        e.preventDefault();
        ui.set({ palette: true });
        return;
      }
      if (e.key === "?") {
        ui.set({ keys: true });
        return;
      }
      const page = PAGES[Number(e.key) - 1];
      if (/^[1-9]$/.test(e.key) && page) {
        location.hash = page;
        return;
      }
      if (!onInbox || !items.length) return;
      const cursor = useCursor.getState();
      const at = items.findIndex((i) => i.resource === cursor.resource);
      if (e.key === "j" || e.key === "ArrowDown" || e.key === "k" || e.key === "ArrowUp") {
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && at < 0) return; // arrows scroll until j/k picked an entry
        e.preventDefault();
        const down = e.key === "j" || e.key === "ArrowDown";
        const next = at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + (down ? 1 : -1)));
        cursor.set(items[next]!.resource);
        return;
      }
      if (e.key === "Escape") {
        cursor.set(undefined);
        return;
      }
      const item = items[at];
      if (item && act(e.key, item, data)) e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data, items, onInbox]);
}
