import type { Links } from "./correlate.ts";
import type { Lang } from "./i18n.ts";
import type { Change, Hint, Snapshot, SourceId, Space } from "./model.ts";

/** Everything the page needs, derived from the stored state and prefs (see buildView in engine.ts). */
export type View = {
  lang: Lang;
  snapshot: Snapshot;
  changes: Change[];
  hints: Hint[];
  links: Links;
  /** resource ids */
  muted: Set<string>;
  watched: Set<string>;
  refreshSeconds: number;
  runsKeepHours: number;
  /** column order for the ticket board when Jira has no board config */
  statusOrder: string[];
  /** time cockpit is on: a ticket's budget is story points × this */
  hoursPerPoint?: number;
  /** configured sources */
  sources: SourceId[];
  /** live herdr state, if HERDR_SOCKET is set */
  herdr?: { spaces: Space[]; error?: string; canStart: boolean };
  /** change ids of comments sent to an agent */
  sent: Set<string>;
};

/**
 * The view as JSON for the web app (GET /api/view, WebSocket /ws?v=2). It holds no text in any
 * language – hints and changes are data, the page translates them – so it's the same for everyone.
 * PR ↔ ticket links and the kanban columns are left out: the page derives them (correlate.ts, board.ts).
 */
export type ViewData = {
  snapshot: Snapshot;
  changes: Change[];
  hints: Hint[];
  muted: string[];
  watched: string[];
  sent: string[];
  runsKeepHours: number;
  statusOrder: string[];
  hoursPerPoint?: number;
  sources: SourceId[];
  herdr?: { spaces: Space[]; error?: string; canStart: boolean };
  /** DASHBOARD_LANG, for a browser that hasn't picked a language yet */
  defaultLang: Lang;
};

export const toViewData = (v: View, defaultLang: Lang): ViewData => ({
  snapshot: v.snapshot,
  changes: v.changes,
  hints: v.hints,
  muted: [...v.muted],
  watched: [...v.watched],
  sent: [...v.sent],
  runsKeepHours: v.runsKeepHours,
  statusOrder: v.statusOrder,
  hoursPerPoint: v.hoursPerPoint,
  sources: v.sources,
  herdr: v.herdr,
  defaultLang,
});

/** What the WebSocket at /ws?v=2 sends. */
export type ServerMessage = { type: "view"; view: ViewData } | { type: "polling" };
