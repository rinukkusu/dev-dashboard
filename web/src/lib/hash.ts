import { useSyncExternalStore } from "react";

export const PAGES = ["inbox", "board", "prs", "issues", "runs", "spaces"] as const;
export type Page = (typeof PAGES)[number];

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

/** The page is the URL's #hash, so every page can be bookmarked; the inbox is the default. */
export function usePage(): Page {
  const hash = useSyncExternalStore(subscribe, () => location.hash.slice(1));
  return (PAGES as readonly string[]).includes(hash) ? (hash as Page) : "inbox";
}
