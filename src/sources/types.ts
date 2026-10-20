import type { KeyExtractor } from "../correlate.ts";
import type { Issue, PullRequest, Run, SourceId, Watch } from "../model.ts";

export type SourceItems = { prs: PullRequest[]; issues: Issue[]; runs: Run[] };

export type FetchContext = {
  extractKeys: KeyExtractor;
  /** watches added by hand for this source */
  watches: Watch[];
  /** Jira keys referenced by PRs of all sources (only filled for sources with needsTicketKeys) */
  ticketKeys: string[];
  /** this source's items from the previous poll, e.g. to only look closer at what changed */
  prev?: SourceItems;
  /** whatever this source returned as memo last time (survives restarts) */
  memo: unknown;
  now: number;
};

export type FetchResult = Partial<SourceItems> & {
  memo?: unknown;
  /** partial failures (e.g. one watched item gone) that shouldn't throw away the rest */
  warnings?: string[];
};

/** What a source makes of a pasted link; becomes a Watch. */
export type WatchTarget = Pick<Watch, "id" | "kind" | "locator">;

/**
 * A data source. To add one: implement this, create it in sources/index.ts when its token is set.
 * Ids of PRs/issues/runs must be prefixed with the source id so they never collide.
 */
export type Source = {
  id: SourceId;
  /** shown in error messages */
  label: string;
  /** runs after the other sources and gets the Jira keys their PRs mention */
  needsTicketKeys?: boolean;
  fetch(ctx: FetchContext): Promise<FetchResult>;
  /** recognizes links to this source's PRs/issues/runs for "+ Watch" */
  parseWatchUrl(url: URL): WatchTarget | undefined;
};

/** "https://host/base/" → "https://host/base", lower-cased for prefix checks. */
export const normBase = (url: string) => url.replace(/\/+$/, "").toLowerCase();

/** Path of `url` below `base`, or undefined if it's on another host/prefix. */
export function pathBelow(url: URL, base: string): string | undefined {
  const full = (url.origin + url.pathname).toLowerCase();
  const b = normBase(base);
  if (full !== b && !full.startsWith(b + "/")) return undefined;
  // keep the original casing of the rest (repo names, Jira keys)
  return (url.origin + url.pathname).slice(b.length);
}
