// localStorage that never throws (private windows, blocked site data). The keys are the old page's,
// so seen changes, the sound setting and closed sections carry over.
export const KEYS = {
  lastSeen: "dev-dashboard.lastSeen",
  seenIds: "dev-dashboard.seenIds",
  sound: "dev-dashboard.sound",
  sections: "dev-dashboard.sections",
  feed: "dev-dashboard.feed",
  notify: "dev-dashboard.notify",
} as const;

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  json<T>(key: string, fallback: T): T {
    try {
      return (JSON.parse(storage.get(key) ?? "null") as T) ?? fallback;
    } catch {
      return fallback;
    }
  },
};
