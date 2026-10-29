import type { GithubConfig } from "../config.ts";
import { cleanMarkdown, HttpError, iso, mapLimit, message, requestJson } from "../http.ts";
import type { Checks, Comment, Issue, PullRequest, Reviewer, Run, RunConclusion, RunStatus, Vote, Watch } from "../model.ts";
import { pathBelow, type FetchContext, type FetchResult, type Source, type WatchTarget } from "./types.ts";

// GitHub.com and GitHub Enterprise Server share this; only the URLs differ.
// PRs and issues come from one GraphQL request (searches + watched items as aliases),
// workflow runs from REST, because GraphQL doesn't list runs.

// --- Raw API shapes (only the fields we use) -------------------------------

type RawActor = { login: string; name?: string | null } | null;
type RawComment = { id: string; author: RawActor; body: string; createdAt: string };
type RawCloseEvents = { nodes: { __typename: string; actor: RawActor }[] };
type RawRepo = { name: string; nameWithOwner: string };

type RawPr = {
  __typename: "PullRequest";
  number: number;
  title: string;
  url: string;
  body: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  closedAt: string | null;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  headRefName: string;
  baseRefName: string;
  author: RawActor;
  mergedBy: RawActor;
  repository: RawRepo;
  reviewRequests: { nodes: { requestedReviewer: { __typename: string; login?: string; name?: string | null } | null }[] };
  latestReviews: { nodes: { author: RawActor; state: string }[] };
  reviews: { nodes: { id: string; author: RawActor; body: string; submittedAt: string | null }[] };
  comments: { nodes: RawComment[] };
  reviewThreads: { nodes: { isResolved: boolean; comments: { nodes: RawComment[] } }[] };
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
  timelineItems: RawCloseEvents;
};

type RawIssue = {
  __typename: "Issue";
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  updatedAt: string;
  author: RawActor;
  assignees: { nodes: { login: string; name?: string | null }[] };
  repository: RawRepo;
  comments: { nodes: RawComment[] };
  timelineItems: RawCloseEvents;
};

type RawNode = RawPr | RawIssue | Record<string, never>;

type RawRun = {
  id: number;
  run_number: number;
  name: string;
  display_title: string;
  head_branch: string | null;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  actor?: { login: string };
  triggering_actor?: { login: string };
  repository: { full_name: string; name: string };
};

type RawEvent = { type: string; repo: { name: string }; created_at: string };

/** Remembered between polls. */
type Memo = { login?: string };

// --- GraphQL ---------------------------------------------------------------

const ACTOR = "login ... on User { name }";
const COMMENT = `id author { ${ACTOR} } body createdAt`;
const CLOSE_EVENTS = `timelineItems(last: 1, itemTypes: [CLOSED_EVENT, REOPENED_EVENT]) {
  nodes { __typename ... on ClosedEvent { actor { login } } ... on ReopenedEvent { actor { login } } } }`;

const PR_FIELDS = `
  __typename number title url body isDraft state createdAt closedAt mergeable headRefName baseRefName
  author { ${ACTOR} } mergedBy { login }
  repository { name nameWithOwner }
  reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login name } ... on Team { name } } } }
  latestReviews(first: 20) { nodes { author { ${ACTOR} } state } }
  reviews(last: 20) { nodes { id author { ${ACTOR} } body submittedAt } }
  comments(last: 30) { nodes { ${COMMENT} } }
  reviewThreads(first: 30) { nodes { isResolved comments(last: 5) { nodes { ${COMMENT} } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  ${CLOSE_EVENTS}`;

const ISSUE_FIELDS = `
  __typename number title url state updatedAt author { ${ACTOR} }
  assignees(first: 5) { nodes { login name } }
  repository { name nameWithOwner }
  comments(last: 30) { nodes { ${COMMENT} } }
  ${CLOSE_EVENTS}`;

const NODE = `... on PullRequest { ${PR_FIELDS} } ... on Issue { ${ISSUE_FIELDS} }`;

// --- Mapping ---------------------------------------------------------------

const REVIEW_STATES: Record<string, Vote> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "waiting",
  COMMENTED: "none",
  DISMISSED: "none",
};

const CHECKS: Record<string, Checks> = {
  SUCCESS: "success",
  FAILURE: "failure",
  ERROR: "failure",
  PENDING: "pending",
  EXPECTED: "pending",
};

const RUN_STATUS: Record<string, RunStatus> = { in_progress: "running", completed: "completed" };

const RUN_CONCLUSION: Record<string, RunConclusion> = {
  success: "success",
  failure: "failure",
  timed_out: "failure",
  startup_failure: "failure",
  cancelled: "cancelled",
  skipped: "skipped",
};

const displayName = (a: RawActor) => a?.name || a?.login || "ghost";

const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function createGithubSource(cfg: GithubConfig): Source {
  const sid = cfg.id;
  // owner/repo is case-insensitive on GitHub, links and API can differ → lower-case ids
  const itemId = (nameWithOwner: string, n: number) => `${sid}:${nameWithOwner.toLowerCase()}#${n}`;
  const runId = (fullName: string, id: number | string) => `${sid}:${fullName.toLowerCase()}/runs/${id}`;

  const headers = { Authorization: `bearer ${cfg.token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const rest = <T>(path: string) => requestJson<T>(`${cfg.apiUrl}${path}`, headers);

  async function graphql<T>(query: string, variables: Record<string, unknown> = {}) {
    const r = await requestJson<{ data?: T; errors?: { message: string }[] }>(cfg.graphqlUrl, headers, {
      method: "POST",
      body: { query, variables },
    });
    if (!r.data) throw new Error(r.errors?.map((e) => e.message).join("; ") || "empty GraphQL response");
    return { data: r.data, errors: (r.errors ?? []).map((e) => e.message) };
  }

  function mapPr(raw: RawPr, role: PullRequest["role"], me: string, ctx: FetchContext): PullRequest {
    const isMe = (a: RawActor) => a?.login === me;

    // Latest review per person, then open requests on top (a re-request means "please look again").
    const reviewers = new Map<string, Reviewer>();
    for (const r of raw.latestReviews.nodes) {
      const vote = REVIEW_STATES[r.state];
      if (!r.author || !vote) continue;
      reviewers.set(r.author.login, { id: r.author.login, name: displayName(r.author), vote, required: false, isGroup: false, isMe: isMe(r.author) });
    }
    for (const { requestedReviewer: rr } of raw.reviewRequests.nodes) {
      if (!rr) continue;
      const isTeam = rr.__typename === "Team";
      const id = isTeam ? `team:${rr.name}` : (rr.login ?? "?");
      reviewers.set(id, { id, name: (isTeam ? rr.name : rr.name || rr.login) ?? "?", vote: "none", required: false, isGroup: isTeam, isMe: !isTeam && rr.login === me });
    }
    if (raw.author) reviewers.delete(raw.author.login);

    const comment = (prefix: string, c: RawComment): Comment => ({
      id: `${prefix}:${c.id}`,
      author: displayName(c.author),
      authorIsMe: isMe(c.author),
      text: cleanMarkdown(c.body),
      at: iso(c.createdAt),
    });
    const comments: Comment[] = [
      ...raw.comments.nodes.map((c) => comment("c", c)),
      ...raw.reviewThreads.nodes.flatMap((t) => t.comments.nodes.map((c) => comment("t", c))),
      ...raw.reviews.nodes
        .filter((r) => r.body.trim() && r.submittedAt)
        .map((r) => comment("r", { id: r.id, author: r.author, body: r.body, createdAt: r.submittedAt! })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    const closeEvent = raw.timelineItems.nodes.at(-1);
    const rollup = raw.commits.nodes[0]?.commit.statusCheckRollup?.state;

    return {
      id: itemId(raw.repository.nameWithOwner, raw.number),
      source: sid,
      ref: `${raw.repository.name}#${raw.number}`,
      number: raw.number,
      title: raw.title,
      url: raw.url,
      repo: raw.repository.nameWithOwner,
      branch: raw.headRefName,
      targetBranch: raw.baseRefName,
      author: displayName(raw.author),
      role,
      status: raw.state === "OPEN" ? "active" : raw.state === "MERGED" ? "completed" : "abandoned",
      closedByMe:
        raw.state === "MERGED" ? isMe(raw.mergedBy) : raw.state === "CLOSED" && closeEvent?.__typename === "ClosedEvent" && isMe(closeEvent.actor),
      createdAt: iso(raw.createdAt),
      closedAt: raw.closedAt ? iso(raw.closedAt) : undefined,
      isDraft: raw.isDraft,
      hasConflicts: raw.mergeable === "CONFLICTING",
      checks: rollup ? CHECKS[rollup] : undefined,
      reviewers: [...reviewers.values()],
      openThreads: raw.reviewThreads.nodes.filter((t) => !t.isResolved).length,
      comments,
      ticketKeys: ctx.extractKeys(`${raw.title} ${raw.headRefName} ${raw.body}`),
    };
  }

  function mapIssue(raw: RawIssue, scope: Issue["scope"], me: string): Issue {
    const lastEvent = raw.timelineItems.nodes.at(-1);
    return {
      id: itemId(raw.repository.nameWithOwner, raw.number),
      source: sid,
      ref: `${raw.repository.name}#${raw.number}`,
      url: raw.url,
      title: raw.title,
      type: "Issue",
      status: raw.state === "OPEN" ? "open" : "closed",
      statusCategory: raw.state === "OPEN" ? "indeterminate" : "done",
      assignee: raw.assignees.nodes[0] ? displayName(raw.assignees.nodes[0]) : undefined,
      updatedAt: iso(raw.updatedAt),
      comments: raw.comments.nodes.map((c) => ({
        id: `c:${c.id}`,
        author: displayName(c.author),
        authorIsMe: c.author?.login === me,
        text: cleanMarkdown(c.body),
        at: iso(c.createdAt),
      })),
      scope,
      lastChangeByMe: lastEvent?.actor?.login === me,
    };
  }

  const mapRun = (r: RawRun, me: string, watched: boolean): Run => ({
    id: runId(r.repository.full_name, r.id),
    source: sid,
    ref: `#${r.run_number}`,
    url: r.html_url,
    name: r.name,
    title: r.display_title,
    repo: r.repository.full_name,
    branch: r.head_branch ?? "",
    status: RUN_STATUS[r.status] ?? "queued",
    conclusion: r.conclusion ? (RUN_CONCLUSION[r.conclusion] ?? "neutral") : undefined,
    triggeredByMe: r.actor?.login === me || r.triggering_actor?.login === me,
    watched,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  });

  /** PRs and issues: searches for everything I'm involved in, plus watched items, in one request. */
  async function fetchItems(me: string, ctx: FetchContext, watches: Watch[]) {
    const since = date(ctx.now - cfg.lookbackDays * 86_400_000);
    const searches = {
      authored: `is:pr is:open author:${me}`,
      requested: `is:pr is:open review-requested:${me}`,
      reviewed: `is:pr reviewed-by:${me} updated:>=${since}`,
      // involves = author, assignee, mentioned or commented
      involvedPrs: `is:pr involves:${me} updated:>=${since}`,
      involvedIssues: `is:issue involves:${me} updated:>=${since}`,
      assigned: `is:issue is:open assignee:${me}`,
    };
    const names = Object.keys(searches) as (keyof typeof searches)[];
    const query = `query(${names.map((n) => `$${n}: String!`).join(", ")}) {
      ${names.map((n) => `${n}: search(query: $${n}, type: ISSUE, first: 50) { nodes { ${NODE} } }`).join("\n")}
      ${watches
        .map((w, i) => `w${i}: repository(owner: ${JSON.stringify(w.locator.owner)}, name: ${JSON.stringify(w.locator.repo)}) {
          issueOrPullRequest(number: ${Number(w.locator.number)}) { ${NODE} } }`)
        .join("\n")}
    }`;
    const variables = Object.fromEntries(names.map((n) => [n, `${searches[n]} sort:updated-desc archived:false`]));
    const { data, errors } = await graphql<Record<string, any>>(query, variables);

    const prs = new Map<string, PullRequest>();
    const issues = new Map<string, Issue>();
    const roleOf = (raw: RawPr): PullRequest["role"] | undefined => {
      if (raw.author?.login === me) return "author";
      const requested = raw.reviewRequests.nodes.some((n) => n.requestedReviewer?.login === me);
      const reviewed = raw.latestReviews.nodes.some((n) => n.author?.login === me);
      return requested || reviewed ? "reviewer" : undefined;
    };
    const take = (node: RawNode | null | undefined, fallback: "involved" | "watched") => {
      if (!node || !("__typename" in node)) return;
      if (node.__typename === "PullRequest") {
        const id = itemId(node.repository.nameWithOwner, node.number);
        if (!prs.has(id)) prs.set(id, mapPr(node, roleOf(node) ?? fallback, me, ctx));
      } else if (node.__typename === "Issue") {
        const id = itemId(node.repository.nameWithOwner, node.number);
        if (!issues.has(id)) issues.set(id, mapIssue(node, fallback, me));
      }
    };
    for (const n of names) for (const node of data[n]?.nodes ?? []) take(node, "involved");

    const warnings = [...errors];
    watches.forEach((w, i) => {
      const node = data[`w${i}`]?.issueOrPullRequest;
      if (!node) warnings.push(`${w.locator.owner}/${w.locator.repo}#${w.locator.number} not found`);
      // a watched item that's also found by a search keeps its real role, but counts as watched
      take(node, "watched");
    });
    return { prs: [...prs.values()], issues: [...issues.values()], warnings };
  }

  /** Workflow runs I triggered (in repos I was active in lately) plus watched runs. */
  async function fetchRuns(me: string, ctx: FetchContext, watches: Watch[], myPrs: PullRequest[]) {
    const since = ctx.now - cfg.runsKeepHours * 3_600_000;
    const warnings: string[] = [];

    // There's no "my runs" endpoint, so: repos from my recent activity + repos of my open PRs.
    const events = await rest<RawEvent[]>(`/users/${me}/events?per_page=100`).catch((e) => {
      warnings.push(`activity: ${message(e)}`);
      return [] as RawEvent[];
    });
    const repos = [
      ...new Set([
        ...events.filter((e) => Date.parse(e.created_at) >= since).map((e) => e.repo.name),
        ...myPrs.filter((p) => p.role === "author" && p.status === "active").map((p) => p.repo),
      ]),
    ].slice(0, 10);

    const created = encodeURIComponent(`>=${isoSeconds(since)}`);
    const runs = new Map<string, Run>();
    await mapLimit(repos, 4, async (repo) => {
      try {
        const r = await rest<{ workflow_runs: RawRun[] }>(`/repos/${repo}/actions/runs?actor=${me}&created=${created}&per_page=30`);
        for (const run of r.workflow_runs) runs.set(runId(run.repository.full_name, run.id), mapRun(run, me, false));
      } catch (e) {
        // no Actions, no access or archived – not worth a warning
        if (!(e instanceof HttpError && [403, 404].includes(e.status))) warnings.push(`${repo}: ${message(e)}`);
      }
    });

    await mapLimit(watches, 4, async (w) => {
      const existing = runs.get(w.id);
      if (existing) {
        existing.watched = true;
        return;
      }
      try {
        const run = await rest<RawRun>(`/repos/${w.locator.owner}/${w.locator.repo}/actions/runs/${w.locator.id}`);
        runs.set(w.id, mapRun(run, me, true));
      } catch (e) {
        warnings.push(`run ${w.locator.id}: ${message(e)}`);
      }
    });
    return { runs: [...runs.values()], warnings };
  }

  async function fetchAll(ctx: FetchContext): Promise<FetchResult> {
    const memo: Memo = { ...(ctx.memo as Memo | undefined) };
    memo.login ??= (await graphql<{ viewer: { login: string } }>("query { viewer { login } }")).data.viewer.login;
    const me = memo.login;

    const items = await fetchItems(me, ctx, ctx.watches.filter((w) => w.kind !== "run"));
    const runs = await fetchRuns(me, ctx, ctx.watches.filter((w) => w.kind === "run"), items.prs);
    return {
      prs: items.prs,
      issues: items.issues,
      runs: runs.runs,
      memo,
      warnings: [...items.warnings, ...runs.warnings],
    };
  }

  return {
    id: sid,
    label: cfg.label,
    fetch: fetchAll,
    parseWatchUrl(url): WatchTarget | undefined {
      const path = pathBelow(url, cfg.webUrl);
      if (!path) return undefined;
      const item = path.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/);
      if (item) {
        const [, owner, repo, type, number] = item as unknown as [string, string, string, string, string];
        return { id: itemId(`${owner}/${repo}`, Number(number)), kind: type === "pull" ? "pr" : "issue", locator: { owner, repo, number } };
      }
      const run = path.match(/^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/);
      if (run) {
        const [, owner, repo, id] = run as unknown as [string, string, string, string];
        return { id: runId(`${owner}/${repo}`, id), kind: "run", locator: { owner, repo, id } };
      }
      return undefined;
    },
  };
}
