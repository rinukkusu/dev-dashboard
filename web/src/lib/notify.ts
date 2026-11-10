import type { Hint, HintReason } from "@shared/model.ts";
import { create } from "zustand";
import { KEYS, storage } from "./storage.ts";

// Desktop notifications for what shouldn't wait until you look at the tab again: an agent asking
// something, a review for you, a rejected PR, a failed run. Only while the tab is in the background.

export const NOTIFY_REASONS: ReadonlySet<HintReason> = new Set(["agent-blocked", "review", "waiting", "rejected", "run-failed"]);

type Permission = NotificationPermission | "unsupported";
const permission = (): Permission => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

type Notify = { on: boolean; permission: Permission; toggle(): Promise<void> };

export const useNotify = create<Notify>((set, get) => ({
  on: storage.get(KEYS.notify) === "on" && permission() === "granted",
  permission: permission(),
  async toggle() {
    if (get().on) {
      storage.set(KEYS.notify, "off");
      set({ on: false });
      return;
    }
    if (permission() === "unsupported") return;
    const p = permission() === "default" ? await Notification.requestPermission() : permission();
    const on = p === "granted";
    storage.set(KEYS.notify, on ? "on" : "off");
    set({ on, permission: p });
  },
}));

/** One key per thing to be told about once: the same hint in the next poll isn't news. */
export const notifyKey = (h: Hint) => `${h.resource}|${h.reason}`;

/** The hints worth a notification that weren't there before. */
export function freshHints(hints: Hint[], before: Set<string>, muted: Set<string>): Hint[] {
  const seen = new Set<string>();
  return hints.filter((h) => {
    const key = notifyKey(h);
    if (!NOTIFY_REASONS.has(h.reason) || muted.has(h.resource) || before.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function notify(title: string, body: string, tag: string, onClick: () => void) {
  if (!useNotify.getState().on || permission() !== "granted" || !document.hidden) return;
  try {
    const n = new Notification(title, { body, tag, icon: document.querySelector<HTMLLinkElement>("link[rel=icon]")?.href });
    n.onclick = () => {
      window.focus();
      onClick();
      n.close();
    };
  } catch {} // e.g. Chrome on Android wants a service worker for this
}
