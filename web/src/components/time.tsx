import { useSyncExternalStore } from "react";
import { ago, useT } from "@/lib/i18n";

// One clock for all relative times: ticks every 30 s, so "5 min ago" stays right between updates.
let now = Date.now();
const listeners = new Set<() => void>();
setInterval(() => {
  now = Date.now();
  listeners.forEach((l) => l());
}, 30_000);
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useNow = () => useSyncExternalStore(subscribe, () => now);

/** "5 min ago", with the full date and time on hover. */
export function Ago({ iso, className }: { iso: string; className?: string }) {
  const t = useT();
  const current = useNow();
  const full = new Intl.DateTimeFormat(t.locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <time dateTime={iso} title={full.format(new Date(iso))} className={className}>
      {ago(t, iso, current)}
    </time>
  );
}
