import { dict, type Dict } from "@shared/i18n.ts";
import { useLang } from "./store.ts";

export const useT = (): Dict => dict(useLang());

export const fill = (s: string, n: number | string) => s.replace("{n}", String(n));

/** "5 min ago", "yesterday", … – the same wording as the old page */
export function ago(t: Dict, iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60_000);
  if (min < 1) return t.client.now;
  if (min < 60) return fill(t.client.minutes, min);
  const h = Math.round(min / 60);
  if (h < 24) return fill(t.client.hours, h);
  const d = Math.round(h / 24);
  return d === 1 ? t.client.yesterday : fill(t.client.days, d);
}
