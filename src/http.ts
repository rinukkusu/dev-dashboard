/** HTTP error with status, so callers can e.g. skip a 404. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// --- counting API calls: how many per poll, to what, and how close to the servers' rate limits ---

/** "/org/proj/_apis/git/repositories/3f2a…/pullRequests/412/threads?x" → "/org/proj/_apis/git/repositories/:id/pullRequests/:id/threads" */
export const endpointOf = (url: string) => {
  const u = new URL(url);
  const path = u.pathname
    .split("/")
    // ids, GUIDs, SHAs – not the version in "/rest/api/2/"
    .map((seg, i, all) => (all[i - 1] !== "api" && /^\d+$|^[0-9a-f]{8}-[0-9a-f-]{27}$|^[0-9a-f]{20,}$/i.test(seg) ? ":id" : seg))
    .join("/")
    // project paths in GitLab URLs ("/projects/group%2Fapp/…") and issue keys ("/issue/ABC-1/…")
    .replace(/\/projects\/[^/]+/, "/projects/:id")
    .replace(/\/issue\/[A-Z][A-Z0-9_]*-\d+/, "/issue/:key");
  return path;
};

type Stats = { calls: Map<string, Map<string, number>>; limits: Map<string, string>; throttled: number };
let stats: Stats = { calls: new Map(), limits: new Map(), throttled: 0 };

function count(url: string, method: string, res?: Response) {
  const host = new URL(url).host;
  const byEndpoint = stats.calls.get(host) ?? new Map<string, number>();
  const key = `${method} ${endpointOf(url)}`;
  byEndpoint.set(key, (byEndpoint.get(key) ?? 0) + 1);
  stats.calls.set(host, byEndpoint);
  if (!res) return;
  // GitLab: RateLimit-*, Jira/ADO: X-RateLimit-* (only sent when a limit applies)
  const remaining = res.headers.get("ratelimit-remaining") ?? res.headers.get("x-ratelimit-remaining");
  const limit = res.headers.get("ratelimit-limit") ?? res.headers.get("x-ratelimit-limit");
  if (remaining !== null) stats.limits.set(host, limit ? `${remaining}/${limit}` : remaining);
  if (res.status === 429 || res.headers.has("retry-after") || res.headers.has("x-ratelimit-delay")) stats.throttled++;
}

export type ApiStats = {
  /** calls per host, and per endpoint pattern */
  calls: Record<string, { total: number; endpoints: Record<string, number> }>;
  total: number;
  /** last rate-limit headers per host: "remaining/limit" */
  limits: Record<string, string>;
  /** answers that said "slow down" (429, Retry-After, X-RateLimit-Delay) */
  throttled: number;
};

/** What was called since the last time, and starts counting anew. */
export function takeApiStats(): ApiStats {
  const s = stats;
  stats = { calls: new Map(), limits: new Map(), throttled: 0 };
  const calls: ApiStats["calls"] = {};
  for (const [host, m] of s.calls) {
    const endpoints = Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
    calls[host] = { total: [...m.values()].reduce((a, b) => a + b, 0), endpoints };
  }
  return { calls, total: Object.values(calls).reduce((a, c) => a + c.total, 0), limits: Object.fromEntries(s.limits), throttled: s.throttled };
}

/** Request + JSON with readable errors. Credentials never end up in error messages. */
export async function requestJson<T>(
  url: string,
  headers: Record<string, string>,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    count(url, init.method ?? "GET");
    throw new Error(`Unreachable: ${shortUrl(url)} (${(e as Error).message})`);
  }
  count(url, init.method ?? "GET", res);

  if (!res.ok) {
    const body = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
    throw new HttpError(`${res.status} ${res.statusText} from ${shortUrl(url)}: ${body}`, res.status);
  }

  // Azure DevOps answers an invalid/expired PAT with 203 + an HTML login page.
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new HttpError(`No JSON from ${shortUrl(url)} (HTTP ${res.status}) – PAT invalid or expired?`, res.status);
  }
  return (await res.json()) as T;
}

export const getJson = <T>(url: string, headers: Record<string, string>) => requestJson<T>(url, headers);

/** Runs fn over items with at most `limit` requests in flight. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const shortUrl = (url: string) => {
  const u = new URL(url);
  return u.origin + u.pathname;
};

/**
 * Normalizes timestamps to UTC ISO. Jira sends "2026-10-19T18:20:00.000+0200",
 * ADO sends 7 fractional digits. Not every JS engine parses either, so normalize first.
 */
export const iso = (s: string) =>
  new Date(s.replace(/(\.\d{3})\d+/, "$1").replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).toISOString();

/** Collapses whitespace and cuts long comment bodies for display. */
export const preview = (text: string, max = 280) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
};

/** Markdown → one readable line. */
export const cleanMarkdown = (s: string) =>
  preview(
    s
      .replace(/<!--[\s\S]*?-->/g, " ") // hidden template comments
      .replace(/```[\s\S]*?```/g, " [code] ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings, but keep "#7" references
      .replace(/^\s*>\s?/gm, "") // quotes
      .replace(/\*\*|__|`/g, ""),
  );

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
