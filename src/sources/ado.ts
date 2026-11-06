import type { AdoConfig } from "../config.ts";
import type { KeyExtractor } from "../correlate.ts";
import { getJson, HttpError, iso, mapLimit, message, preview, requestJson } from "../http.ts";
import { blocksToLines, type Block } from "../diffview.ts";
import type { Comment, DiffLine, PullRequest, Reviewer, Run, RunConclusion, RunStatus, Thread, Vote } from "../model.ts";
import { fullText, pathBelow, type FetchContext, type FetchResult, type Source } from "./types.ts";

// --- Raw API shapes (only the fields we use) -------------------------------

type RawIdentity = { id: string; displayName: string };

type RawReviewer = RawIdentity & {
  vote: number;
  isRequired?: boolean;
  isContainer?: boolean;
};

type RawPr = {
  pullRequestId: number;
  title: string;
  description?: string;
  status: "active" | "completed" | "abandoned";
  sourceRefName: string;
  targetRefName: string;
  isDraft?: boolean;
  mergeStatus?: string;
  creationDate: string;
  closedDate?: string;
  createdBy: RawIdentity;
  closedBy?: RawIdentity;
  repository: { id: string; name: string; webUrl?: string; project?: { name: string } };
  reviewers?: RawReviewer[];
};

type RawComment = {
  id: number;
  author: RawIdentity;
  content?: string;
  publishedDate: string;
  commentType?: "text" | "system" | "codeChange" | string;
  isDeleted?: boolean;
};

type RawThread = {
  id: number;
  status?: string; // active | pending | fixed | wontFix | closed | byDesign | unknown
  isDeleted?: boolean;
  comments: RawComment[];
  threadContext?: {
    filePath?: string;
    rightFileStart?: { line: number };
    rightFileEnd?: { line: number };
    leftFileStart?: { line: number };
    leftFileEnd?: { line: number };
  } | null;
  /** which push (iteration) the line numbers refer to */
  pullRequestThreadContext?: { iterationContext?: { secondComparingIteration?: number } } | null;
};

type RawBuild = {
  id: number;
  buildNumber: string;
  status: string; // notStarted | inProgress | cancelling | postponed | completed
  result?: string; // succeeded | partiallySucceeded | failed | canceled | none
  definition: { name: string };
  sourceBranch: string;
  queueTime: string;
  startTime?: string;
  finishTime?: string;
  repository?: { name: string };
  requestedFor?: RawIdentity;
  triggerInfo?: Record<string, string>;
  _links: { web: { href: string } };
};

type List<T> = { value: T[] };

/** Remembered between polls: PRs found to have my comments, and when we last looked for new ones. */
type Memo = { commented: number[]; lastScan?: string };

// --- Mapping -----------------------------------------------------------------

const VOTES: Record<number, Vote> = {
  10: "approved",
  5: "approvedWithSuggestions",
  0: "none",
  [-5]: "waiting",
  [-10]: "rejected",
};

const OPEN_THREAD_STATES = new Set(["active", "pending"]);

const BUILD_STATUS: Record<string, RunStatus> = {
  notStarted: "queued",
  postponed: "queued",
  inProgress: "running",
  cancelling: "running",
  completed: "completed",
};

const BUILD_RESULT: Record<string, RunConclusion> = {
  succeeded: "success",
  partiallySucceeded: "failure",
  failed: "failure",
  canceled: "cancelled",
};

/** ADO stores mentions as @<GUID>; make them readable enough. */
const unmention = (s: string) => s.replace(/@<[0-9A-Fa-f-]{36}>/g, "@…");
const cleanAdoText = (s: string) => preview(unmention(s));

const shortRef = (ref: string) => ref.replace(/^refs\/heads\//, "");

const isMyComment = (me: string) => (c: RawComment) => c.commentType === "text" && !c.isDeleted && c.author.id === me;

export function createAdoSource(cfg: AdoConfig): Source {
  /** file diffs by repo, commits and path – they never change */
  const diffCache = new Map<string, DiffLine[]>();
  const headers = { Authorization: "Basic " + btoa(":" + cfg.pat) };
  const projectApi = (project = cfg.projects[0]!) => `${cfg.orgUrl}/${encodeURIComponent(project)}/_apis`;
  const v = `api-version=${cfg.apiVersion}`;
  const get = <T>(url: string) => getJson<T>(url, headers);

  async function myId(): Promise<string> {
    if (cfg.userId) return cfg.userId;
    const r = await get<{ authenticatedUser: { id: string } }>(`${cfg.orgUrl}/_apis/connectionData`);
    return r.authenticatedUser.id;
  }

  /** Pages through one project's results until `limit` PRs or the end of the list. */
  async function listProjectPrs(project: string, criteria: string, limit: number): Promise<RawPr[]> {
    const out: RawPr[] = [];
    const pageSize = 100;
    while (out.length < limit) {
      const top = Math.min(pageSize, limit - out.length);
      const page = await get<List<RawPr>>(`${projectApi(project)}/git/pullrequests?${criteria}&$top=${top}&$skip=${out.length}&${v}`);
      out.push(...page.value);
      if (page.value.length < top) break;
    }
    return out;
  }

  /** ADO only lists PRs per project, so ask every configured project (`limit` applies per project). */
  const listPrs = async (criteria: string, limit = Infinity): Promise<RawPr[]> =>
    (await Promise.all(cfg.projects.map((p) => listProjectPrs(p, criteria, limit)))).flat();

  // Org-level lookup works for PRs in any project (watched links can point anywhere).
  const getPr = (id: number | string) => get<RawPr>(`${cfg.orgUrl}/_apis/git/pullrequests/${id}?${v}`);

  const listThreads = (pr: RawPr) =>
    get<List<RawThread>>(
      `${projectApi(pr.repository.project?.name)}/git/repositories/${pr.repository.id}/pullRequests/${pr.pullRequestId}/threads?${v}`,
    ).then((r) => r.value);

  function mapPr(
    pr: RawPr,
    role: PullRequest["role"],
    me: string,
    threads: RawThread[],
    extractKeys: KeyExtractor,
  ): PullRequest {
    const reviewers: Reviewer[] = (pr.reviewers ?? []).map((r) => ({
      id: r.id,
      name: r.displayName,
      vote: VOTES[r.vote] ?? "none",
      required: !!r.isRequired,
      isGroup: !!r.isContainer,
      isMe: r.id === me,
    }));

    // Only human discussion threads: drop deleted and system-generated ones.
    const humanThreads = threads.filter(
      (t) => !t.isDeleted && t.comments.some((c) => c.commentType === "text" && !c.isDeleted),
    );

    const comments: Comment[] = humanThreads.flatMap((t) =>
      t.comments
        .filter((c) => c.commentType === "text" && !c.isDeleted)
        .map((c) => ({
          id: `${t.id}:${c.id}`,
          author: c.author.displayName,
          authorIsMe: c.author.id === me,
          text: cleanAdoText(c.content ?? ""),
          at: iso(c.publishedDate),
        })),
    );

    const isText = (c: RawComment) => c.commentType === "text" && !c.isDeleted;
    const threadList: Thread[] = humanThreads
      .filter((t) => OPEN_THREAD_STATES.has(t.status ?? ""))
      .map((t) => ({
        id: String(t.id),
        file: t.threadContext?.filePath || undefined,
        ...(t.threadContext?.rightFileStart
          ? { line: t.threadContext.rightFileStart.line, endLine: t.threadContext.rightFileEnd?.line, side: "right" as const }
          : t.threadContext?.leftFileStart
            ? { line: t.threadContext.leftFileStart.line, endLine: t.threadContext.leftFileEnd?.line, side: "left" as const }
            : {}),
        version: t.pullRequestThreadContext?.iterationContext?.secondComparingIteration?.toString(),
        comments: t.comments.filter(isText).map((c) => ({
          id: `${t.id}:${c.id}`,
          author: c.author.displayName,
          authorIsMe: c.author.id === me,
          body: fullText(unmention(c.content ?? "")),
          at: iso(c.publishedDate),
        })),
      }));

    const project = pr.repository.project?.name ?? cfg.projects[0]!;
    const repoUrl =
      pr.repository.webUrl ??
      `${cfg.orgUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(pr.repository.name)}`;

    return {
      id: `ado:pr:${pr.pullRequestId}`,
      source: "ado",
      ref: `!${pr.pullRequestId}`,
      number: pr.pullRequestId,
      title: pr.title,
      url: `${repoUrl}/pullrequest/${pr.pullRequestId}`,
      repo: pr.repository.name,
      branch: shortRef(pr.sourceRefName),
      targetBranch: shortRef(pr.targetRefName),
      author: pr.createdBy.displayName,
      role,
      status: pr.status,
      closedByMe: pr.status !== "active" && pr.closedBy?.id === me,
      createdAt: iso(pr.creationDate),
      closedAt: pr.closedDate ? iso(pr.closedDate) : undefined,
      isDraft: !!pr.isDraft,
      hasConflicts: pr.mergeStatus === "conflicts",
      reviewers,
      openThreads: humanThreads.filter((t) => OPEN_THREAD_STATES.has(t.status ?? "")).length,
      comments,
      threads: threadList,
      api: { project, repoId: pr.repository.id },
      ticketKeys: extractKeys(`${pr.title} ${pr.sourceRefName} ${pr.description ?? ""}`),
    };
  }

  const mapBuild = (b: RawBuild, me: string, watched: boolean): Run => ({
    id: `ado:build:${b.id}`,
    source: "ado",
    ref: `#${b.buildNumber}`,
    url: b._links.web.href,
    name: b.definition.name,
    title: b.triggerInfo?.["ci.message"] ?? b.buildNumber,
    repo: b.repository?.name ?? "",
    branch: shortRef(b.sourceBranch),
    status: BUILD_STATUS[b.status] ?? "queued",
    conclusion: b.result ? BUILD_RESULT[b.result] : undefined,
    triggeredByMe: b.requestedFor?.id === me,
    watched,
    createdAt: iso(b.queueTime),
    updatedAt: iso(b.finishTime ?? b.startTime ?? b.queueTime),
  });

  async function fetchAll(ctx: FetchContext): Promise<FetchResult> {
    const me = await myId();
    const warnings: string[] = [];
    const memo: Memo = { commented: [], ...(ctx.memo as Partial<Memo> | undefined) };

    // --- PRs: mine, review requests, my recently merged ones ---
    const [mine, toReview, merged] = await Promise.all([
      listPrs(`searchCriteria.status=active&searchCriteria.creatorId=${me}`),
      listPrs(`searchCriteria.status=active&searchCriteria.reviewerId=${me}`),
      listPrs(`searchCriteria.status=completed&searchCriteria.creatorId=${me}`, 30),
    ]);
    const cutoff = ctx.now - cfg.mergedLookbackDays * 86_400_000;
    const recentMerged = merged.filter((p) => p.closedDate && Date.parse(iso(p.closedDate)) >= cutoff);

    // First role wins: author > reviewer > watched > involved.
    const jobs = new Map<number, { pr: RawPr; role: PullRequest["role"] }>();
    const add = (prs: RawPr[], role: PullRequest["role"]) => {
      for (const pr of prs) if (!jobs.has(pr.pullRequestId)) jobs.set(pr.pullRequestId, { pr, role });
    };
    add(mine, "author");
    add(toReview.filter((p) => p.createdBy.id !== me), "reviewer");
    add(recentMerged, "author");

    // --- PRs watched by hand ---
    for (const w of ctx.watches.filter((w) => w.kind === "pr")) {
      if (jobs.has(Number(w.locator.id))) continue;
      try {
        add([await getPr(w.locator.id!)], "watched");
      } catch (e) {
        warnings.push(`!${w.locator.id}: ${message(e)}`);
      }
    }

    // --- PRs I commented on ---
    // ADO can't search for that, so every few minutes we look through the project's active PRs.
    // Hits are remembered and followed on every poll until they're closed for a while.
    const threadCache = new Map<number, RawThread[]>();
    const followed = new Set<number>();
    const due = !memo.lastScan || ctx.now - Date.parse(memo.lastScan) >= cfg.discoverMinutes * 60_000;
    if (cfg.discoverMinutes > 0 && due) {
      try {
        const known = new Set([...jobs.keys(), ...memo.commented]);
        const candidates = (await listPrs("searchCriteria.status=active", 500)).filter((p) => !known.has(p.pullRequestId));
        await mapLimit(candidates, 6, async (pr) => {
          const threads = await listThreads(pr);
          if (!threads.some((t) => t.comments.some(isMyComment(me)))) return;
          threadCache.set(pr.pullRequestId, threads);
          followed.add(pr.pullRequestId);
          add([pr], "involved");
        });
        memo.lastScan = new Date(ctx.now).toISOString();
      } catch (e) {
        warnings.push(`looking for PRs you commented on: ${message(e)}`);
      }
    }
    await mapLimit(memo.commented.filter((id) => !jobs.has(id)), 6, async (id) => {
      try {
        const pr = await getPr(id);
        if (pr.status !== "active" && pr.closedDate && Date.parse(iso(pr.closedDate)) < cutoff) return; // done with it
        followed.add(id);
        add([pr], "involved");
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return; // deleted
        followed.add(id);
        warnings.push(`!${id}: ${message(e)}`);
      }
    });
    memo.commented = [...followed];

    const prs = await mapLimit([...jobs.values()], 6, async ({ pr, role }) => {
      const threads = pr.status === "active" ? (threadCache.get(pr.pullRequestId) ?? (await listThreads(pr))) : [];
      return mapPr(pr, role, me, threads, ctx.extractKeys);
    });

    // --- Builds: the ones I queued (manually or by pushing), plus watched ones ---
    // Needs the PAT scope "Build (Read)"; without it PRs still work.
    const runs: Run[] = [];
    const since = new Date(ctx.now - cfg.runsKeepHours * 3_600_000).toISOString();
    await Promise.all(
      cfg.projects.map(async (project) => {
        try {
          const builds = await get<List<RawBuild>>(
            `${projectApi(project)}/build/builds?requestedFor=${me}&minTime=${encodeURIComponent(since)}&$top=50&queryOrder=queueTimeDescending&${v}`,
          );
          runs.push(...builds.value.map((b) => mapBuild(b, me, false)));
        } catch (e) {
          warnings.push(`builds in ${project}: ${message(e)}`);
        }
      }),
    );
    for (const w of ctx.watches.filter((w) => w.kind === "run")) {
      const existing = runs.find((r) => r.id === w.id);
      if (existing) {
        existing.watched = true;
        continue;
      }
      try {
        const b = await get<RawBuild>(`${projectApi(w.locator.project)}/build/builds/${w.locator.id}?${v}`);
        runs.push(mapBuild(b, me, true));
      } catch (e) {
        warnings.push(`build ${w.locator.id}: ${message(e)}`);
      }
    }

    return { prs, runs, memo, warnings };
  }

  return {
    id: "ado",
    label: "Azure DevOps",
    fetch: fetchAll,
    async fileDiff(pr, thread) {
      if (!pr.api?.repoId || !thread.file) return [];
      const repo = `${projectApi(pr.api.project)}/git/repositories/${pr.api.repoId}`;
      // the latest iteration: its merge base against what's pushed – what ADO's diff view shows
      const its = await get<List<{ id: number; sourceRefCommit: { commitId: string }; commonRefCommit?: { commitId: string }; targetRefCommit?: { commitId: string } }>>(
        `${repo}/pullRequests/${pr.number}/iterations?${v}`,
      );
      // the push the thread was written on – its line numbers belong there – else the latest
      const last = its.value.find((i) => String(i.id) === thread.version) ?? its.value.at(-1);
      const base = last?.commonRefCommit?.commitId ?? last?.targetRefCommit?.commitId;
      if (!last || !base) return [];
      const head = last.sourceRefCommit.commitId;
      const key = `${pr.api.repoId}:${base}:${head}:${thread.file}`;
      const cached = diffCache.get(key);
      if (cached) return cached;
      const content = (commit: string) =>
        get<{ content?: string }>(
          `${repo}/items?path=${encodeURIComponent(thread.file!)}&versionDescriptor.version=${commit}&versionDescriptor.versionType=commit&includeContent=true&${v}`,
        ).then(
          (r) => (r.content ?? "").split(/\r?\n/),
          (e) => (e instanceof HttpError && e.status === 404 ? undefined : Promise.reject(e)), // added or deleted file
        );
      const [original, modified] = await Promise.all([content(base), content(head)]);
      let lines: DiffLine[];
      if (!original || !modified) {
        // added or deleted by the PR: the file diff API refuses those, but they're all one colour anyway
        lines = blocksToLines(original ?? [], modified ?? [], [
          { changeType: 3, originalLineNumberStart: 1, originalLinesCount: original?.length ?? 0, modifiedLineNumberStart: 1, modifiedLinesCount: modified?.length ?? 0 },
        ]);
      } else {
        const blocks = await requestJson<{ path: string; lineDiffBlocks?: Block[] }[]>(`${repo}/fileDiffs?${v}`, headers, {
          method: "POST",
          body: { baseVersionCommit: base, targetVersionCommit: head, fileDiffParams: [{ path: thread.file, originalPath: thread.file }] },
        }).then(
          (r) => r[0]?.lineDiffBlocks ?? [],
          (e) => {
            // renamed file and the like: the code without diff colours is still better than nothing
            console.error(`file diff ${thread.file}: ${message(e)}`);
            return [];
          },
        );
        lines = blocksToLines(original, modified, blocks);
      }
      diffCache.set(key, lines);
      if (diffCache.size > 50) diffCache.delete(diffCache.keys().next().value!);
      return lines;
    },
    // needs the PAT scope "Code (Read & Write)"
    async reply(pr, thread, text, resolve) {
      if (!pr.api?.repoId) throw new Error("PR without repository id – wait for the next poll");
      const base = `${projectApi(pr.api.project)}/git/repositories/${pr.api.repoId}/pullRequests/${pr.number}/threads/${encodeURIComponent(thread)}`;
      // parentCommentId 1: an answer to the thread's first comment, as ADO's own UI does it
      await requestJson(`${base}/comments?${v}`, headers, { method: "POST", body: { content: text, parentCommentId: 1, commentType: 1 } });
      if (resolve) await requestJson(`${base}?${v}`, headers, { method: "PATCH", body: { status: "fixed" } });
    },
    parseWatchUrl(url) {
      const path = pathBelow(url, cfg.orgUrl);
      if (!path) return undefined;
      const pr = path.match(/^\/([^/]+)\/_git\/[^/]+\/pullrequest\/(\d+)/i);
      if (pr) return { id: `ado:pr:${pr[2]}`, kind: "pr", locator: { id: pr[2]!, project: decodeURIComponent(pr[1]!) } };
      const build = path.match(/^\/([^/]+)\/_build\/results\/?$/i);
      const buildId = url.searchParams.get("buildId");
      if (build && buildId && /^\d+$/.test(buildId)) {
        return { id: `ado:build:${buildId}`, kind: "run", locator: { id: buildId, project: decodeURIComponent(build[1]!) } };
      }
      return undefined;
    },
  };
}
