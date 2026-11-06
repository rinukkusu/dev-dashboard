import { useState } from "react";
import { KEYS, storage } from "./storage.ts";

/** Open/closed of a collapsible list, remembered per browser (same key as the old page). */
export function useSection(id: string, defaultOpen = true): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => storage.json<Record<string, boolean>>(KEYS.sections, {})[id] ?? defaultOpen);
  return [
    open,
    (next) => {
      const all = storage.json<Record<string, boolean>>(KEYS.sections, {});
      all[id] = next;
      storage.set(KEYS.sections, JSON.stringify(all));
      setOpen(next);
    },
  ];
}
