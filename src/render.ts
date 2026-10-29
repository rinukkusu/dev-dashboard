import { kanban, type KanbanColumn } from "./board.ts";
import type { Links } from "./correlate.ts";
import { dict, type Dict, type Lang } from "./i18n.ts";
import { spacesOf } from "./herdr.ts";
import { jiraToHtml } from "./jira-wiki.ts";
import type { Change, Comment, Hint, HintReason, Issue, PullRequest, Reviewer, Run, Snapshot, SourceId, Space, StatusCategory } from "./model.ts";

export type View = {
  lang: Lang;
  snapshot: Snapshot;
  changes: Change[];
  hints: Hint[];
  links: Links;
  /** resource ids */
  muted: Set<string>;
  watched: Set<string>;
  refreshSeconds: number;
  runsKeepHours: number;
  /** column order for the ticket board when Jira has no board config */
  statusOrder: string[];
  /** configured sources */
  sources: SourceId[];
  /** live herdr state, if HERDR_SOCKET is set */
  herdr?: { spaces: Space[]; error?: string; canStart: boolean };
  /** change ids of comments sent to an agent */
  sent: Set<string>;
};

/** Comments older than this aren't worth a box on the card anymore. */
const RECENT_COMMENT_DAYS = 7;

// --- tiny helpers ------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const html = (parts: TemplateStringsArray, ...values: unknown[]) =>
  parts.reduce((out, p, i) => out + p + (i < values.length ? String(values[i] ?? "") : ""), "");

const each = <T>(items: T[], fn: (t: T) => string) => items.map(fn).join("");

const fill = (s: string, n: number) => s.replace("{n}", String(n));

/** Everything a fragment needs besides its data. */
type Ctx = {
  t: Dict;
  now: number;
  links: Links;
  /** live server: show mute buttons */
  live: boolean;
  muted: Set<string>;
  watched: Set<string>;
  spaces: Space[];
  /** herdr is set up: show send buttons */
  herdr: boolean;
  /** HERDR_WORKDIR is set: new spaces can be started */
  canStart: boolean;
  sent: Set<string>;
  /** change id of an issue comment → the comment, for its popover in the change log */
  comments: Map<string, { comment: Comment; issue: Issue }>;
};

// Server-rendered fallback; the browser script re-renders times in its own time zone.
function ago(isoDate: string, { t, now }: Ctx): string {
  const min = Math.round((now - Date.parse(isoDate)) / 60_000);
  if (min < 1) return t.client.now;
  if (min < 60) return fill(t.client.minutes, min);
  const h = Math.round(min / 60);
  if (h < 24) return fill(t.client.hours, h);
  const d = Math.round(h / 24);
  return d === 1 ? t.client.yesterday : fill(t.client.days, d);
}

const time = (isoDate: string, c: Ctx) =>
  html`<time class="rel" datetime="${isoDate}">${ago(isoDate, c)}</time>`;

// --- fragments -----------------------------------------------------------------

const VOTE_GLYPH: Record<Reviewer["vote"], string> = {
  approved: "✓",
  approvedWithSuggestions: "✓",
  none: "–",
  waiting: "!",
  rejected: "✕",
};

const RUN_GLYPH: Record<keyof Dict["run"], string> = {
  queued: "⏳",
  running: "🔄",
  success: "✅",
  failure: "❌",
  cancelled: "⚪",
  skipped: "⚪",
  neutral: "⚪",
};

const runState = (r: Run): keyof Dict["run"] => (r.status === "completed" ? (r.conclusion ?? "neutral") : r.status);

/** 🔔/🔕 toggle; only in the live server, which can store it. */
const muteButton = (id: string, c: Ctx) => {
  if (!c.live) return "";
  const on = c.muted.has(id);
  return html`<button type="button" class="mute${on ? " on" : ""}" data-id="${esc(id)}" data-muted="${on ? "1" : "0"}" title="${esc(on ? c.t.unmute : c.t.mute)}">${on ? "🔕" : "🔔"}</button>`;
};

const mutedClass = (id: string, c: Ctx) => (c.muted.has(id) ? " is-muted" : "");

const watchedBadge = (id: string, c: Ctx) =>
  c.watched.has(id) ? html`<span class="badge" title="${c.t.badges.watched}">👁</span>` : "";

const reviewerChip = (r: Reviewer, { t }: Ctx) =>
  html`<span class="chip vote-${r.vote}" title="${esc(`${r.name}: ${t.vote[r.vote]}${r.required ? ` (${t.required})` : ""}`)}"><b>${VOTE_GLYPH[r.vote]}</b>${esc(r.name)}${r.required ? "<sup>*</sup>" : ""}</span>`;

const statusPill = (status: string, cat: StatusCategory) =>
  html`<span class="pill cat-${cat}">${esc(status)}</span>`;

const ticketChip = (key: string, { links }: Ctx) => {
  const issue = links.issueByTicket.get(key);
  return issue
    ? html`<a class="chip ticket" href="${esc(issue.url)}" title="${esc(issue.title)}">${esc(key)} ${statusPill(issue.status, issue.statusCategory)}</a>`
    : html`<span class="chip ticket muted">${esc(key)}</span>`;
};

/**
 * The whole comment, formatted, in a <template>: the browser script shows it as a popover when you
 * hover (or tap) the element that carries data-pop. Only Jira comments keep their full markup.
 */
const commentPop = (cm: Comment, issue: Issue, c: Ctx) =>
  cm.wiki
    ? html`<template class="pop"><div class="pop-head"><b>${esc(cm.author)}</b> · ${esc(issue.ref)} · ${time(cm.at, c)}${sendButton(`issue:${issue.id}:c:${cm.id}`, c)}</div><div class="pop-body wiki">${jiraToHtml(cm.wiki)}</div></template>`
    : "";

/**
 * herdr space on a ticket/PR card: status of its most urgent agent. Click opens the agent's output
 * (or, without an agent, the space in herdr) – only in the live server, which can talk to herdr.
 */
function spaceChip(sp: Space, c: Ctx): string {
  const a = sp.agents[0];
  const label = a ? c.t.herdr.status[a.status] : c.t.herdr.noAgent;
  const cls = `chip space st-${a?.status ?? "none"}`;
  const title = esc(`${sp.label}${a?.kind ? ` · ${a.kind}` : ""}`);
  if (!c.live) return html`<span class="${cls}" title="${title}">🤖 ${esc(label)}</span>`;
  const target = a ? html`data-pane="${esc(a.paneId)}"` : html`data-focus-space="${esc(sp.id)}"`;
  return html`<button type="button" class="${cls}" ${target} data-label="${esc(sp.label)}" title="${title}">🤖 ${esc(label)}</button>`;
}

const spacesFor = (keys: string[], c: Ctx, prRef?: string) => spacesOf(c.spaces, keys, prRef);

/** On a ticket/PR without a space: start one with an agent (live server, HERDR_WORKDIR set). */
const startButton = (kind: "ticket" | "pr", id: string, c: Ctx) =>
  c.live && c.canStart
    ? html`<button type="button" class="chip start" data-start="${kind}" data-id="${esc(id)}" title="${esc(c.t.herdr.start.button)}">🤖 +</button>`
    : "";

/** ➤ on a comment: hand it to the agent of its ticket/PR (or start one); ✓ once it went out. */
const sendButton = (changeId: string, c: Ctx) => {
  if (!c.live || !c.herdr) return "";
  const sent = c.sent.has(changeId);
  return html`<button type="button" class="send-agent${sent ? " sent" : ""}" data-send-comment="${esc(changeId)}" title="${esc(sent ? c.t.herdr.start.sentTitle : c.t.herdr.start.send)}">${sent ? "➤✓" : "➤"}</button>`;
};

/** The PR's spaces, or a button to start one (open PRs only). */
function prSpaces(pr: PullRequest, c: Ctx): string {
  const spaces = spacesFor(pr.ticketKeys, c, pr.ref);
  if (spaces.length) return each(spaces, (sp) => spaceChip(sp, c));
  return pr.status === "active" ? startButton("pr", pr.id, c) : "";
}

function prCard(pr: PullRequest, c: Ctx): string {
  const { t } = c;
  const badges = [
    pr.isDraft ? html`<span class="badge">${t.badges.draft}</span>` : "",
    pr.hasConflicts ? html`<span class="badge bad">${t.badges.conflicts}</span>` : "",
    pr.checks === "failure" ? html`<span class="badge bad">✕ ${t.badges.checksFailing}</span>` : "",
    pr.checks === "pending" && pr.status === "active" ? html`<span class="badge warn">${t.badges.checksPending}</span>` : "",
    pr.openThreads ? html`<span class="badge warn" title="${t.badges.openThreads}">💬 ${pr.openThreads}</span>` : "",
    watchedBadge(pr.id, c),
  ].join("");
  return html`
    <article class="card${mutedClass(pr.id, c)}">
      <div class="row1"><a href="${esc(pr.url)}"><span class="ref">${esc(pr.ref)}</span> ${esc(pr.title)}</a>${badges}${muteButton(pr.id, c)}</div>
      <div class="meta">${esc(pr.repo)} · <code>${esc(pr.branch)}</code> → <code>${esc(pr.targetBranch)}</code> · ${pr.role !== "author" ? `${esc(t.by(pr.author))}, ` : ""}${time(pr.createdAt, c)}</div>
      <div class="chips">${each(pr.ticketKeys, (k) => ticketChip(k, c))}${prSpaces(pr, c)}${each(pr.reviewers, (r) => reviewerChip(r, c))}</div>
    </article>`;
}

function issueRow(issue: Issue, c: Ctx): string {
  const prs = issue.source === "jira" ? (c.links.prsByTicket.get(issue.ref) ?? []) : [];
  const spaces = issue.source === "jira" ? spacesFor([issue.ref], c) : [];
  const last = issue.comments.at(-1);
  return html`
    <article class="card${mutedClass(issue.id, c)}">
      <div class="row1"><a href="${esc(issue.url)}"><span class="ref">${esc(issue.ref)}</span> ${esc(issue.title)}</a>${statusPill(issue.status, issue.statusCategory)}${watchedBadge(issue.id, c)}${muteButton(issue.id, c)}</div>
      <div class="meta">${esc(issue.type)} · ${c.t.updated} ${time(issue.updatedAt, c)}${
        prs.length ? " · " + prs.map((p) => html`<a href="${esc(p.url)}">${esc(p.ref)}</a>${p.status === "completed" ? ` (${c.t.mergedSuffix})` : ""}`).join(", ") : ""
      }${spaces.length ? " " + each(spaces, (sp) => spaceChip(sp, c)) : issue.source === "jira" && issue.statusCategory !== "done" ? " " + startButton("ticket", issue.id, c) : ""}</div>
      ${feedback(issue, c) ? html`<blockquote${last!.wiki ? " data-pop" : ""}><b>${esc(last!.author)}</b> ${time(last!.at, c)}: ${esc(last!.text)}${commentPop(last!, issue, c)}</blockquote>` : ""}
    </article>`;
}

/** Last comment is someone else's and recent – the only comment worth showing on a card. */
const feedback = (issue: Issue, c: Ctx) => {
  const last = issue.comments.at(-1);
  return !!last && !last.authorIsMe && c.now - Date.parse(last.at) < RECENT_COMMENT_DAYS * 86_400_000;
};

/** Compact card for the kanban: key, title, linked PRs, a 💬 if there's fresh feedback. */
function ticketCard(issue: Issue, c: Ctx): string {
  const prs = c.links.prsByTicket.get(issue.ref) ?? [];
  const last = issue.comments.at(-1);
  const meta = [
    ...prs.map((p) => html`<a href="${esc(p.url)}" title="${esc(p.title)}">${esc(p.ref)}</a>${p.status === "completed" ? html`<span class="merged" title="${c.t.mergedSuffix}">✓</span>` : ""}`),
    feedback(issue, c)
      ? last!.wiki
        ? html`<span class="feedback" data-pop>💬 ${esc(last!.author)}${commentPop(last!, issue, c)}</span>`
        : html`<span class="feedback" title="${esc(`${last!.author}: ${last!.text}`)}">💬 ${esc(last!.author)}</span>`
      : "",
    ...(() => {
      const spaces = spacesFor([issue.ref], c);
      return spaces.length ? spaces.map((sp) => spaceChip(sp, c)) : [issue.statusCategory !== "done" ? startButton("ticket", issue.id, c) : ""];
    })(),
  ].filter(Boolean);
  return html`
    <article class="card ticket-card${mutedClass(issue.id, c)}">
      <div class="row1"><a href="${esc(issue.url)}"><span class="ref">${esc(issue.ref)}</span></a><span class="type">${esc(issue.type)}</span>${issue.points !== undefined ? html`<span class="points" title="${c.t.storyPoints}">${fmtPoints(issue.points)}</span>` : ""}${watchedBadge(issue.id, c)}${muteButton(issue.id, c)}</div>
      <a class="title" href="${esc(issue.url)}">${esc(issue.title)}</a>
      ${meta.length ? html`<div class="meta">${meta.join(" ")}</div>` : ""}
    </article>`;
}

const fmtPoints = (n: number) => String(Math.round(n * 10) / 10);

/** Sum of the column's story points; nothing if no ticket has any. */
function columnPoints(issues: Issue[], c: Ctx): string {
  const estimated = issues.filter((i) => i.points !== undefined);
  if (!estimated.length) return "";
  return html`<span class="points" title="${c.t.storyPoints}">SP ${fmtPoints(estimated.reduce((sum, i) => sum + i.points!, 0))}</span>`;
}

const boardHtml = (columns: KanbanColumn[], c: Ctx) =>
  html`<div class="board">${each(columns, (col) => html`
    <div class="board-col"><h3><span>${esc(col.name)}</span><span class="count">${col.issues.length || ""}</span>${columnPoints(col.issues, c)}</h3>${each(col.issues, (i) => ticketCard(i, c))}</div>`)}
  </div>`;

function runRow(r: Run, c: Ctx): string {
  const state = runState(r);
  return html`
    <article class="card run run-${state}${mutedClass(r.id, c)}">
      <div class="row1"><span class="glyph" title="${c.t.run[state]}">${RUN_GLYPH[state]}</span><a href="${esc(r.url)}"><span class="ref">${esc(r.name)}</span> ${esc(r.title)}</a>${watchedBadge(r.id, c)}${muteButton(r.id, c)}</div>
      <div class="meta"><span class="state">${c.t.run[state]}</span> · ${esc(r.repo)}${r.branch ? html` · <code>${esc(r.branch)}</code>` : ""} · ${esc(r.ref)} · ${time(r.updatedAt, c)}</div>
    </article>`;
}

// The level shows as the border colour; the label stays for screen readers and the tooltip.
// Agent hints point to the Spaces page; in the live server a click opens the agent's output instead.
const REASON_ICON: Record<HintReason, string> = {
  rejected: "⛔",
  waiting: "↩️",
  threads: "💬",
  conflicts: "🔀",
  checks: "🧪",
  ready: "🚀",
  review: "👀",
  "move-ticket": "📋",
  feedback: "🗣️",
  "run-failed": "🔥",
  "agent-blocked": "🙋",
  "agent-done": "🤖",
};

const hintRow = (h: Hint, c: Ctx) => {
  const found = h.comment ? c.comments.get(h.comment) : undefined;
  const pop = found ? commentPop(found.comment, found.issue, c) : "";
  return html`<li class="hint ${h.level}"${pop ? " data-pop" : html` title="${esc(`${c.t.levels[h.level]}: ${h.ref} ${h.text}`)}"`}><span class="lvl">${c.t.levels[h.level]}</span><span class="reason" title="${esc(c.t.reasons[h.reason])}" aria-label="${esc(c.t.reasons[h.reason])}">${REASON_ICON[h.reason]}</span><a href="${esc(h.url)}"${h.pane ? html` target="_self" data-pane="${esc(h.pane)}" data-label="${esc(h.ref)}"` : ""}><span class="ref">${esc(h.ref)}</span> ${esc(h.text)}</a>${muteButton(h.resource, c)}${pop}</li>`;
};

/** A herdr space with its agents and the tickets/PRs its name points to. */
function spaceCard(sp: Space, c: Ctx): string {
  const { t } = c;
  const prs = [...new Set(sp.ticketKeys.flatMap((k) => c.links.prsByTicket.get(k) ?? []))];
  const linked =
    each(sp.ticketKeys, (k) => ticketChip(k, c)) +
    each(prs, (p) => html`<a class="chip" href="${esc(p.url)}" title="${esc(p.title)}">${esc(p.ref)}${p.status === "completed" ? " ✓" : ""}</a>`);
  const agentRow = (a: Space["agents"][number]) => html`
      <li class="agent st-${a.status}">
        <span class="pill">${esc(t.herdr.status[a.status])}</span>
        <span class="agent-name">${esc(a.name ?? a.kind ?? "Agent")}</span>
        <span class="agent-title" title="${esc(a.cwd ?? "")}">${esc(a.title ?? "")}</span>
        ${c.live ? html`<button type="button" data-pane="${esc(a.paneId)}" data-label="${esc(sp.label)}">${t.herdr.open}</button><button type="button" data-focus-pane="${esc(a.paneId)}">${t.herdr.focus}</button>` : ""}
      </li>`;
  const resource = `herdr:${sp.id}`;
  return html`
    <article class="card space-card st-${sp.agents[0]?.status ?? "none"}${mutedClass(resource, c)}">
      <div class="row1"><span class="space-label"><span class="ref">${sp.number}</span> ${esc(sp.label)}</span>${sp.focused ? html`<span class="badge" title="herdr">●</span>` : ""}${
        c.live && !sp.agents.length ? html`<button type="button" data-focus-space="${esc(sp.id)}">${t.herdr.focus}</button>` : ""
      }${muteButton(resource, c)}</div>
      ${linked ? html`<div class="chips">${linked}</div>` : ""}
      ${sp.agents.length ? html`<ul class="agents">${each(sp.agents, agentRow)}</ul>` : html`<div class="meta">${t.herdr.noAgent}</div>`}
    </article>`;
}

/** Turns the stored facts of a change into text in the current language. */
function changeText(ch: Change, t: Dict): { title: string; detail?: string } {
  if (ch.title !== undefined) return { title: ch.title, detail: ch.detail }; // pre-i18n entry
  switch (ch.kind) {
    case "pr-review-request":
      return { title: t.change.reviewRequest(ch.subject), detail: ch.actor && t.change.from(ch.actor) };
    case "pr-merged":
      return { title: t.change.merged(ch.subject) };
    case "pr-vote":
      return { title: `${ch.actor}: ${t.vote[ch.vote ?? "none"]}`, detail: ch.subject };
    case "pr-comment":
    case "issue-comment":
      return { title: t.change.comment(ch.actor ?? "?", ch.subject), detail: ch.text };
    case "pr-gone":
      return { title: t.change.prGone(ch.subject), detail: t.change.prGoneDetail };
    case "pr-checks":
      return { title: ch.checks === "failure" ? t.change.checksFailed(ch.subject) : t.change.checksPassed(ch.subject) };
    case "issue-status":
      return { title: `${ch.from} → ${ch.to}`, detail: ch.subject };
    case "issue-added":
      return { title: t.change.issueAdded(ch.subject), detail: ch.to };
    case "issue-removed":
      return { title: t.change.issueRemoved(ch.subject), detail: t.change.issueRemovedDetail };
    case "run-finished":
      return { title: t.change.runFinished(ch.subject, t.run[ch.conclusion ?? "neutral"]), detail: ch.text };
  }
}

function changeRow(ch: Change, c: Ctx) {
  const { title, detail } = changeText(ch, c.t);
  const muted = !!ch.resource && c.muted.has(ch.resource);
  const found = ch.kind === "issue-comment" ? c.comments.get(ch.id) : undefined;
  const pop = found ? commentPop(found.comment, found.issue, c) : "";
  // Muted entries get no data-at: they don't count as unseen and don't ring.
  // data-id/data-resource let the browser mark single entries (or everything about one PR) as seen.
  return html`<li class="change${muted ? " is-muted" : ""}" data-id="${esc(ch.id)}" data-resource="${esc(ch.resource ?? ch.url)}"${muted ? "" : html` data-at="${esc(ch.detectedAt ?? ch.at)}"`}>
    <div class="row1"><button type="button" class="dot" title="${c.t.markSeen}" aria-label="${c.t.markSeen}"></button><a href="${esc(ch.url)}"><span class="ref">${esc(ch.ref)}</span> ${esc(title)}</a><span class="when">${time(ch.at, c)}</span>${ch.kind === "pr-comment" || ch.kind === "issue-comment" ? sendButton(ch.id, c) : ""}${ch.resource ? muteButton(ch.resource, c) : ""}</div>
    ${detail ? html`<div class="detail"${pop ? " data-pop" : ""}>${esc(detail)}${pop}</div>` : ""}
  </li>`;
}

/** Muted things with a way back; titles come from whatever is still in the snapshot. */
function mutedList(v: View, c: Ctx): string {
  const s = v.snapshot;
  const known = new Map<string, { ref: string; title: string; url: string }>(
    [...s.prs, ...s.issues, ...s.runs].map((x) => [x.id, { ref: x.ref, title: "title" in x ? x.title : "", url: x.url }]),
  );
  for (const r of s.runs) known.set(r.id, { ref: r.name, title: r.title, url: r.url });
  for (const sp of v.herdr?.spaces ?? []) known.set(`herdr:${sp.id}`, { ref: "herdr", title: sp.label, url: "#spaces" });
  return html`<ul class="muted-list">${each([...v.muted], (id) => {
    const k = known.get(id);
    return html`<li>${k ? html`<a href="${esc(k.url)}"><span class="ref">${esc(k.ref)}</span> ${esc(k.title)}</a>` : html`<span class="muted">${esc(id)}</span>`}${muteButton(id, c)}</li>`;
  })}</ul>`;
}

/**
 * A collapsible list. `id` is what the browser remembers the open/closed state under;
 * `closed` is the default for sections that are rarely interesting (recently merged, muted).
 */
const section = (id: string, title: string, count: number, body: string, empty: string, { closed = false } = {}) =>
  html`<details class="section" data-section="${id}"${closed ? "" : " open"}><summary><h2>${title} <span class="count">${count || ""}</span></h2></summary>${count ? body : html`<p class="empty">${empty}</p>`}</details>`;

// --- page ------------------------------------------------------------------------

export type PageOptions = {
  /** true: served by src/server.ts, updated over a WebSocket. false: static file with meta refresh. */
  live: boolean;
  /** language when there's no view yet; otherwise the view's language wins */
  lang: Lang;
};

/** What goes on which page; shared by the page content and the menu (for its badges). */
function lists(v: View) {
  const s = v.snapshot;
  const now = Date.parse(s.takenAt);
  const active = s.prs.filter((p) => p.status === "active");
  const reviews = active.filter((p) => p.role === "reviewer");
  const runs = s.runs
    .filter((r) => r.status !== "completed" || now - Date.parse(r.updatedAt) < v.runsKeepHours * 3_600_000)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return {
    now,
    hasCode: v.sources.some((id) => id !== "jira"),
    hasJira: v.sources.includes("jira"),
    mine: active.filter((p) => p.role === "author"),
    reviews,
    involvedPrs: s.prs.filter((p) => (p.role === "involved" && p.status === "active") || p.role === "watched"),
    involvedIssues: s.issues.filter((i) => (i.scope === "involved" && i.statusCategory !== "done") || i.scope === "watched"),
    tickets: s.issues.filter((i) => i.scope === "list"),
    runs,
    merged: s.prs.filter((p) => p.role === "author" && p.status === "completed"),
  };
}

/** The page menu in the header. Badges only count what wants something from me, so a number means "go look". */
export function renderNav(v: View): string {
  const t = dict(v.lang);
  const l = lists(v);
  const pendingReviews = l.reviews.filter((p) => p.reviewers.some((r) => r.isMe && r.vote === "none") && !v.muted.has(p.id)).length;
  const runsActive = l.runs.filter((r) => r.status !== "completed").length;
  const runFailed = v.hints.some((h) => v.snapshot.runs.some((r) => r.id === h.resource));
  const tab = (page: Page, label: string, count = 0, alert = false) =>
    html`<a class="tab tab-${page}" href="#${page}" target="_self">${label}${count ? html` <span class="count">${count}</span>` : ""}${alert ? html` <span class="alert-dot" title="${t.run.failure}"></span>` : ""}</a>`;
  return [
    l.hasJira ? tab("home", t.tabs.home) : "",
    l.hasCode ? tab("prs", t.tabs.prs, pendingReviews) : "",
    tab("issues", t.tabs.issues, l.involvedIssues.length),
    l.hasCode ? tab("runs", t.tabs.runs, runsActive, runFailed) : "",
    v.herdr ? tab("spaces", t.tabs.spaces, v.herdr.spaces.flatMap((sp) => sp.agents).filter((a) => a.status === "blocked").length) : "",
  ].join("");
}

/** The part that gets swapped on every live update: sidebar + pages. */
export function renderApp(v: View, live: boolean): string {
  const t = dict(v.lang);
  const s = v.snapshot;
  const { now, hasJira, mine, reviews, involvedPrs, involvedIssues, tickets, runs, merged } = lists(v);
  const spaces = v.herdr?.spaces ?? [];
  // same id diff.ts gives an issue comment's change
  const comments = new Map(s.issues.flatMap((issue) => issue.comments.map((comment) => [`issue:${issue.id}:c:${comment.id}`, { comment, issue }] as const)));
  const c: Ctx = { t, now, links: v.links, live, muted: v.muted, watched: v.watched, spaces, herdr: !!v.herdr, canStart: !!v.herdr?.canStart, sent: v.sent, comments };
  const prs = (list: PullRequest[]) => each(list, (p) => prCard(p, c));
  const issues = (list: Issue[]) => each(list, (i) => issueRow(i, c));

  // Every list is a collapsible section; the browser remembers what you closed (see script).
  return html`<div class="layout">
<aside class="sidebar">
  ${section("todo", t.sections.todo, v.hints.length, html`<ul class="hints">${each(v.hints, (h) => hintRow(h, c))}</ul>`, t.empty.todo)}
  ${section("changes", t.sections.changes, v.changes.length, html`<ul class="changes">${each(v.changes, (ch) => changeRow(ch, c))}</ul>`, t.empty.changes)}
  ${live && v.muted.size ? section("muted", t.sections.muted, v.muted.size, mutedList(v, c), "", { closed: true }) : ""}
</aside>
<div class="content">
  ${s.errors.length ? html`<div class="errors">${each(s.errors, (e) => html`<p>⚠ ${esc(e)} – ${t.staleSuffix}</p>`)}</div>` : ""}
  ${v.herdr?.error ? html`<div class="errors"><p>⚠ ${esc(v.herdr.error)}</p></div>` : ""}
  <div class="page page-home">
    ${hasJira ? section("tickets", t.sections.tickets, tickets.length, boardHtml(kanban(tickets, s.board, v.statusOrder), c), t.empty.tickets) : ""}
  </div>
  <div class="page page-prs">
    ${section("my-prs", t.sections.myPrs, mine.length, prs(mine), t.empty.myPrs)}
    ${section("reviews", t.sections.reviews, reviews.length, prs(reviews), t.empty.reviews)}
    ${section("involved-prs", t.sections.involved, involvedPrs.length, prs(involvedPrs), t.empty.involved)}
    ${merged.length ? section("merged", t.sections.merged, merged.length, prs(merged), "", { closed: true }) : ""}
  </div>
  <div class="page page-issues">
    ${section("involved-issues", t.sections.involved, involvedIssues.length, issues(involvedIssues), t.empty.involved)}
  </div>
  <div class="page page-runs">
    ${section("runs", t.sections.runs, runs.length, each(runs, (r) => runRow(r, c)), t.empty.runs)}
  </div>
  ${v.herdr ? spacesPage(spaces, c) : ""}
</div>
</div>`;
}

/** herdr spaces: the ones named after a ticket first, the rest (reviews, side projects) below. */
function spacesPage(spaces: Space[], c: Ctx): string {
  const linked = spaces.filter((sp) => sp.ticketKeys.length);
  const other = spaces.filter((sp) => !sp.ticketKeys.length);
  const cards = (list: Space[]) => each(list, (sp) => spaceCard(sp, c));
  return html`<div class="page page-spaces">
    ${section("spaces", c.t.herdr.section, linked.length, cards(linked), c.t.herdr.empty)}
    ${other.length ? section("spaces-other", c.t.herdr.other, other.length, cards(other), "") : ""}
  </div>`;
}

const PAGES = ["home", "prs", "issues", "runs", "spaces"] as const;
type Page = (typeof PAGES)[number];

/** Full page. Without a view (server just started, nothing stored yet) it shows a placeholder. */
export function renderHtml(v: View | undefined, opts: PageOptions): string {
  const lang = v?.lang ?? opts.lang;
  const t = dict(lang);
  const takenAt = v?.snapshot.takenAt;
  const hm = new Intl.DateTimeFormat(t.locale, { hour: "2-digit", minute: "2-digit" });
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${!opts.live && v ? html`<meta http-equiv="refresh" content="${v.refreshSeconds}">` : ""}
<base target="_blank">
<title>${t.title}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%233b5bdb'/%3E%3Cpath d='M4 11V7M8 11V4M12 11V8' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E">
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>${t.title}</h1>
  <nav id="nav" class="tabs">${v ? renderNav(v) : ""}</nav>
  <span class="spacer"></span>
  <span class="stamp">${t.asOf} <time id="stamp" class="abs" datetime="${takenAt ?? ""}">${takenAt ? hm.format(new Date(takenAt)) : "–"}</time></span>
  ${opts.live ? html`<span id="conn" class="conn off">${t.client.connecting}</span>` : ""}
  <span id="unseen" class="unseen-count"></span>
  ${opts.live ? html`<button id="watch-open" type="button">${t.watch.button}</button><button id="sound" type="button" title="${t.soundTitle}"></button><button id="refresh" type="button">${t.refresh}</button>` : ""}
  <button id="seen" type="button">${t.seenAll}</button>
  ${opts.live ? html`<button id="lang" type="button" data-lang="${lang === "de" ? "en" : "de"}">${t.switchLang}</button>` : ""}
</header>
${opts.live ? watchDialog(t) : ""}
${opts.live && v?.herdr ? agentDialog(t) + startDialog(t) : ""}
<div id="app">${v ? renderApp(v, opts.live) : html`<main><p class="empty">${t.firstPoll}</p></main>`}</div>
<script>${script(opts.live, t)}</script>
</body>
</html>`;
}

// Outside #app on purpose: live updates replace #app and would wipe what you're typing.
const watchDialog = (t: Dict) => html`
<dialog id="watch-dialog">
  <form id="watch-form">
    <h3>${t.watch.title}</h3>
    <p class="help">${t.watch.help}</p>
    <div class="watch-input"><input id="watch-url" type="url" required placeholder="${t.watch.placeholder}" autocomplete="off"><button type="submit">${t.watch.add}</button></div>
    <p id="watch-msg" class="watch-msg"></p>
    <ul id="watch-list" class="watch-list"></ul>
    <button id="watch-close" type="button" class="close" aria-label="Close">✕</button>
  </form>
</dialog>`;

// An agent as a chat (Claude's transcript) or its raw terminal, and a box to write to it.
// Outside #app for the same reason.
const agentDialog = (t: Dict) => html`
<dialog id="agent-dialog" class="agent-dialog">
  <form id="agent-form">
    <h3 id="agent-title"></h3>
    <div class="agent-tabs">
      <button id="tab-chat" type="button" class="on">${t.herdr.dialog.chat}</button>
      <button id="tab-terminal" type="button">${t.herdr.dialog.terminal}</button>
      <span id="agent-status" class="agent-status"></span>
      <span class="spacer"></span>
      <button id="agent-focus" type="button">${t.herdr.focus}</button>
    </div>
    <div id="agent-chat" class="agent-chat"></div>
    <pre id="agent-out" class="agent-out" hidden></pre>
    <p id="agent-blocked" class="help warn-note" hidden>${t.herdr.dialog.blockedNote}</p>
    <div class="agent-input">
      <textarea id="agent-text" rows="2" placeholder="${t.herdr.dialog.placeholder}"></textarea>
      <button type="submit">${t.herdr.dialog.send}</button>
    </div>
    <span id="agent-msg" class="agent-msg"></span>
    <button id="agent-close" type="button" class="close" aria-label="Close">✕</button>
  </form>
</dialog>`;

// Name and first prompt of a new space, prefilled from prompts.json.
const startDialog = (t: Dict) => html`
<dialog id="start-dialog" class="start-dialog">
  <form id="start-form">
    <h3>${t.herdr.start.title}</h3>
    <label>${t.herdr.start.label}<input id="start-label" type="text" required autocomplete="off"></label>
    <label>${t.herdr.start.prompt}<textarea id="start-prompt" rows="8" required></textarea></label>
    <div class="agent-actions"><button id="start-submit" type="submit">${t.herdr.start.create}</button><span id="start-msg" class="agent-msg"></span></div>
    <button id="start-close" type="button" class="close" aria-label="Close">✕</button>
  </form>
</dialog>`;

// Client side. "Seen" state and the sound setting live in localStorage; mutes and watches on the server.
// Times are formatted here too: they stay current between updates and use the browser's time zone.
// The texts come in as JSON; "<" is escaped so nothing in them can close the script tag.
const script = (live: boolean, t: Dict) => `
(() => {
  const LIVE = ${live};
  const T = ${JSON.stringify({ ...t.client, watchRemove: t.watch.remove, watchEmpty: t.watch.empty, agentStatus: t.herdr.status, toolSteps: t.herdr.dialog.toolSteps, herdrStart: t.herdr.start }).replace(/</g, "\\u003c")};
  const LOCALE = ${JSON.stringify(t.locale)};
  const fill = (s, n) => s.replace("{n}", n);
  const $ = (id) => document.getElementById(id);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const SEEN_KEY = "dev-dashboard.lastSeen";
  const SEEN_IDS_KEY = "dev-dashboard.seenIds";
  const SOUND_KEY = "dev-dashboard.sound";
  const baseTitle = document.title;

  // --- times ---
  const full = new Intl.DateTimeFormat(LOCALE, { dateStyle: "short", timeStyle: "short" });
  const hm = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });
  const ago = (t) => {
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return T.now;
    if (min < 60) return fill(T.minutes, min);
    const h = Math.round(min / 60);
    if (h < 24) return fill(T.hours, h);
    const d = Math.round(h / 24);
    return d === 1 ? T.yesterday : fill(T.days, d);
  };
  const times = () => document.querySelectorAll("time[datetime]").forEach((el) => {
    const t = Date.parse(el.getAttribute("datetime"));
    if (Number.isNaN(t)) return;
    if (el.classList.contains("abs")) el.textContent = hm.format(t);
    else { el.textContent = ago(t); el.title = full.format(t); }
  });

  // --- unseen changes ---
  // "Mark all seen" stores a timestamp; single entries marked on top of that are kept as ids.
  const readIds = () => { try { return new Set(JSON.parse(store.get(SEEN_IDS_KEY) || "[]")); } catch { return new Set(); } };
  const mark = () => {
    const lastSeen = Number(store.get(SEEN_KEY)) || 0;
    const ids = readIds();
    let n = 0;
    document.querySelectorAll("[data-at]").forEach((el) => {
      const isNew = Date.parse(el.dataset.at) > lastSeen && !ids.has(el.dataset.id);
      el.classList.toggle("unseen", isNew);
      if (isNew) n++;
    });
    // forget ids that left the change log
    const present = new Set(Array.from(document.querySelectorAll(".change[data-id]"), (el) => el.dataset.id));
    const kept = [...ids].filter((id) => present.has(id));
    if (kept.length !== ids.size) store.set(SEEN_IDS_KEY, JSON.stringify(kept));
    document.title = n ? "(" + n + ") " + baseTitle : baseTitle;
    $("unseen").textContent = n ? fill(T.unseen, n) : "";
  };
  const markSeen = (rows) => {
    const ids = readIds();
    rows.forEach((row) => ids.add(row.dataset.id));
    store.set(SEEN_IDS_KEY, JSON.stringify([...ids]));
    mark();
  };
  $("seen").addEventListener("click", () => { store.set(SEEN_KEY, String(Date.now())); store.set(SEEN_IDS_KEY, "[]"); mark(); });
  // The blue dot of a new entry marks just that one; opening an entry's link marks everything new
  // about that PR/issue/run.
  // Listening on #app, because live updates replace its content.
  $("app").addEventListener("click", (e) => {
    const row = e.target.closest(".change[data-id]");
    if (!row) return;
    if (e.target.closest("button.dot")) {
      e.preventDefault();
      if (row.classList.contains("unseen")) markSeen([row]);
    } else if (e.target.closest("a")) {
      markSeen(document.querySelectorAll('.change.unseen[data-resource="' + CSS.escape(row.dataset.resource) + '"]'));
    }
  });

  // --- tabs: #prs, #issues, #runs; the attribute sits on <body>, so live updates keep the page ---
  // Only pages that have a tab count (no Jira → no Dashboard tab); default is the first tab.
  const PAGES = ${JSON.stringify(PAGES)};
  const showPage = () => {
    const available = PAGES.filter((p) => document.querySelector(".tab-" + p));
    const page = location.hash.slice(1);
    document.body.dataset.page = available.includes(page) ? page : available[0] || "home";
  };
  window.addEventListener("hashchange", showPage);
  showPage();

  // --- collapsible sections: remember open/closed per section, re-apply after live updates ---
  const SECTIONS_KEY = "dev-dashboard.sections";
  const readSections = () => { try { return JSON.parse(store.get(SECTIONS_KEY) || "{}"); } catch { return {}; } };
  let restoring = false;
  const restoreSections = () => {
    const saved = readSections();
    restoring = true;
    document.querySelectorAll("details[data-section]").forEach((d) => {
      if (d.dataset.section in saved) d.open = saved[d.dataset.section];
    });
    // "toggle" fires asynchronously, so stop ignoring it only after those events went through
    setTimeout(() => { restoring = false; });
  };
  // toggle doesn't bubble, hence the capture listener
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (restoring || !d.dataset || !d.dataset.section) return;
    const saved = readSections();
    saved[d.dataset.section] = d.open;
    store.set(SECTIONS_KEY, JSON.stringify(saved));
  }, true);
  restoreSections();

  // sidebar and tabs stick right below the header, whose height depends on how the buttons wrap
  const headerHeight = () => document.documentElement.style.setProperty("--header-h", document.querySelector("header").offsetHeight + "px");
  window.addEventListener("resize", headerHeight);
  headerHeight();

  times();
  mark();
  setInterval(times, 30000);
  // --- comment popover: [data-pop] elements carry the formatted comment in a <template> ---
  // One floating element for all of them, so it isn't cut off by scrolling columns.
  const pop = document.createElement("div");
  pop.className = "popover";
  pop.hidden = true;
  document.body.append(pop);
  let popFor = null;
  let popTimer = null;
  const hidePop = () => { clearTimeout(popTimer); pop.hidden = true; popFor = null; };
  const showPop = (el) => {
    clearTimeout(popTimer);
    if (popFor === el && !pop.hidden) return;
    const tpl = el.querySelector(":scope > template.pop");
    if (!tpl) return;
    popFor = el;
    pop.replaceChildren(tpl.content.cloneNode(true));
    pop.hidden = false;
    times();
    // below the element if it fits, otherwise above; always inside the window
    const r = el.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
    pop.style.top = Math.max(8, r.bottom + 6 + h <= innerHeight ? r.bottom + 6 : r.top - h - 6) + "px";
  };
  const popTarget = (node) => (node && node.closest ? node.closest("[data-pop], .popover") : null);
  document.addEventListener("mouseover", (e) => {
    const el = popTarget(e.target);
    if (!el) return;
    if (el === pop) clearTimeout(popTimer);
    else showPop(el);
  });
  // a short delay, so the mouse can move over into the popover (to select text or click a link)
  document.addEventListener("mouseout", (e) => {
    const from = popTarget(e.target);
    if (from && from !== popTarget(e.relatedTarget)) { clearTimeout(popTimer); popTimer = setTimeout(hidePop, 200); }
  });
  // touch screens have no hover: tap toggles
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-pop]");
    if (el && !e.target.closest("a, button")) { if (popFor === el && !pop.hidden) hidePop(); else showPop(el); }
    else if (!e.target.closest(".popover")) hidePop();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePop(); });
  document.addEventListener("scroll", (e) => { if (!pop.contains(e.target)) hidePop(); }, true);

  if (!LIVE) return;

  const api = (method, path, body) =>
    fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then((r) => r.json().catch(() => ({})).then((j) => (r.ok ? j : Promise.reject(j))));

  // --- language switch: cookie, so the server renders the right language right away ---
  $("lang").addEventListener("click", (e) => {
    document.cookie = "lang=" + e.currentTarget.dataset.lang + "; path=/; max-age=31536000; SameSite=Lax";
    location.reload();
  });

  // --- mute: the buttons live inside #app, which gets replaced, so listen on #app ---
  $("app").addEventListener("click", (e) => {
    const b = e.target.closest("button.mute");
    if (!b) return;
    e.preventDefault();
    const muted = b.dataset.muted !== "1";
    b.dataset.muted = muted ? "1" : "0";
    b.textContent = muted ? "🔕" : "🔔";
    api("POST", "/api/mute", { id: b.dataset.id, muted }).catch(() => {});
  });

  // --- watch dialog ---
  const dialog = $("watch-dialog");
  const loadWatches = () => api("GET", "/api/watches").then((list) => {
    const ul = $("watch-list");
    ul.textContent = "";
    if (!list.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = T.watchEmpty;
      ul.append(li);
    }
    for (const w of list) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = w.url;
      a.textContent = w.title || w.url;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "✕";
      b.title = T.watchRemove;
      b.addEventListener("click", () => api("DELETE", "/api/watches?id=" + encodeURIComponent(w.id)).then(loadWatches, () => {}));
      li.append(a, b);
      ul.append(li);
    }
  }).catch(() => {});
  $("watch-open").addEventListener("click", () => { $("watch-msg").textContent = ""; dialog.showModal(); loadWatches(); });
  $("watch-close").addEventListener("click", () => dialog.close());
  $("watch-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("watch-url");
    $("watch-msg").textContent = "";
    api("POST", "/api/watches", { url: input.value }).then(
      () => { input.value = ""; loadWatches(); },
      (err) => { $("watch-msg").textContent = T.watchErrors[err && err.error] || T.watchErrors.failed; },
    );
  });

  // --- herdr agents: chat from Claude's transcript (or the raw terminal), polled while open ---
  // The buttons that open it live in #app, which gets replaced, so listen on #app.
  const agent = $("agent-dialog");
  let pane = null;
  let label = "";
  let view = "chat";
  let since = "";
  let pending = null; // sent, but not in the transcript yet
  let timer = null;
  const agentMsg = (text, bad) => { const el = $("agent-msg"); el.textContent = text || ""; el.classList.toggle("bad", !!bad); };
  const agentError = (err) => T.agentErrors[err && err.error] || T.agentErrors.failed;
  // just enough markdown for Claude's answers: code blocks, inline code, bold
  const md = (s) => s
    .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])
    .replace(/\\x60\\x60\\x60[^\\n]*\\n([\\s\\S]*?)\\x60\\x60\\x60/g, (_, code) => "<pre>" + code + "</pre>")
    .replace(/\\x60([^\\x60\\n]+)\\x60/g, "<code>$1</code>")
    .replace(/\\*\\*([^*\\n]+)\\*\\*/g, "<b>$1</b>");
  const bubble = (m, extra) => {
    const el = document.createElement("div");
    el.className = "msg " + m.role + (extra ? " " + extra : "");
    if (m.role === "assistant") el.innerHTML = md(m.text);
    else el.textContent = m.role === "tool" ? "🔧 " + m.text : m.text;
    return el;
  };
  const nearBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  const setStatus = (s) => {
    const el = $("agent-status");
    el.textContent = T.agentStatus[s] || "";
    el.className = "agent-status st-" + s;
    $("agent-blocked").hidden = s !== "blocked";
  };
  const showView = (v) => {
    view = v;
    $("agent-chat").hidden = v !== "chat";
    $("agent-out").hidden = v !== "terminal";
    $("tab-chat").classList.toggle("on", v === "chat");
    $("tab-terminal").classList.toggle("on", v === "terminal");
  };
  const showPending = () => {
    const box = $("agent-chat");
    if (pending) { box.append(bubble({ role: "user", text: pending }, "pending")); box.scrollTop = box.scrollHeight; }
  };
  const loadChat = () => api("GET", "/api/herdr/chat?pane=" + encodeURIComponent(pane) + "&since=" + since).then((r) => {
    setStatus(r.status);
    if (!r.found) {
      // not Claude, or no transcript to be found: the terminal is all there is
      $("tab-chat").hidden = true;
      showView("terminal");
      return loadOutput();
    }
    $("tab-chat").hidden = false;
    if (r.unchanged) return;
    since = String(r.size);
    if (r.title) $("agent-title").textContent = label + " · " + r.title;
    const box = $("agent-chat");
    const stick = nearBottom(box) || !box.childElementCount;
    box.textContent = "";
    // a run of tool calls becomes one line you can open: "🔧 5 steps · last one"
    let run = [];
    const flush = () => {
      if (run.length === 1) box.append(bubble(run[0]));
      else if (run.length) {
        const d = document.createElement("details");
        d.className = "msg tool tools";
        const s = document.createElement("summary");
        s.textContent = "🔧 " + fill(T.toolSteps, run.length) + " · " + run[run.length - 1].text;
        d.append(s, ...run.map((m) => Object.assign(document.createElement("div"), { textContent: m.text })));
        box.append(d);
      }
      run = [];
    };
    r.messages.forEach((m) => { if (m.role === "tool") run.push(m); else { flush(); box.append(bubble(m)); } });
    flush();
    const lastUser = r.messages.filter((m) => m.role === "user").pop();
    if (pending && lastUser && lastUser.text === pending.trim()) pending = null;
    showPending();
    if (stick) box.scrollTop = box.scrollHeight;
  });
  const loadOutput = () => api("GET", "/api/herdr/read?pane=" + encodeURIComponent(pane)).then((r) => {
    setStatus(r.status);
    const out = $("agent-out");
    const stick = nearBottom(out);
    out.textContent = r.text;
    if (stick) out.scrollTop = out.scrollHeight;
  });
  // one poll at a time; schedule() replaces whatever was planned
  const schedule = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!agent.open) return;
      (view === "chat" ? loadChat() : loadOutput())
        .catch((err) => agentMsg(agentError(err), true))
        .finally(() => { if (agent.open) schedule(2000); });
    }, ms);
  };
  const focus = (target) => api("POST", "/api/herdr/focus", target).catch((err) => agentMsg(agentError(err), true));
  // prefill: a prompt to look over before sending; comment: its change id, so the ➤ gets a ✓
  let commentFor = null;
  const openAgent = (p, l, prefill, comment, note) => {
    pane = p;
    label = l || p;
    since = "";
    pending = null;
    commentFor = comment || null;
    $("agent-title").textContent = label;
    $("agent-chat").textContent = "";
    $("agent-out").textContent = "";
    $("tab-chat").hidden = false;
    setStatus("");
    agentMsg(note || "", !!note);
    showView("chat");
    const input = $("agent-text");
    input.value = prefill || "";
    input.rows = prefill ? 7 : 2;
    if (!agent.open) agent.showModal();
    schedule(0);
    input.focus();
    input.setSelectionRange(0, 0);
  };
  $("app").addEventListener("click", (e) => {
    const el = e.target.closest("[data-pane], [data-focus-pane], [data-focus-space]");
    if (!el || !agent) return;
    e.preventDefault();
    if (el.dataset.focusPane) return focus({ pane: el.dataset.focusPane });
    if (el.dataset.focusSpace) return focus({ space: el.dataset.focusSpace });
    openAgent(el.dataset.pane, el.dataset.label);
  });

  // --- new space for a ticket/PR (🤖 +), or a comment for its agent (➤) ---
  // On document: the comment popover with its ➤ lives outside #app.
  const startDlg = $("start-dialog");
  let startReq = null;
  const startMsg = (text, bad) => { const el = $("start-msg"); el.textContent = text || ""; el.classList.toggle("bad", !!bad); };
  const startError = (err) => (err && err.error === "no-workdir" ? T.herdrStart.noWorkdir : agentError(err));
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-start], [data-send-comment]");
    if (!el || !startDlg) return;
    e.preventDefault();
    hidePop();
    const kind = el.dataset.start || "comment";
    const id = el.dataset.start ? el.dataset.id : el.dataset.sendComment;
    api("GET", "/api/herdr/prepare?kind=" + kind + "&id=" + encodeURIComponent(id)).then((r) => {
      // there's an agent already: the prompt goes into its chat, to look over and send
      if (r.agent) return openAgent(r.agent.pane, r.agent.label, r.prompt, kind === "comment" ? id : null);
      startReq = { kind, id };
      $("start-label").value = r.label;
      $("start-prompt").value = r.prompt;
      $("start-submit").disabled = !r.canStart;
      startMsg(r.canStart ? "" : T.herdrStart.noWorkdir, !r.canStart);
      startDlg.showModal();
      $("start-prompt").focus();
      $("start-prompt").setSelectionRange(0, 0);
    }, (err) => {
      startReq = null;
      $("start-submit").disabled = true;
      startMsg(startError(err), true);
      startDlg.showModal();
    });
  });
  if (startDlg) {
    $("start-close").addEventListener("click", () => startDlg.close());
    $("start-form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (!startReq) return;
      const req = startReq;
      const name = $("start-label").value;
      const prompt = $("start-prompt").value;
      const btn = $("start-submit");
      btn.disabled = true;
      startMsg(T.herdrStart.starting);
      api("POST", "/api/herdr/start", { kind: req.kind, id: req.id, label: name, prompt }).then((r) => {
        startDlg.close();
        // asked something first (e.g. "trust this folder?"): the prompt waits in the chat box
        if (r.sent) openAgent(r.pane, name);
        else openAgent(r.pane, name, prompt, req.kind === "comment" ? req.id : null, T.herdrStart.needsAnswer);
      }, (err) => startMsg(startError(err), true)).finally(() => { btn.disabled = false; });
    });
  }
  if (agent) {
    agent.addEventListener("close", () => clearTimeout(timer));
    $("agent-close").addEventListener("click", () => agent.close());
    $("agent-focus").addEventListener("click", () => focus({ pane }));
    $("tab-chat").addEventListener("click", () => { showView("chat"); schedule(0); });
    $("tab-terminal").addEventListener("click", () => { showView("terminal"); schedule(0); });
    // like a chat: Enter sends, Shift+Enter is a new line
    $("agent-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("agent-form").requestSubmit(); }
    });
    $("agent-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = $("agent-text");
      const text = input.value;
      if (!text.trim()) return;
      agentMsg("");
      input.value = "";
      const comment = commentFor;
      api("POST", "/api/herdr/prompt", { pane, text, comment: comment || undefined }).then(
        () => { pending = text; commentFor = null; input.rows = 2; if (view === "chat") showPending(); schedule(700); },
        (err) => { input.value = text; agentMsg(agentError(err), true); },
      );
    });
  }

  // --- sound ---
  // Browsers only allow audio after a user gesture; until then the button asks for a click.
  let ctx;
  const soundOn = () => store.get(SOUND_KEY) !== "off";
  const soundLabel = () => {
    const b = $("sound");
    const ready = !!ctx && ctx.state === "running";
    b.textContent = !soundOn() ? T.soundOff : ready ? T.soundOn : T.soundClick;
    b.classList.toggle("warn", soundOn() && !ready);
  };
  const unlock = () => {
    if (!soundOn()) return Promise.resolve();
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.resolve();
      ctx = new AC();
      ctx.onstatechange = soundLabel;
    }
    return ctx.state === "running" ? Promise.resolve() : ctx.resume().catch(() => {});
  };
  const ding = () => {
    if (!soundOn() || !ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    [[880, 0], [1318.5, 0.13]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + delay);
      gain.gain.exponentialRampToValueAtTime(0.25, t + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + delay + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.65);
    });
  };
  $("sound").addEventListener("click", () => {
    store.set(SOUND_KEY, soundOn() ? "off" : "on");
    if (soundOn()) unlock().then(ding); // short preview so you know what it sounds like
    soundLabel();
  });
  document.addEventListener("pointerdown", () => unlock().then(soundLabel));
  document.addEventListener("keydown", () => unlock().then(soundLabel));
  unlock(); // without a prior gesture resume() stays pending, so label right away
  soundLabel();

  // --- live updates ---
  // Only unmuted changes carry data-at, so muted ones never ring.
  const newest = () => Math.max(0, ...Array.from(document.querySelectorAll(".change[data-at]"), (el) => Date.parse(el.dataset.at)));
  let known = newest();
  // an agent starting to wait for you rings too (muted spaces don't – their hints are gone)
  const waiting = () => document.querySelectorAll(".hints [data-pane]").length;
  let waitingBefore = waiting();
  let retry = 1000;
  const conn = (state, text) => { const el = $("conn"); el.className = "conn " + state; el.textContent = text; };
  const apply = (msg) => {
    hidePop(); // its element is about to be replaced
    $("app").innerHTML = msg.html;
    $("nav").innerHTML = msg.nav;
    restoreSections();
    showPage(); // tabs can come and go with the data
    $("stamp").setAttribute("datetime", msg.takenAt);
    times();
    mark();
    const n = newest();
    const w = waiting();
    if (n > known || w > waitingBefore) ding();
    known = Math.max(known, n);
    waitingBefore = w;
  };
  const connect = () => {
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    ws.onopen = () => { retry = 1000; conn("on", T.live); };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "view") { apply(msg); conn("on", T.live); }
      else if (msg.type === "polling") conn("busy", T.polling);
    };
    ws.onclose = () => {
      conn("off", T.offline);
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
  };
  connect();
  $("refresh").addEventListener("click", () => fetch("/api/refresh", { method: "POST" }).catch(() => {}));
})();`;

const CSS = `
:root {
  --bg: #f6f7f9; --surface: #fff; --text: #1d2330; --muted: #677085; --line: #e3e6ec;
  --accent: #3b5bdb; --ok: #2b8a3e; --warn: #c77700; --bad: #c92a2a;
  --ok-bg: #e6f4ea; --warn-bg: #fff4e0; --bad-bg: #fdecec; --new-bg: #eef2ff; --neutral-bg: #eef0f4;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12151b; --surface: #1a1e26; --text: #e4e7ee; --muted: #8d95a8; --line: #2a303b;
    --accent: #8ea6ff; --ok: #69c47f; --warn: #f0a845; --bad: #ff7b7b;
    --ok-bg: #1d3325; --warn-bg: #3a2c14; --bad-bg: #3d1e1e; --new-bg: #232a45; --neutral-bg: #262b35;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: inherit; text-decoration: none; }
a:hover { color: var(--accent); }
code { font: 12px ui-monospace, "Cascadia Code", Consolas, monospace; }
header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 10px 20px; background: var(--surface); border-bottom: 1px solid var(--line); }
h1 { font-size: 16px; margin: 0; }
.stamp, .meta, .when, .empty, .muted { color: var(--muted); }
.spacer { flex: 1; }
.unseen-count { color: var(--accent); font-weight: 600; }
button { font: inherit; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; }
button:hover { border-color: var(--accent); }
button.warn { border-color: var(--warn); color: var(--warn); }
.conn { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.conn::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.conn.on::before { background: var(--ok); }
.conn.busy::before { background: var(--warn); }
.conn.off::before { background: var(--bad); }
.errors { margin: 0 0 12px; padding: 8px 12px; border-radius: 8px; background: var(--bad-bg); color: var(--bad); }
.errors p { margin: 2px 0; }
main { padding: 16px 20px; }
/* sidebar (to do + changes) stays put, the content scrolls */
.layout { display: grid; grid-template-columns: minmax(320px, 400px) minmax(0, 1fr); align-items: start; }
.sidebar { position: sticky; top: var(--header-h, 51px); max-height: calc(100vh - var(--header-h, 51px)); overflow-y: auto; padding: 16px 14px 40px 20px; border-right: 1px solid var(--line); }
.content { min-width: 0; padding: 16px 20px 40px; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  .sidebar { position: static; max-height: none; border-right: 0; border-bottom: 1px solid var(--line); padding-right: 20px; }
}
/* compact sidebar: level = border colour, long texts cut to two lines (full text in the tooltip) */
.sidebar .hints li { padding: 6px 10px; }
.sidebar .lvl { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.sidebar .hints a { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sidebar .change .row1 > a { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.sidebar .change .detail { -webkit-line-clamp: 1; }
/* tabs */
/* page menu in the header */
.tabs { display: flex; flex-wrap: wrap; gap: 2px; margin-left: 8px; }
.tab { padding: 4px 10px; border-radius: 6px; color: var(--muted); font-weight: 500; white-space: nowrap; }
.tab:hover { background: var(--neutral-bg); color: var(--text); }
.tab .count { font-size: 11px; padding: 0 6px; border-radius: 999px; background: var(--new-bg); color: var(--accent); }
.alert-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--bad); vertical-align: middle; }
.page { display: none; }
body[data-page="home"] .page-home, body[data-page="prs"] .page-prs, body[data-page="issues"] .page-issues, body[data-page="runs"] .page-runs, body[data-page="spaces"] .page-spaces { display: block; }
body[data-page="home"] .tab-home, body[data-page="prs"] .tab-prs, body[data-page="issues"] .tab-issues, body[data-page="runs"] .tab-runs, body[data-page="spaces"] .tab-spaces { color: var(--text); background: var(--new-bg); }
/* ticket kanban */
.board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(200px, 1fr); gap: 10px; overflow-x: auto; align-items: start; padding-bottom: 6px; }
.board-col { background: var(--neutral-bg); border-radius: 8px; padding: 8px; min-height: 64px; }
.board-col h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 2px 4px 8px; font-weight: 600; }
.board-col .card { margin-bottom: 6px; }
.ticket-card { padding: 7px 10px; }
.ticket-card .row1 > a { flex: none; }
.ticket-card .type { margin-left: auto; font-size: 11px; color: var(--muted); }
.points { font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 999px; background: var(--neutral-bg); color: var(--muted); }
.board-col h3 { display: flex; align-items: baseline; gap: 6px; }
.board-col h3 .points { margin-left: auto; white-space: nowrap; background: var(--bg); letter-spacing: 0; }
.ticket-card .title { display: block; margin-top: 2px; line-height: 1.35; }
.ticket-card .meta { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 5px; }
.ticket-card .merged { color: var(--ok); margin-left: 2px; }
.ticket-card .feedback { color: var(--warn); }
details.section { margin-bottom: 22px; }
details.section > summary { list-style: none; cursor: pointer; user-select: none; }
details.section > summary::-webkit-details-marker { display: none; }
details.section > summary h2::before { content: "▾"; display: inline-block; width: 12px; color: var(--muted); }
details.section:not([open]) > summary h2::before { content: "▸"; }
details.section:not([open]) { margin-bottom: 10px; }
details.section > summary:hover h2 { color: var(--text); }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 0 0 8px; }
.count { color: var(--text); }
ul { list-style: none; margin: 0; padding: 0; }
.ref { font-weight: 600; color: var(--accent); margin-right: 2px; }
.card, .hints li, .changes li { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin-bottom: 6px; }
.row1 { display: flex; align-items: baseline; gap: 8px; }
.row1 > a { flex: 1; min-width: 0; }
.meta { font-size: 12px; margin-top: 2px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--neutral-bg); }
.chip b { font-weight: 700; }
.chip sup { color: var(--muted); }
.vote-approved, .vote-approvedWithSuggestions { background: var(--ok-bg); color: var(--ok); }
.vote-waiting { background: var(--warn-bg); color: var(--warn); }
.vote-rejected { background: var(--bad-bg); color: var(--bad); }
.vote-none { color: var(--muted); }
.ticket { padding-right: 2px; }
.pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; background: var(--neutral-bg); color: var(--muted); }
.pill.cat-indeterminate { background: var(--new-bg); color: var(--accent); }
.pill.cat-done { background: var(--ok-bg); color: var(--ok); }
.badge { font-size: 11px; padding: 1px 7px; border-radius: 4px; background: var(--neutral-bg); color: var(--muted); white-space: nowrap; }
.badge.warn { background: var(--warn-bg); color: var(--warn); }
.badge.bad { background: var(--bad-bg); color: var(--bad); }
blockquote { margin: 6px 0 0; padding: 4px 10px; border-left: 3px solid var(--warn); background: var(--warn-bg); border-radius: 0 6px 6px 0; font-size: 13px; }
.hints li { display: flex; gap: 10px; align-items: baseline; border-left: 3px solid var(--line); }
.hints .reason { flex: none; width: 1.3em; text-align: center; font-size: 14px; cursor: default; }
.sidebar .hints li { gap: 8px; }
.hints li.action { border-left-color: var(--warn); }
.hints li.ready { border-left-color: var(--ok); }
.lvl { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--muted); min-width: 46px; }
.action .lvl { color: var(--warn); }
.ready .lvl { color: var(--ok); }
.change .detail { color: var(--muted); font-size: 13px; margin: 2px 0 0 16px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.change .when { font-size: 12px; white-space: nowrap; }
.change.unseen { background: var(--new-bg); }
/* the dot of a new entry is its "mark as seen" button: a bigger hit area around an 8px dot */
button.dot { position: relative; flex: none; align-self: center; width: 16px; height: 16px; margin: 0 -4px; padding: 0; border: 0; border-radius: 50%; background: none; pointer-events: none; }
button.dot::before { content: ""; position: absolute; inset: 4px; border-radius: 50%; transition: inset .12s, background .12s, box-shadow .12s; }
.change.unseen button.dot { pointer-events: auto; cursor: pointer; }
.change.unseen button.dot::before { background: var(--accent); }
/* on hover it turns into a ring: click and it's gone */
.change.unseen button.dot:hover::before, .change.unseen button.dot:focus-visible::before { inset: 2px; background: transparent; box-shadow: inset 0 0 0 2px var(--accent); }
/* mute: quiet until you hover, always visible when on; touch screens have no hover */
button.mute { padding: 0 4px; border: 0; background: none; font-size: 12px; line-height: 1.2; opacity: 0; flex: none; }
.card:hover button.mute, li:hover > button.mute, li:hover .row1 button.mute, button.mute.on, button.mute:focus-visible { opacity: .7; }
button.mute:hover { opacity: 1; }
@media (hover: none) { button.mute { opacity: .45; } }
.is-muted { opacity: .55; }
.change.is-muted { background: var(--surface); }
.run .glyph { flex: none; font-size: 13px; }
.run-failure .state { color: var(--bad); font-weight: 600; }
.run-success .state { color: var(--ok); }
.run-running .state, .run-queued .state { color: var(--warn); }
.muted-list li { display: flex; align-items: baseline; gap: 8px; padding: 4px 0; }
.muted-list li > a, .muted-list li > span { flex: 1; min-width: 0; }
dialog { border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--text); padding: 18px 20px; width: min(560px, 92vw); }
dialog::backdrop { background: rgb(0 0 0 / .35); }
dialog h3 { margin: 0 0 6px; font-size: 15px; }
dialog form { position: relative; }
dialog .help { color: var(--muted); margin: 0 0 12px; font-size: 13px; }
dialog .close { position: absolute; top: -8px; right: -8px; border: 0; }
.watch-input { display: flex; gap: 8px; }
.watch-input input { flex: 1; min-width: 0; font: inherit; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); }
.watch-msg { color: var(--bad); min-height: 1em; margin: 6px 0; font-size: 13px; }
.watch-list li { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; border-top: 1px solid var(--line); }
.watch-list li > a { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.watch-list li.empty { color: var(--muted); }
.watch-list button { padding: 0 6px; }
/* comment popover */
[data-pop] { cursor: help; }
.popover { position: fixed; z-index: 10; width: min(560px, calc(100vw - 16px)); max-height: min(60vh, 520px); overflow: auto; padding: 10px 14px; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 28px rgb(0 0 0 / .25); font-size: 13px; line-height: 1.5; cursor: auto; }
.pop-head { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
.pop-head b { color: var(--text); }
.wiki p { margin: 0 0 8px; }
.wiki > :last-child { margin-bottom: 0; }
.wiki h3, .wiki h4, .wiki h5, .wiki h6 { margin: 10px 0 4px; font-size: 13px; }
.wiki ul, .wiki ol { margin: 0 0 8px; padding-left: 20px; }
.wiki ul { list-style: disc; }
.wiki ol { list-style: decimal; }
.wiki pre { margin: 0 0 8px; padding: 6px 8px; background: var(--neutral-bg); border-radius: 6px; overflow-x: auto; font: 12px ui-monospace, "Cascadia Code", Consolas, monospace; }
.wiki code { padding: 0 3px; background: var(--neutral-bg); border-radius: 3px; }
.wiki pre code { padding: 0; background: none; }
.wiki blockquote { margin: 0 0 8px; padding: 2px 10px; border-left: 3px solid var(--line); background: none; color: var(--muted); border-radius: 0; }
.wiki .panel { margin: 0 0 8px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; }
.wiki table { border-collapse: collapse; margin: 0 0 8px; }
.wiki th, .wiki td { border: 1px solid var(--line); padding: 2px 8px; text-align: left; }
.wiki th { background: var(--neutral-bg); }
.wiki a { color: var(--accent); text-decoration: underline; }
.wiki .mention { color: var(--accent); font-weight: 500; }
.wiki .attachment { color: var(--muted); }
.wiki hr { border: 0; border-top: 1px solid var(--line); }
/* herdr: status colours for chips, agent rows and the space card's border */
button.chip.space { border: 0; cursor: pointer; font: inherit; font-size: 12px; }
.chip.space, .agent .pill { background: var(--neutral-bg); color: var(--muted); }
.st-working.chip.space, .st-working .pill { background: var(--new-bg); color: var(--accent); }
.st-blocked.chip.space, .st-blocked .pill { background: var(--warn-bg); color: var(--warn); font-weight: 600; }
.st-done.chip.space, .st-done .pill { background: var(--ok-bg); color: var(--ok); }
.space-card { border-left: 3px solid var(--line); }
.space-card.st-working { border-left-color: var(--accent); }
.space-card.st-blocked { border-left-color: var(--warn); }
.space-card.st-done { border-left-color: var(--ok); }
.space-card .space-label { flex: 1; min-width: 0; font-weight: 500; }
.space-card .row1 button { padding: 1px 8px; font-size: 12px; }
.agents li { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; font-size: 13px; }
.agents .agent-name { font-weight: 500; }
.agents .agent-title { flex: 1; min-width: 0; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agents button { padding: 1px 8px; font-size: 12px; }
dialog.agent-dialog { width: min(900px, 94vw); }
.agent-out { margin: 8px 0; padding: 8px 10px; max-height: 55vh; overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; font: 12px/1.4 ui-monospace, "Cascadia Code", Consolas, monospace; white-space: pre-wrap; }
.agent-dialog textarea { flex: 1; min-width: 0; font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); resize: vertical; }
.agent-tabs { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.agent-tabs button { padding: 2px 10px; font-size: 13px; }
.agent-tabs button.on { background: var(--new-bg); border-color: var(--accent); }
.agent-status { font-size: 12px; color: var(--muted); }
.agent-status.st-working { color: var(--accent); }
.agent-status.st-working::after { content: "…"; display: inline-block; animation: typing 1.2s steps(4) infinite; overflow: hidden; vertical-align: bottom; width: 0; }
@keyframes typing { to { width: 1.2em; } }
.agent-status.st-blocked { color: var(--warn); font-weight: 600; }
.agent-status.st-done { color: var(--ok); }
.agent-chat { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; padding: 10px; height: 60vh; overflow-y: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; }
.msg { flex-shrink: 0; max-width: 82%; padding: 6px 10px; border-radius: 12px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.4; }
.msg.user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
.msg.user.pending { opacity: .6; }
.msg.assistant { align-self: flex-start; background: var(--surface); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
.msg.assistant pre { margin: 6px 0; padding: 6px 8px; background: var(--neutral-bg); border-radius: 6px; overflow-x: auto; white-space: pre; font: 12px ui-monospace, "Cascadia Code", Consolas, monospace; }
.msg.assistant code { padding: 0 3px; background: var(--neutral-bg); border-radius: 3px; }
.msg.tools { white-space: normal; }
.msg.tools summary { cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg.tools[open] summary { margin-bottom: 2px; }
.msg.tools div { padding-left: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg.tool { align-self: flex-start; padding: 0 10px; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.agent-out { height: 60vh; max-height: none; }
.agent-input { display: flex; gap: 8px; align-items: flex-end; }
dialog .warn-note { color: var(--warn); margin: 0 0 8px; }
.agent-msg { display: block; min-height: 1em; margin-top: 4px; font-size: 13px; color: var(--ok); }
.agent-msg.bad { color: var(--bad); }
.agent-actions { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.start-dialog label { display: block; margin: 10px 0 0; font-size: 12px; color: var(--muted); }
.start-dialog input, .start-dialog textarea { display: block; width: 100%; margin-top: 4px; font: inherit; font-size: 14px; color: var(--text); padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); resize: vertical; }
dialog.start-dialog { width: min(720px, 94vw); }
button.chip.start { border: 1px dashed var(--line); background: none; color: var(--muted); cursor: pointer; font: inherit; font-size: 12px; padding: 0 8px; }
button.chip.start { opacity: .35; }
.card:hover button.chip.start, button.chip.start:focus-visible { opacity: 1; }
@media (hover: none) { button.chip.start { opacity: .7; } }
button.chip.start:hover { border-color: var(--accent); color: var(--accent); }
button.send-agent { padding: 0 5px; border: 0; background: none; color: var(--accent); flex: none; font-size: 12px; }
button.send-agent:hover { background: var(--new-bg); border-radius: 4px; }
button.send-agent.sent { color: var(--ok); }
.pop-head button.send-agent { float: right; }
`;
