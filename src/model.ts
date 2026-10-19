// Source-agnostic domain types. Clients map their raw API shapes onto these.

export type Vote = "approved" | "approvedWithSuggestions" | "none" | "waiting" | "rejected";

export type Reviewer = {
  id: string;
  name: string;
  vote: Vote;
  required: boolean;
  isGroup: boolean;
  isMe: boolean;
};

export type Comment = {
  id: string;
  author: string;
  authorIsMe: boolean;
  text: string;
  at: string; // ISO
};

export type PullRequest = {
  id: number;
  title: string;
  url: string;
  repo: string;
  branch: string;
  targetBranch: string;
  author: string;
  role: "author" | "reviewer";
  status: "active" | "completed";
  createdAt: string;
  closedAt?: string;
  isDraft: boolean;
  hasConflicts: boolean;
  reviewers: Reviewer[];
  openThreads: number;
  comments: Comment[];
  ticketKeys: string[];
};

export type StatusCategory = "new" | "indeterminate" | "done";

export type Issue = {
  key: string;
  url: string;
  summary: string;
  type: string;
  status: string;
  statusCategory: StatusCategory;
  assignee?: string;
  updatedAt: string;
  comments: Comment[];
  /** true = matched the main JQL; false = only fetched because a PR references it */
  inScope: boolean;
};

export type Snapshot = {
  takenAt: string;
  prs: PullRequest[];
  issues: Issue[];
  errors: string[];
};

export type ChangeKind =
  | "pr-vote"
  | "pr-comment"
  | "pr-review-request"
  | "pr-merged"
  | "pr-gone"
  | "issue-status"
  | "issue-comment"
  | "issue-added"
  | "issue-removed";

export type Change = {
  id: string; // stable, used to de-duplicate the log
  at: string;
  kind: ChangeKind;
  ref: string; // "!412" or "ABC-101"
  title: string;
  detail?: string;
  url: string;
};

export type HintLevel = "action" | "ready" | "info";

export type Hint = {
  level: HintLevel;
  ref: string;
  text: string;
  url: string;
};
