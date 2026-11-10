// Source-agnostic domain types. Sources map their raw API shapes onto these.
import type { HintMsg } from "./i18n.ts";

export type SourceId = "jira" | "ado" | "github" | "ghe" | "gitlab";

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
  /** one-line preview */
  text: string;
  /** full Jira wiki markup, for the comment popover (Jira only) */
  wiki?: string;
  /** the whole text as written (markdown), where the source gives it and it isn't wiki markup */
  full?: string;
  at: string; // ISO
};

/** A comment in a PR's discussion thread, in full (Comment only keeps a one-line preview). */
export type ThreadComment = {
  /** same id as the Comment */
  id: string;
  author: string;
  authorIsMe: boolean;
  /** the whole text, as written (markdown), cut at a few thousand characters */
  body: string;
  /** formatted by the server (Jira wiki markup), safe to show as HTML */
  html?: string;
  at: string; // ISO
};

/** An open discussion thread on a PR – what "n open threads" counts. */
export type Thread = {
  /** the source's thread id: ADO thread id, GitLab discussion id */
  id: string;
  /** on a line of code, if it is */
  file?: string;
  line?: number;
  /** last commented line, for a range */
  endLine?: number;
  /** left: on removed code (old line numbers), right: on the new version */
  side?: "left" | "right";
  /** the version of the PR the line numbers belong to (ADO: iteration), if not the latest */
  version?: string;
  comments: ThreadComment[];
};

/** One line of a diff excerpt; hit = a line the thread comments on. */
export type DiffLine = { kind: "add" | "del" | "ctx" | "gap"; old?: number; new?: number; text: string; hit?: boolean };

export type Checks = "pending" | "success" | "failure";

export type PullRequest = {
  /** globally unique, e.g. "ado:pr:412", "github:octo/app#12" or "gitlab:group/app!7" – used for diffing, muting, watching */
  id: string;
  source: SourceId;
  /** for display: "!412" (ADO), "app#12" (GitHub) or "app!7" (GitLab) */
  ref: string;
  number: number;
  title: string;
  url: string;
  repo: string;
  branch: string;
  targetBranch: string;
  author: string;
  /** how I'm connected: wrote it, review requested/given, commented/mentioned, or only watched by hand */
  role: "author" | "reviewer" | "involved" | "watched";
  status: "active" | "completed" | "abandoned";
  /** I merged/closed it myself, so that's no news */
  closedByMe?: boolean;
  createdAt: string;
  closedAt?: string;
  isDraft: boolean;
  hasConflicts: boolean;
  /** CI status, if the source knows it */
  checks?: Checks;
  reviewers: Reviewer[];
  openThreads: number;
  comments: Comment[];
  /** the open threads in full, from sources that can answer them (ADO, GitLab) */
  threads?: Thread[];
  /** what the source needs to post to this PR (ADO: project and repository id) */
  api?: Record<string, string>;
  /** Jira keys found in title, branch or description */
  ticketKeys: string[];
  /**
   * the ones in title or branch: the tickets the PR is for, not ones it only mentions ("follow-up in
   * ABC-12"); older states don't have it
   */
  ownKeys?: string[];
};

export type StatusCategory = "new" | "indeterminate" | "done";

export type Issue = {
  /** globally unique, e.g. "jira:ABC-101" or "github:octo/app#5" */
  id: string;
  source: SourceId;
  /** for display: "ABC-101" or "app#5" */
  ref: string;
  url: string;
  title: string;
  type: string;
  status: string;
  /** Jira status id, to place the ticket in its board column */
  statusId?: string;
  statusCategory: StatusCategory;
  assignee?: string;
  /** story points (Jira estimate field), if set */
  points?: number;
  /** hours booked on it in time cockpit (sprint tickets only, if TIMECOCKPIT_PAT is set) */
  bookedHours?: number;
  updatedAt: string;
  comments: Comment[];
  /**
   * list = main Jira JQL (the "Tickets" section), involved = I commented/watch/reported/am assigned,
   * watched = added by hand, linked = only fetched because a PR references it
   */
  scope: "list" | "involved" | "watched" | "linked";
  /** the latest status/assignment change was mine, so that's no news */
  lastChangeByMe?: boolean;
  /** what the source needs to post to it (GitLab: project id) */
  api?: Record<string, string>;
};

export type RunStatus = "queued" | "running" | "completed";
export type RunConclusion = "success" | "failure" | "cancelled" | "skipped" | "neutral";

/** A CI run: GitHub Actions workflow run, Azure Pipelines build or GitLab pipeline. */
export type Run = {
  /** globally unique, e.g. "github:octo/app/runs/123" or "ado:build:555" */
  id: string;
  source: SourceId;
  /** for display, e.g. "#57" */
  ref: string;
  url: string;
  /** workflow / pipeline name */
  name: string;
  /** commit message, PR title or build number */
  title: string;
  repo: string;
  branch: string;
  status: RunStatus;
  conclusion?: RunConclusion;
  triggeredByMe: boolean;
  watched: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A column of the Jira board, in board order. */
export type BoardColumn = {
  name: string;
  /** Jira status ids shown in this column */
  statusIds: string[];
};

export type Snapshot = {
  takenAt: string;
  prs: PullRequest[];
  issues: Issue[];
  runs: Run[];
  /** columns of the Jira board(s) the sprint tickets live on, if Jira Software tells us */
  board?: BoardColumn[];
  errors: string[];
};

export type ChangeKind =
  | "pr-vote"
  | "pr-comment"
  | "pr-review-request"
  | "pr-merged"
  | "pr-gone"
  | "pr-checks"
  | "issue-status"
  | "issue-comment"
  | "issue-added"
  | "issue-removed"
  | "run-finished";

export type Change = {
  id: string; // stable, used to de-duplicate the log
  at: string; // when it happened (comment time) – for display and sorting
  /** when this run noticed it – for "unseen"; older logs don't have it */
  detectedAt?: string;
  kind: ChangeKind;
  /** id of the PR/issue/run, for muting; older logs don't have it */
  resource?: string;
  ref: string;
  url: string;
  // Raw facts only, the text is built when rendering (so the language can change).
  /** PR title, issue title or run name */
  subject: string;
  /** who did it: reviewer, commenter, PR author */
  actor?: string;
  /** comment preview, or branch for runs */
  text?: string;
  vote?: Vote;
  /** issue status before/after */
  from?: string;
  to?: string;
  checks?: Checks;
  conclusion?: RunConclusion;
  /** state files from before i18n stored finished German text; shown as-is until they age out */
  title?: string;
  detail?: string;
};

export type HintLevel = "action" | "ready" | "info";

/** Why something is on the to-do list – shown as an icon. */
export type HintReason =
  | "rejected"
  | "waiting"
  | "threads"
  | "conflicts"
  | "checks"
  | "ready"
  | "review"
  | "move-ticket"
  | "feedback"
  | "run-failed"
  | "agent-blocked"
  | "agent-done"
  | "agent-reply";

export type Hint = {
  level: HintLevel;
  reason: HintReason;
  /** id of the PR/issue/run, so muting hides the hint too */
  resource: string;
  ref: string;
  /** the text as data, see hintText in i18n.ts */
  msg: HintMsg;
  url: string;
  /** herdr pane of the agent the hint is about – clicking opens it in the dashboard */
  pane?: string;
  /** the comment it's about (issue:<id>:c:<comment id>), for the comment popover */
  comment?: string;
  /** an agent working on (or done with) the new comments of this PR/ticket – shown as 🤖 with its answer */
  job?: AgentJob;
};

/** Something added by hand via "+ Watch". */
export type Watch = {
  /** same id the source uses for the PR/issue/run */
  id: string;
  source: SourceId;
  kind: "pr" | "issue" | "run";
  url: string;
  /** what the source needs to fetch it, e.g. { owner, repo, number } */
  locator: Record<string, string>;
  addedAt: string;
};

/** User settings that are not a cache: watches and mutes. Stored next to the state. */
export type Prefs = {
  watches: Watch[];
  /** resource ids */
  muted: string[];
  /** change ids of comments sent to a herdr agent */
  sent: string[];
  /** sticky routing: PR/issue id → herdr pane its comments went to last */
  routes: Record<string, string>;
  /** comments handed to agents automatically, see autopilot.ts */
  jobs: AgentJob[];
  /** to-dos set aside until something new happens about them, see prefs.ts */
  resolved: Resolved[];
  /** my own notes on a PR/ticket/run/space, by resource id */
  notes: Record<string, Note>;
};

/** A note I wrote on something, e.g. "waiting for Pat's answer about rounding". */
export type Note = {
  text: string;
  at: string; // ISO, last edited
};

/**
 * "Done for now": the to-dos of a PR/ticket/run as they were when I resolved them. They stay hidden
 * while they're the same; a new reason, a changed one or a new change in the feed brings them back.
 */
export type Resolved = {
  resource: string;
  at: string; // ISO
  /** hintSig of each hint it had */
  sigs: string[];
};

/**
 * New comments on a PR/ticket, handed to an agent on their own: collected for a moment (reviewers
 * write several in a row), sent when the agent is free, its answer read back from the transcript.
 */
/** A reply the agent proposes for a thread; posted only when I send it. */
export type Suggestion = {
  thread: string;
  reply: string;
  /** the agent thinks the thread can be resolved with it */
  resolve: boolean;
  /** posted from the dashboard */
  sent?: boolean;
};

export type AgentJob = {
  id: string;
  /** PR or issue id */
  resource: string;
  ref: string;
  url: string;
  /** comment change ids (pr:<id>:c:<comment> / issue:<id>:c:<comment>) */
  changeIds: string[];
  status: "collecting" | "queued" | "sent" | "answered" | "failed";
  createdAt: string;
  /** last comment added – collecting ends a while after it */
  lastAt: string;
  pane?: string;
  /** herdr's state_change_seq of the agent when the prompt went out – a higher one means it did something */
  sentSeq?: number;
  sentAt?: string;
  answeredAt?: string;
  /** "Summary:" line of the answer (or its first line) */
  summary?: string;
  /** the agent's final answer */
  reply?: string;
  /** claude.ai artifact link from the answer – the presentation of comments, changes and diffs */
  artifact?: string;
  error?: string;
  /** replies the agent proposes for the PR's threads, to review and post from the dashboard */
  suggestions?: Suggestion[];
  /** opened its artifact: no longer new, but stays on the to-do */
  seen?: boolean;
  /** "✓ Read": done with it, off the to-do */
  read?: boolean;
  /** why a queued job isn't sent yet: the agent works or asks something */
  waiting?: "busy" | "blocked";
};

/** herdr (terminal workspace manager for coding agents): how far an agent is. */
export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

/** A coding agent running in a herdr pane. */
export type Agent = {
  /** herdr pane id, e.g. "w3:p2" – what prompts and focus are sent to */
  paneId: string;
  /** "claude", "codex", … */
  kind?: string;
  /** name given in herdr, if any */
  name?: string;
  status: AgentStatus;
  /** what the agent shows as its terminal title */
  title?: string;
  cwd?: string;
  /** the agent's own session, reported by herdr's integration – finds the Claude transcript */
  session?: { kind: "id" | "path"; value: string };
  /** herdr tab id, e.g. "w14:t4" */
  tabId?: string;
  /** herdr's global state_change_seq: higher = did something more recently */
  seq?: number;
  /** the pane focused in the herdr window – someone may be typing there */
  focused?: boolean;
};

/**
 * A herdr workspace ("space"). Live data, not part of the polled snapshot.
 * Linked to tickets by the Jira keys in its name, e.g. "DEMA-20 - Form. Versand".
 */
export type Space = {
  /** herdr workspace id, e.g. "w3" */
  id: string;
  number: number;
  label: string;
  /** the most urgent status of its agents, as herdr reports it */
  status: AgentStatus;
  ticketKeys: string[];
  agents: Agent[];
  /** shown in the herdr window right now */
  focused: boolean;
  /** the tab last shown in this space, e.g. "w14:t4" */
  activeTabId?: string;
  /** its tabs, for their names */
  tabs?: { id: string; label: string }[];
};

/** One entry of an agent's conversation, from a Claude Code transcript (see transcript.ts). */
export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  at?: string;
};
