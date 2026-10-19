import { isLang, LANGS, type Lang } from "./i18n.ts";

export type JiraConfig = {
  baseUrl: string;
  pat: string;
  jql: string;
  projectKeys: string[];
  postMergeStatuses: string[];
};

export type AdoConfig = {
  orgUrl: string;
  project: string;
  pat: string;
  apiVersion: string;
  userId?: string;
  mergedLookbackDays: number;
};

export type Config = {
  jira?: JiraConfig;
  ado?: AdoConfig;
  outDir: string;
  refreshSeconds: number;
  changesKeepHours: number;
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

export function loadConfig(env: Env = Bun.env): Config {
  const get = (name: string, fallback?: string): string => {
    const v = env[name]?.trim();
    if (v) return v;
    if (fallback !== undefined) return fallback;
    throw new Error(`Environment variable ${name} is missing (see .env.example)`);
  };
  const num = (name: string, fallback: number) => {
    const n = Number(env[name]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const jira: JiraConfig | undefined = env.JIRA_BASE_URL?.trim()
    ? {
        baseUrl: trimSlash(get("JIRA_BASE_URL")),
        pat: get("JIRA_PAT"),
        jql: get(
          "JIRA_JQL",
          "sprint in openSprints() AND assignee = currentUser() ORDER BY updated DESC",
        ),
        projectKeys: list(get("JIRA_PROJECT_KEYS", "")).map((k) => k.toUpperCase()),
        postMergeStatuses: list(
          get("JIRA_POST_MERGE_STATUSES", "In Test,Testing,Ready for Test,Done,Closed,Resolved"),
        ).map((s) => s.toLowerCase()),
      }
    : undefined;

  const ado: AdoConfig | undefined = env.ADO_ORG_URL?.trim()
    ? {
        orgUrl: trimSlash(get("ADO_ORG_URL")),
        project: get("ADO_PROJECT"),
        pat: get("ADO_PAT"),
        apiVersion: get("ADO_API_VERSION", "7.1"),
        userId: env.ADO_USER_ID?.trim() || undefined,
        mergedLookbackDays: num("ADO_MERGED_LOOKBACK_DAYS", 14),
      }
    : undefined;

  if (!jira && !ado) {
    throw new Error("Neither JIRA_BASE_URL nor ADO_ORG_URL is set – nothing to do (see .env.example)");
  }

  const lang = (env.DASHBOARD_LANG?.trim().toLowerCase() || "en") as string;
  if (!isLang(lang)) throw new Error(`DASHBOARD_LANG must be one of ${LANGS.join(", ")}, got "${lang}"`);

  return {
    jira,
    ado,
    outDir: get("OUT_DIR", "./out"),
    refreshSeconds: num("REFRESH_SECONDS", 300),
    changesKeepHours: num("CHANGES_KEEP_HOURS", 48),
    loopMinutes: num("LOOP_MINUTES", 5),
    lang,
    host: get("HOST", "127.0.0.1"),
    port: num("PORT", 3000),
    pollSeconds: num("POLL_SECONDS", 120),
  };
}
