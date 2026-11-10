import type { Lang } from "./i18n.ts";
import type { Change, Hint, Note, Snapshot, SourceId, Space } from "./model.ts";

/**
 * Everything the page needs, as JSON (GET /api/view, WebSocket /ws), built by buildView in engine.ts.
 * It holds no text in any language – hints and changes are data the page puts into words – so it's
 * the same for everyone. PR ↔ ticket links and the kanban columns are left out: the page derives
 * them (correlate.ts, board.ts).
 */
export type ViewData = {
  snapshot: Snapshot;
  changes: Change[];
  /** muted and resolved ones already left out */
  hints: Hint[];
  /** resource ids */
  muted: string[];
  watched: string[];
  /** my notes, by resource id */
  notes: Record<string, Note>;
  /** change ids of comments handed to an agent */
  sent: string[];
  runsKeepHours: number;
  /** column order for the ticket board when Jira has no board config */
  statusOrder: string[];
  /** time cockpit is on: a ticket's budget is story points × this */
  hoursPerPoint?: number;
  /** configured sources */
  sources: SourceId[];
  /** live herdr state, if HERDR_SOCKET is set */
  herdr?: { spaces: Space[]; error?: string; canStart: boolean };
  /** DASHBOARD_LANG, for a browser that hasn't picked a language yet */
  defaultLang: Lang;
};

/** What the WebSocket at /ws sends. */
export type ServerMessage = { type: "view"; view: ViewData } | { type: "polling" };
