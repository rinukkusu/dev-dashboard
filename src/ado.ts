import type { AdoConfig } from "./config.ts";
import { getJson, iso, mapLimit, preview } from "./http.ts";
import type { Comment, PullRequest, Reviewer, Vote } from "./model.ts";

// --- Raw API shapes (only the fields we use) -------------------------------

type RawReviewer = {
  id: string;
  displayName: string;
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
  createdBy: { id: string; displayName: string };
  repository: { id: string; name: string; webUrl?: string };
  reviewers?: RawReviewer[];
};

type RawComment = {
  id: number;
  author: { id: string; displayName: string };
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
};

type List<T> = { value: T[] };

// --- Mapping -----------------------------------------------------------------

const VOTES: Record<number, Vote> = {
  10: "approved",
  5: "approvedWithSuggestions",
  0: "none",
  [-5]: "waiting",
  [-10]: "rejected",
};

const OPEN_THREAD_STATES = new Set(["active", "pending"]);

/** ADO stores mentions as @<GUID>; make them readable enough. */
const cleanAdoText = (s: string) => preview(s.replace(/@<[0-9A-Fa-f-]{36}>/g, "@…"));

const shortRef = (ref: string) => ref.replace(/^refs\/heads\//, "");

export type KeyExtractor = (text: string) => string[];

export function createAdoClient(cfg: AdoConfig) {
  const headers = { Authorization: "Basic " + btoa(":" + cfg.pat) };
  const api = `${cfg.orgUrl}/${encodeURIComponent(cfg.project)}/_apis`;
  const v = `api-version=${cfg.apiVersion}`;
  const get = <T>(url: string) => getJson<T>(url, headers);

  async function myId(): Promise<string> {
    if (cfg.userId) return cfg.userId;
    const r = await get<{ authenticatedUser: { id: string } }>(`${cfg.orgUrl}/_apis/connectionData`);
    return r.authenticatedUser.id;
  }

  const listPrs = (criteria: string, top = 100) =>
    get<List<RawPr>>(`${api}/git/pullrequests?${criteria}&$top=${top}&${v}`).then((r) => r.value);

  const listThreads = (pr: RawPr) =>
    get<List<RawThread>>(
      `${api}/git/repositories/${pr.repository.id}/pullRequests/${pr.pullRequestId}/threads?${v}`,
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

    const repoUrl =
      pr.repository.webUrl ??
      `${cfg.orgUrl}/${encodeURIComponent(cfg.project)}/_git/${encodeURIComponent(pr.repository.name)}`;

    return {
      id: pr.pullRequestId,
      title: pr.title,
      url: `${repoUrl}/pullrequest/${pr.pullRequestId}`,
      repo: pr.repository.name,
      branch: shortRef(pr.sourceRefName),
      targetBranch: shortRef(pr.targetRefName),
      author: pr.createdBy.displayName,
      role,
      status: pr.status === "completed" ? "completed" : "active",
      createdAt: iso(pr.creationDate),
      closedAt: pr.closedDate ? iso(pr.closedDate) : undefined,
      isDraft: !!pr.isDraft,
      hasConflicts: pr.mergeStatus === "conflicts",
      reviewers,
      openThreads: humanThreads.filter((t) => OPEN_THREAD_STATES.has(t.status ?? "")).length,
      comments,
      ticketKeys: extractKeys(`${pr.title} ${pr.sourceRefName} ${pr.description ?? ""}`),
    };
  }

  /**
   * My active PRs, active PRs where I'm a reviewer, and my recently merged PRs
   * (needed for "PR merged, ticket not moved yet").
   */
  async function fetchPullRequests(extractKeys: KeyExtractor): Promise<PullRequest[]> {
    const me = await myId();
    const [mine, toReview, merged] = await Promise.all([
      listPrs(`searchCriteria.status=active&searchCriteria.creatorId=${me}`),
      listPrs(`searchCriteria.status=active&searchCriteria.reviewerId=${me}`),
      listPrs(`searchCriteria.status=completed&searchCriteria.creatorId=${me}`, 30),
    ]);

    const cutoff = Date.now() - cfg.mergedLookbackDays * 86_400_000;
    const recentMerged = merged.filter((p) => p.closedDate && Date.parse(iso(p.closedDate)) >= cutoff);

    // De-duplicate: a PR I authored wins over the reviewer view of the same PR.
    const jobs = new Map<number, { pr: RawPr; role: PullRequest["role"] }>();
    const add = (prs: RawPr[], role: PullRequest["role"]) => {
      for (const pr of prs) if (!jobs.has(pr.pullRequestId)) jobs.set(pr.pullRequestId, { pr, role });
    };
    add(mine, "author");
    add(toReview.filter((p) => p.createdBy.id !== me), "reviewer");
    add(recentMerged, "author");

    return mapLimit([...jobs.values()], 6, async ({ pr, role }) => {
      const threads = pr.status === "active" ? await listThreads(pr) : [];
      return mapPr(pr, role, me, threads, extractKeys);
    });
  }

  return { fetchPullRequests };
}
