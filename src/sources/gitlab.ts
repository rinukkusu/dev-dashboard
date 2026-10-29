import type { GitlabConfig } from "../config.ts";
import { cleanMarkdown, HttpError, iso, mapLimit, message, requestJson } from "../http.ts";
import type { Checks, Comment, PullRequest, Reviewer, Run, RunConclusion, RunStatus, Vote } from "../model.ts";
import { pathBelow, type FetchContext, type FetchResult, type Source, type WatchTarget } from "./types.ts";

// GitLab.com and self-managed GitLab, REST API v4. Merge requests become PRs, pipelines become runs.
// GitLab can't search for "MRs I commented on", but the user's event feed lists those comments,
// approvals and pushes – that's what "involved" and the repos for pipelines are taken from.

// --- Raw API shapes (only the fields we use) -------------------------------

type RawUser = { id: number; username: string; name: string };

type RawMr = {
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: "opened" | "closed" | "merged" | "locked";
  draft: boolean;
  has_conflicts: boolean;
  source_branch: string;
  target_branch: string;
  web_url: string;
  references: { full: string };
  author: RawUser;
  reviewers?: RawUser[];
  merge_user?: RawUser | null;
  merged_by?: RawUser | null;
  closed_by?: RawUser | null;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  /** only in the single-MR response */
  head_pipeline?: { status: string } | null;
};

type RawNote = { id: number; body: string; author: RawUser; created_at: string; system: boolean; resolvable: boolean; resolved?: boolean };
type RawDiscussion = { id: string; notes: RawNote[] };
type RawReviewer = { user: RawUser; state: string };
type RawApprovals = { approved_by: { user: RawUser }[] };

type RawPipeline = {
  id: number;
  iid: number;
  project_id: number;
  sha: string;
  ref: string;
  status: string;
  name?: string | null;
  web_url: string;
  created_at: string;
  updated_at: string;
  /** only in the single-pipeline response */
  user?: RawUser;
};

type RawEvent = {
  project_id: number;
  action_name: string;
  target_type: string | null;
  target_iid: number | null;
  created_at: string;
  note?: { noteable_type: string; noteable_iid: number | null };
  push_data?: { commit_to: string | null } | null;
};

/** Remembered between polls. */
type Memo = { userId?: number; username?: string; commitTitles?: Record<string, string> };

// --- Mapping ---------------------------------------------------------------

const REVIEW_STATES: Record<string, Vote> = { approved: "approved", requested_changes: "waiting" };

const CHECKS: Record<string, Checks> = {
  success: "success",
  failed: "failure",
  created: "pending",
  waiting_for_resource: "pending",
  preparing: "pending",
  waiting_for_callback: "pending",
  pending: "pending",
  running: "pending",
  scheduled: "pending",
};

const PIPELINE_STATUS: Record<string, RunStatus> = {
  running: "running",
  canceling: "running",
  success: "completed",
  failed: "completed",
  canceled: "completed",
  skipped: "completed",
  manual: "completed",
};

const PIPELINE_CONCLUSION: Record<string, RunConclusion> = {
  success: "success",
  failed: "failure",
  canceled: "cancelled",
  skipped: "skipped",
  manual: "neutral",
};

/** "group/sub/app!12" → "group/sub/app" */
const projectPath = (mr: RawMr) => mr.references.full.replace(/!\d+$/, "");
/** "https://host/group/app/-/pipelines/5" → "group/app" */
const pipelineProject = (p: RawPipeline, webUrl: string) => pathBelow(new URL(p.web_url), webUrl)?.replace(/^\/|\/-\/pipelines\/\d+$/g, "") ?? "";
const lastSegment = (path: string) => path.split("/").at(-1) ?? path;

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function createGitlabSource(cfg: GitlabConfig): Source {
  // project paths are case-insensitive on GitLab, links and API can differ → lower-case ids
  const mrId = (path: string, iid: number | string) => `gitlab:${path.toLowerCase()}!${iid}`;
  const runId = (id: number | string) => `gitlab:pipeline:${id}`;

  const headers = { "PRIVATE-TOKEN": cfg.token };
  const get = <T>(path: string) => requestJson<T>(`${cfg.apiUrl}${path}`, headers);
  const project = (idOrPath: number | string) => `/projects/${encodeURIComponent(String(idOrPath))}`;

  function mapMr(
    raw: RawMr,
    role: PullRequest["role"],
    me: number,
    ctx: FetchContext,
    details?: { discussions: RawDiscussion[]; reviewers: RawReviewer[]; approvals: RawApprovals },
  ): PullRequest {
    const path = projectPath(raw);

    // Assigned reviewers with their review state, plus anyone else who approved.
    const reviewers = new Map<number, Reviewer>();
    const addReviewer = (u: RawUser, vote: Vote) =>
      reviewers.set(u.id, { id: String(u.id), name: u.name, vote, required: false, isGroup: false, isMe: u.id === me });
    for (const u of raw.reviewers ?? []) addReviewer(u, "none");
    for (const r of details?.reviewers ?? []) addReviewer(r.user, REVIEW_STATES[r.state] ?? "none");
    for (const { user } of details?.approvals.approved_by ?? []) addReviewer(user, "approved");
    reviewers.delete(raw.author.id);

    const discussions = (details?.discussions ?? []).filter((d) => d.notes.some((n) => !n.system));
    const comments: Comment[] = discussions
      .flatMap((d) =>
        d.notes
          .filter((n) => !n.system)
          .map((n) => ({
            id: `${d.id}:${n.id}`,
            author: n.author.name,
            authorIsMe: n.author.id === me,
            text: cleanMarkdown(n.body),
            at: iso(n.created_at),
          })),
      )
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    const closer = raw.state === "merged" ? (raw.merge_user ?? raw.merged_by) : raw.state === "closed" ? raw.closed_by : undefined;
    const closedAt = raw.merged_at ?? raw.closed_at;
    const pipeline = raw.head_pipeline?.status;

    return {
      id: mrId(path, raw.iid),
      source: "gitlab",
      ref: `${lastSegment(path)}!${raw.iid}`,
      number: raw.iid,
      title: raw.title,
      url: raw.web_url,
      repo: path,
      branch: raw.source_branch,
      targetBranch: raw.target_branch,
      author: raw.author.name,
      role,
      status: raw.state === "merged" ? "completed" : raw.state === "closed" ? "abandoned" : "active",
      closedByMe: closer?.id === me,
      createdAt: iso(raw.created_at),
      closedAt: closedAt ? iso(closedAt) : undefined,
      isDraft: raw.draft,
      hasConflicts: raw.has_conflicts,
      checks: pipeline ? CHECKS[pipeline] : undefined,
      reviewers: [...reviewers.values()],
      openThreads: discussions.filter((d) => d.notes.some((n) => n.resolvable && !n.resolved)).length,
      comments,
      ticketKeys: ctx.extractKeys(`${raw.title} ${raw.source_branch} ${raw.description ?? ""}`),
    };
  }

  /** Open MRs get the full picture (pipeline, threads, votes); closed ones only need the basics. */
  async function withDetails(raw: RawMr) {
    if (raw.state !== "opened" && raw.state !== "locked") return { raw };
    const base = `${project(raw.project_id)}/merge_requests/${raw.iid}`;
    const [full, discussions, reviewers, approvals] = await Promise.all([
      get<RawMr>(base),
      get<RawDiscussion[]>(`${base}/discussions?per_page=100`),
      get<RawReviewer[]>(`${base}/reviewers`).catch(() => [] as RawReviewer[]), // older GitLab: no review states
      get<RawApprovals>(`${base}/approvals`).catch(() => ({ approved_by: [] })), // not on every tier
    ]);
    return { raw: full, details: { discussions, reviewers, approvals } };
  }

  /** My recent activity: comments and approvals on MRs (→ "involved"), pushes (→ where to look for pipelines). */
  async function fetchEvents(since: number, warnings: string[]) {
    // `after` is a date and exclusive, so ask from the day before
    const after = day(since - 86_400_000);
    const events: RawEvent[] = [];
    try {
      for (let page = 1; page <= 3; page++) {
        const batch = await get<RawEvent[]>(`/events?after=${after}&per_page=100&page=${page}`);
        events.push(...batch);
        if (batch.length < 100) break;
      }
    } catch (e) {
      warnings.push(`activity: ${message(e)}`);
    }
    return events.filter((e) => Date.parse(e.created_at) >= since);
  }

  async function fetchMrs(me: number, ctx: FetchContext, events: RawEvent[], warnings: string[]) {
    const cutoff = new Date(ctx.now - cfg.lookbackDays * 86_400_000).toISOString();
    const [mine, toReview, merged] = await Promise.all([
      get<RawMr[]>(`/merge_requests?scope=created_by_me&state=opened&per_page=100`),
      get<RawMr[]>(`/merge_requests?scope=all&state=opened&reviewer_id=${me}&per_page=100`),
      get<RawMr[]>(`/merge_requests?scope=created_by_me&state=merged&updated_after=${cutoff}&per_page=50`),
    ]);

    // First role wins: author > reviewer > watched > involved.
    const jobs = new Map<string, { raw: RawMr; role: PullRequest["role"] }>();
    const add = (raw: RawMr, role: PullRequest["role"]) => {
      const id = mrId(projectPath(raw), raw.iid);
      if (!jobs.has(id)) jobs.set(id, { raw, role });
    };
    for (const mr of mine) add(mr, "author");
    for (const mr of toReview) if (mr.author.id !== me) add(mr, "reviewer");
    for (const mr of merged) add(mr, "author");

    const watches = ctx.watches.filter((w) => w.kind === "pr");
    const involved = new Map<string, { project: number; iid: number }>();
    for (const e of events) {
      const iid = e.note?.noteable_type === "MergeRequest" ? e.note.noteable_iid : e.target_type === "MergeRequest" && e.action_name === "approved" ? e.target_iid : null;
      if (iid) involved.set(`${e.project_id}!${iid}`, { project: e.project_id, iid });
    }
    const known = new Set([...jobs.values()].map(({ raw }) => `${raw.project_id}!${raw.iid}`));

    await mapLimit(watches, 4, async (w) => {
      if (jobs.has(w.id)) return;
      try {
        add(await get<RawMr>(`${project(w.locator.project!)}/merge_requests/${w.locator.iid}`), "watched");
      } catch (e) {
        warnings.push(`${w.locator.project}!${w.locator.iid}: ${message(e)}`);
      }
    });
    await mapLimit([...involved.entries()].filter(([k]) => !known.has(k)), 4, async ([, { project: pid, iid }]) => {
      try {
        const mr = await get<RawMr>(`${project(pid)}/merge_requests/${iid}`);
        const role = mr.author.id === me ? "author" : mr.reviewers?.some((r) => r.id === me) ? "reviewer" : "involved";
        add(mr, role);
      } catch (e) {
        if (!(e instanceof HttpError && [403, 404].includes(e.status))) warnings.push(`!${iid}: ${message(e)}`);
      }
    });

    return mapLimit([...jobs.values()], 6, async ({ raw, role }) => {
      const { raw: full, details } = await withDetails(raw);
      return mapMr(full, role, me, ctx, details);
    });
  }

  /** Pipelines I started (pushes, merges, manual runs) in projects I was active in lately, plus watched ones. */
  async function fetchRuns(me: RawUser, ctx: FetchContext, events: RawEvent[], prs: PullRequest[], memo: Memo, warnings: string[]) {
    const since = ctx.now - cfg.runsKeepHours * 3_600_000;
    const projects = [
      ...new Set<number | string>([
        ...events.filter((e) => e.push_data && Date.parse(e.created_at) >= since).map((e) => e.project_id),
        ...prs.filter((p) => p.role === "author" && p.status === "active").map((p) => p.repo),
      ]),
    ].slice(0, 10);

    const raws = new Map<number, { p: RawPipeline; watched: boolean }>();
    const updatedAfter = encodeURIComponent(new Date(since).toISOString());
    await mapLimit(projects, 4, async (pid) => {
      try {
        const list = await get<RawPipeline[]>(`${project(pid)}/pipelines?username=${encodeURIComponent(me.username)}&updated_after=${updatedAfter}&per_page=30`);
        for (const p of list) raws.set(p.id, { p, watched: false });
      } catch (e) {
        if (!(e instanceof HttpError && [403, 404].includes(e.status))) warnings.push(`pipelines of ${pid}: ${message(e)}`);
      }
    });
    await mapLimit(ctx.watches.filter((w) => w.kind === "run"), 4, async (w) => {
      const existing = raws.get(Number(w.locator.id));
      if (existing) {
        existing.watched = true;
        return;
      }
      try {
        raws.set(Number(w.locator.id), { p: await get<RawPipeline>(`${project(w.locator.project!)}/pipelines/${w.locator.id}`), watched: true });
      } catch (e) {
        warnings.push(`pipeline ${w.locator.id}: ${message(e)}`);
      }
    });

    // Pipelines don't carry a title: MR pipelines take the MR's, branch pipelines their commit's.
    const titles: Record<string, string> = {};
    const mrOf = (p: RawPipeline, path: string) => {
      const iid = p.ref.match(/^refs\/merge-requests\/(\d+)\//)?.[1];
      return iid ? { iid, pr: prs.find((x) => x.id === mrId(path, iid)) } : undefined;
    };
    await mapLimit([...raws.values()], 4, async ({ p }) => {
      if (mrOf(p, pipelineProject(p, cfg.webUrl))) return;
      const cached = memo.commitTitles?.[p.sha];
      if (cached !== undefined) {
        titles[p.sha] = cached;
        return;
      }
      titles[p.sha] = await get<{ title: string }>(`${project(p.project_id)}/repository/commits/${p.sha}`)
        .then((c) => c.title)
        .catch(() => "");
    });
    memo.commitTitles = titles; // only what's still listed

    return [...raws.values()].map(({ p, watched }): Run => {
      const path = pipelineProject(p, cfg.webUrl);
      const mr = mrOf(p, path);
      return {
        id: runId(p.id),
        source: "gitlab",
        ref: `#${p.iid}`,
        url: p.web_url,
        name: p.name || lastSegment(path),
        title: mr ? (mr.pr?.title ?? `!${mr.iid}`) : titles[p.sha] || p.ref,
        repo: path,
        branch: mr ? (mr.pr?.branch ?? `!${mr.iid}`) : p.ref,
        status: PIPELINE_STATUS[p.status] ?? "queued",
        conclusion: PIPELINE_CONCLUSION[p.status],
        // the list is already filtered to my pipelines, only watched ones say who started them
        triggeredByMe: !watched || p.user?.id === me.id,
        watched,
        createdAt: iso(p.created_at),
        updatedAt: iso(p.updated_at),
      };
    });
  }

  async function fetchAll(ctx: FetchContext): Promise<FetchResult> {
    const memo: Memo = { ...(ctx.memo as Memo | undefined) };
    if (!memo.userId || !memo.username) {
      const user = await get<RawUser>("/user");
      memo.userId = user.id;
      memo.username = user.username;
    }
    const me = memo.userId;
    const warnings: string[] = [];

    const since = ctx.now - Math.max(cfg.lookbackDays * 24, cfg.runsKeepHours) * 3_600_000;
    const events = await fetchEvents(since, warnings);
    const prs = await fetchMrs(me, ctx, events, warnings);
    const runs = await fetchRuns({ id: me, username: memo.username, name: "" }, ctx, events, prs, memo, warnings);
    return { prs, runs, memo, warnings };
  }

  return {
    id: "gitlab",
    label: cfg.label,
    fetch: fetchAll,
    parseWatchUrl(url): WatchTarget | undefined {
      const path = pathBelow(url, cfg.webUrl);
      if (!path) return undefined;
      const mr = path.match(/^\/(.+?)\/-\/merge_requests\/(\d+)/);
      if (mr) {
        const [, proj, iid] = mr as unknown as [string, string, string];
        return { id: mrId(proj, iid), kind: "pr", locator: { project: proj, iid } };
      }
      const pipeline = path.match(/^\/(.+?)\/-\/pipelines\/(\d+)/);
      if (pipeline) {
        const [, proj, id] = pipeline as unknown as [string, string, string];
        return { id: runId(id), kind: "run", locator: { project: proj, id } };
      }
      return undefined;
    },
  };
}
