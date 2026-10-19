import type { Links } from "./correlate.ts";
import { VOTE_LABEL } from "./diff.ts";
import type { Change, Hint, Issue, PullRequest, Reviewer, Snapshot, StatusCategory } from "./model.ts";

export type View = {
  snapshot: Snapshot;
  changes: Change[];
  hints: Hint[];
  links: Links;
  refreshSeconds: number;
  sources: { jira: boolean; ado: boolean };
};

// --- tiny helpers ------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const html = (parts: TemplateStringsArray, ...values: unknown[]) =>
  parts.reduce((out, p, i) => out + p + (i < values.length ? String(values[i] ?? "") : ""), "");

const each = <T>(items: T[], fn: (t: T) => string) => items.map(fn).join("");

const fmt = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short" });
const fmtTime = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" });

function ago(isoDate: string, now: number): string {
  const min = Math.round((now - Date.parse(isoDate)) / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.round(h / 24);
  return d === 1 ? "gestern" : `vor ${d} Tagen`;
}

const time = (isoDate: string, now: number) =>
  html`<time datetime="${isoDate}" title="${fmt.format(new Date(isoDate))}">${ago(isoDate, now)}</time>`;

// --- fragments -----------------------------------------------------------------

const VOTE_GLYPH: Record<Reviewer["vote"], string> = {
  approved: "✓",
  approvedWithSuggestions: "✓",
  none: "–",
  waiting: "!",
  rejected: "✕",
};

const reviewerChip = (r: Reviewer) =>
  html`<span class="chip vote-${r.vote}" title="${esc(`${r.name}: ${VOTE_LABEL[r.vote]}${r.required ? " (Pflicht)" : ""}`)}"><b>${VOTE_GLYPH[r.vote]}</b>${esc(r.name)}${r.required ? "<sup>*</sup>" : ""}</span>`;

const statusPill = (status: string, cat: StatusCategory) =>
  html`<span class="pill cat-${cat}">${esc(status)}</span>`;

const ticketChip = (key: string, links: Links) => {
  const issue = links.issueByKey.get(key);
  return issue
    ? html`<a class="chip ticket" href="${esc(issue.url)}" title="${esc(issue.summary)}">${esc(key)} ${statusPill(issue.status, issue.statusCategory)}</a>`
    : html`<span class="chip ticket muted">${esc(key)}</span>`;
};

function prCard(pr: PullRequest, v: View, now: number): string {
  const badges = [
    pr.isDraft ? `<span class="badge">Entwurf</span>` : "",
    pr.hasConflicts ? `<span class="badge bad">Konflikte</span>` : "",
    pr.openThreads ? html`<span class="badge warn" title="Offene Kommentar-Threads">💬 ${pr.openThreads}</span>` : "",
  ].join("");
  return html`
    <article class="card">
      <div class="row1"><a href="${esc(pr.url)}"><span class="ref">!${pr.id}</span> ${esc(pr.title)}</a>${badges}</div>
      <div class="meta">${esc(pr.repo)} · <code>${esc(pr.branch)}</code> → <code>${esc(pr.targetBranch)}</code> · ${pr.role === "reviewer" ? `von ${esc(pr.author)}, ` : ""}${time(pr.createdAt, now)}</div>
      <div class="chips">${each(pr.ticketKeys, (k) => ticketChip(k, v.links))}${each(pr.reviewers, reviewerChip)}</div>
    </article>`;
}

function issueRow(issue: Issue, v: View, now: number): string {
  const prs = v.links.prsByKey.get(issue.key) ?? [];
  const last = issue.comments.at(-1);
  return html`
    <article class="card">
      <div class="row1"><a href="${esc(issue.url)}"><span class="ref">${esc(issue.key)}</span> ${esc(issue.summary)}</a>${statusPill(issue.status, issue.statusCategory)}</div>
      <div class="meta">${esc(issue.type)} · aktualisiert ${time(issue.updatedAt, now)}${
        prs.length ? " · " + prs.map((p) => html`<a href="${esc(p.url)}">!${p.id}</a>${p.status === "completed" ? " (gemerged)" : ""}`).join(", ") : ""
      }</div>
      ${last && !last.authorIsMe ? html`<blockquote><b>${esc(last.author)}</b> ${time(last.at, now)}: ${esc(last.text)}</blockquote>` : ""}
    </article>`;
}

const HINT_LABEL = { action: "Aktion", ready: "Bereit", info: "Info" } as const;

const hintRow = (h: Hint) =>
  html`<li class="hint ${h.level}"><span class="lvl">${HINT_LABEL[h.level]}</span><a href="${esc(h.url)}"><span class="ref">${esc(h.ref)}</span> ${esc(h.text)}</a></li>`;

const changeRow = (c: Change, now: number) =>
  html`<li class="change" data-at="${esc(c.at)}">
    <div class="row1"><span class="dot"></span><a href="${esc(c.url)}"><span class="ref">${esc(c.ref)}</span> ${esc(c.title)}</a><span class="when">${time(c.at, now)}</span></div>
    ${c.detail ? html`<div class="detail">${esc(c.detail)}</div>` : ""}
  </li>`;

const section = (title: string, count: number, body: string, empty: string) =>
  html`<section><h2>${title} <span class="count">${count || ""}</span></h2>${count ? body : html`<p class="empty">${empty}</p>`}</section>`;

// --- page ------------------------------------------------------------------------

export function renderHtml(v: View): string {
  const now = Date.parse(v.snapshot.takenAt);
  const s = v.snapshot;
  const mine = s.prs.filter((p) => p.role === "author" && p.status === "active");
  const reviews = s.prs.filter((p) => p.role === "reviewer");
  const merged = s.prs.filter((p) => p.status === "completed");
  const issues = s.issues.filter((i) => i.inScope);

  return html`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="${v.refreshSeconds}">
<title>Dev-Dashboard</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>Dev-Dashboard</h1>
  <span class="stamp">Stand ${fmtTime.format(new Date(now))}</span>
  <span class="spacer"></span>
  <span id="unseen" class="unseen-count"></span>
  <button id="seen" type="button">Alles gesehen</button>
</header>
${s.errors.length ? html`<div class="errors">${each(s.errors, (e) => html`<p>⚠ ${esc(e)} – zeige letzten bekannten Stand.</p>`)}</div>` : ""}
<main>
  <div class="col">
    ${section("Zu tun", v.hints.length, html`<ul class="hints">${each(v.hints, hintRow)}</ul>`, "Nichts offen.")}
    ${section("Änderungen", v.changes.length, html`<ul class="changes">${each(v.changes, (c) => changeRow(c, now))}</ul>`, "Noch keine Änderungen seit dem ersten Lauf.")}
  </div>
  <div class="col">
    ${v.sources.ado ? section("Meine PRs", mine.length, each(mine, (p) => prCard(p, v, now)), "Keine offenen PRs.") : ""}
    ${v.sources.ado ? section("Reviews für mich", reviews.length, each(reviews, (p) => prCard(p, v, now)), "Keine Reviews angefragt.") : ""}
    ${v.sources.jira ? section("Tickets", issues.length, each(issues, (i) => issueRow(i, v, now)), "Keine Tickets für die JQL.") : ""}
    ${merged.length ? section("Kürzlich gemerged", merged.length, each(merged, (p) => prCard(p, v, now)), "") : ""}
  </div>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

// "Seen" state lives in the browser (localStorage), so no server is needed.
const SCRIPT = `
(() => {
  const KEY = "dev-dashboard.lastSeen";
  const read = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
  const baseTitle = document.title;
  const mark = () => {
    const lastSeen = read();
    let n = 0;
    document.querySelectorAll("[data-at]").forEach((el) => {
      const isNew = Date.parse(el.dataset.at) > lastSeen;
      el.classList.toggle("unseen", isNew);
      if (isNew) n++;
    });
    document.title = n ? "(" + n + ") " + baseTitle : baseTitle;
    document.getElementById("unseen").textContent = n ? n + " neu" : "";
  };
  document.getElementById("seen").addEventListener("click", () => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch {}
    mark();
  });
  mark();
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
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: inherit; text-decoration: none; }
a:hover { color: var(--accent); }
code { font: 12px ui-monospace, "Cascadia Code", Consolas, monospace; }
header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 12px; padding: 10px 20px; background: var(--surface); border-bottom: 1px solid var(--line); }
h1 { font-size: 16px; margin: 0; }
.stamp, .meta, .when, .empty, .muted { color: var(--muted); }
.spacer { flex: 1; }
.unseen-count { color: var(--accent); font-weight: 600; }
button { font: inherit; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; }
button:hover { border-color: var(--accent); }
.errors { margin: 12px 20px 0; padding: 8px 12px; border-radius: 8px; background: var(--bad-bg); color: var(--bad); }
.errors p { margin: 2px 0; }
main { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 20px; padding: 16px 20px 40px; max-width: 1500px; margin: 0 auto; }
@media (max-width: 900px) { main { grid-template-columns: 1fr; } }
section { margin-bottom: 22px; }
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
.hints li.action { border-left-color: var(--warn); }
.hints li.ready { border-left-color: var(--ok); }
.lvl { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--muted); min-width: 46px; }
.action .lvl { color: var(--warn); }
.ready .lvl { color: var(--ok); }
.change .detail { color: var(--muted); font-size: 13px; margin: 2px 0 0 16px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.change .when { font-size: 12px; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: transparent; align-self: center; }
.change.unseen { background: var(--new-bg); }
.change.unseen .dot { background: var(--accent); }
`;
