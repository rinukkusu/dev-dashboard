import { isLang, LANGS, type Lang } from "./i18n.ts";

export type JiraConfig = {
  baseUrl: string;
  pat: string;
  jql: string;
  /** issues I'm involved in beyond the main list; empty = off */
  involvedJql: string;
  projectKeys: string[];
  postMergeStatuses: string[];
  /** boards for the kanban columns; empty = find them from the sprint tickets' projects */
  boardIds: string[];
  /** lower-case status names, column order when there's no board config */
  statusOrder: string[];
};

export type AdoConfig = {
  orgUrl: string;
  /** one or more projects; PRs and builds are listed per project */
  projects: string[];
  pat: string;
  apiVersion: string;
  userId?: string;
  mergedLookbackDays: number;
  /** how often to look for PRs I commented on; 0 = off */
  discoverMinutes: number;
  runsKeepHours: number;
};

export type GithubConfig = {
  id: "github" | "ghe";
  label: string;
  /** where links point to, e.g. https://github.com */
  webUrl: string;
  /** REST base, e.g. https://api.github.com */
  apiUrl: string;
  graphqlUrl: string;
  token: string;
  /** how far back "involved" PRs/issues count */
  lookbackDays: number;
  runsKeepHours: number;
};

export type Config = {
  jira?: JiraConfig;
  ado?: AdoConfig;
  github?: GithubConfig;
  ghe?: GithubConfig;
  outDir: string;
  refreshSeconds: number;
  changesKeepHours: number;
  /** CI runs younger than this are listed (and fetched) */
  runsKeepHours: number;
  loopMinutes: number;
  /** default UI language; in the live server a browser can switch (cookie) */
  lang: Lang;
  /** live server (src/server.ts) */
  host: string;
  port: number;
  pollSeconds: number;
};

type Env = Record<string, string | undefined>;

const list = (s: string) =>
  s.split(",").map((x) => x.trim()).filter(Boolean);

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** A source is on as soon as its token is set; everything else it needs is then required. */
export function loadConfig(env: Env = Bun.env): Config {
  const get = (name: string, fallback?: string): string => {
    const v = env[name]?.trim();
    if (v) return v;
    if (fallback !== undefined) return fallback;
    throw new Error(`Environment variable ${name} is missing (see .env.example)`);
  };
  const num = (name: string, fallback: number, { allowZero = false } = {}) => {
    const raw = env[name]?.trim();
    const n = Number(raw);
    return raw && Number.isFinite(n) && (n > 0 || (allowZero && n === 0)) ? n : fallback;
  };
  const has = (name: string) => !!env[name]?.trim();

  const runsKeepHours = num("RUNS_KEEP_HOURS", 24);
  const githubLookbackDays = num("GITHUB_LOOKBACK_DAYS", 14);

  const jira: JiraConfig | undefined = has("JIRA_PAT")
    ? {
        baseUrl: trimSlash(get("JIRA_BASE_URL")),
        pat: get("JIRA_PAT"),
        jql: get("JIRA_JQL", "sprint in openSprints() AND assignee = currentUser() ORDER BY updated DESC"),
        // Set but empty = off; you become a watcher automatically when you comment.
        involvedJql:
          env.JIRA_INVOLVED_JQL !== undefined
            ? env.JIRA_INVOLVED_JQL.trim()
            : "watcher = currentUser() AND updated >= -14d ORDER BY updated DESC",
        projectKeys: list(get("JIRA_PROJECT_KEYS", "")).map((k) => k.toUpperCase()),
        postMergeStatuses: list(
          get("JIRA_POST_MERGE_STATUSES", "In Test,Testing,Ready for Test,Done,Closed,Resolved"),
        ).map((s) => s.toLowerCase()),
        boardIds: list(get("JIRA_BOARD_IDS", "")),
        statusOrder: list(get("JIRA_STATUS_ORDER", "")).map((s) => s.toLowerCase()),
      }
    : undefined;

  const ado: AdoConfig | undefined = has("ADO_PAT")
    ? {
        orgUrl: trimSlash(get("ADO_ORG_URL")),
        projects: list(get("ADO_PROJECT")),
        pat: get("ADO_PAT"),
        apiVersion: get("ADO_API_VERSION", "7.1"),
        userId: env.ADO_USER_ID?.trim() || undefined,
        mergedLookbackDays: num("ADO_MERGED_LOOKBACK_DAYS", 14),
        discoverMinutes: num("ADO_DISCOVER_MINUTES", 15, { allowZero: true }),
        runsKeepHours,
      }
    : undefined;

  const github: GithubConfig | undefined = has("GITHUB_TOKEN")
    ? {
        id: "github",
        label: "GitHub",
        webUrl: "https://github.com",
        apiUrl: "https://api.github.com",
        graphqlUrl: "https://api.github.com/graphql",
        token: get("GITHUB_TOKEN"),
        lookbackDays: githubLookbackDays,
        runsKeepHours,
      }
    : undefined;

  const gheUrl = has("GHE_TOKEN") ? trimSlash(get("GHE_URL")) : "";
  const ghe: GithubConfig | undefined = gheUrl
    ? {
        id: "ghe",
        label: get("GHE_LABEL", "GitHub Enterprise"),
        webUrl: gheUrl,
        apiUrl: `${gheUrl}/api/v3`,
        graphqlUrl: `${gheUrl}/api/graphql`,
        token: get("GHE_TOKEN"),
        lookbackDays: githubLookbackDays,
        runsKeepHours,
      }
    : undefined;

  if (!jira && !ado && !github && !ghe) {
    throw new Error("No source configured – set at least one of JIRA_PAT, ADO_PAT, GITHUB_TOKEN, GHE_TOKEN (see .env.example)");
  }

  const lang = (env.DASHBOARD_LANG?.trim().toLowerCase() || "en") as string;
  if (!isLang(lang)) throw new Error(`DASHBOARD_LANG must be one of ${LANGS.join(", ")}, got "${lang}"`);

  return {
    jira,
    ado,
    github,
    ghe,
    outDir: get("OUT_DIR", "./out"),
    refreshSeconds: num("REFRESH_SECONDS", 300),
    changesKeepHours: num("CHANGES_KEEP_HOURS", 48),
    runsKeepHours,
    loopMinutes: num("LOOP_MINUTES", 5),
    lang,
    host: get("HOST", "127.0.0.1"),
    port: num("PORT", 3000),
    pollSeconds: num("POLL_SECONDS", 120),
  };
}
