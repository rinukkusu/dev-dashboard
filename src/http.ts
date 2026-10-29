/** HTTP error with status, so callers can e.g. skip a 404. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
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
    throw new Error(`Unreachable: ${shortUrl(url)} (${(e as Error).message})`);
  }

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
