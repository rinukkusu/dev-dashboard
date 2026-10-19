import type { Links } from "./correlate.ts";
import { dict, type Dict, type Lang } from "./i18n.ts";
import type { Change, Hint, Issue, PullRequest, Reviewer, Snapshot, StatusCategory } from "./model.ts";

export type View = {
  lang: Lang;
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

const fill = (s: string, n: number) => s.replace("{n}", String(n));

/** Everything a fragment needs besides its data. */
type Ctx = { t: Dict; now: number; links: Links };

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

const reviewerChip = (r: Reviewer, { t }: Ctx) =>
  html`<span class="chip vote-${r.vote}" title="${esc(`${r.name}: ${t.vote[r.vote]}${r.required ? ` (${t.required})` : ""}`)}"><b>${VOTE_GLYPH[r.vote]}</b>${esc(r.name)}${r.required ? "<sup>*</sup>" : ""}</span>`;

const statusPill = (status: string, cat: StatusCategory) =>
  html`<span class="pill cat-${cat}">${esc(status)}</span>`;

const ticketChip = (key: string, { links }: Ctx) => {
  const issue = links.issueByKey.get(key);
  return issue
    ? html`<a class="chip ticket" href="${esc(issue.url)}" title="${esc(issue.summary)}">${esc(key)} ${statusPill(issue.status, issue.statusCategory)}</a>`
    : html`<span class="chip ticket muted">${esc(key)}</span>`;
};

function prCard(pr: PullRequest, c: Ctx): string {
  const { t } = c;
  const badges = [
    pr.isDraft ? html`<span class="badge">${t.badges.draft}</span>` : "",
    pr.hasConflicts ? html`<span class="badge bad">${t.badges.conflicts}</span>` : "",
    pr.openThreads ? html`<span class="badge warn" title="${t.badges.openThreads}">💬 ${pr.openThreads}</span>` : "",
  ].join("");
  return html`
    <article class="card">
      <div class="row1"><a href="${esc(pr.url)}"><span class="ref">!${pr.id}</span> ${esc(pr.title)}</a>${badges}</div>
      <div class="meta">${esc(pr.repo)} · <code>${esc(pr.branch)}</code> → <code>${esc(pr.targetBranch)}</code> · ${pr.role === "reviewer" ? `${esc(t.by(pr.author))}, ` : ""}${time(pr.createdAt, c)}</div>
      <div class="chips">${each(pr.ticketKeys, (k) => ticketChip(k, c))}${each(pr.reviewers, (r) => reviewerChip(r, c))}</div>
    </article>`;
}

function issueRow(issue: Issue, c: Ctx): string {
  const prs = c.links.prsByKey.get(issue.key) ?? [];
  const last = issue.comments.at(-1);
  return html`
    <article class="card">
      <div class="row1"><a href="${esc(issue.url)}"><span class="ref">${esc(issue.key)}</span> ${esc(issue.summary)}</a>${statusPill(issue.status, issue.statusCategory)}</div>
      <div class="meta">${esc(issue.type)} · ${c.t.updated} ${time(issue.updatedAt, c)}${
        prs.length ? " · " + prs.map((p) => html`<a href="${esc(p.url)}">!${p.id}</a>${p.status === "completed" ? ` (${c.t.mergedSuffix})` : ""}`).join(", ") : ""
      }</div>
      ${last && !last.authorIsMe ? html`<blockquote><b>${esc(last.author)}</b> ${time(last.at, c)}: ${esc(last.text)}</blockquote>` : ""}
    </article>`;
}

const hintRow = (h: Hint, { t }: Ctx) =>
  html`<li class="hint ${h.level}"><span class="lvl">${t.levels[h.level]}</span><a href="${esc(h.url)}"><span class="ref">${esc(h.ref)}</span> ${esc(h.text)}</a></li>`;

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
    case "issue-status":
      return { title: `${ch.from} → ${ch.to}`, detail: ch.subject };
    case "issue-added":
      return { title: t.change.issueAdded(ch.subject), detail: ch.to };
    case "issue-removed":
      return { title: t.change.issueRemoved(ch.subject), detail: t.change.issueRemovedDetail };
  }
}

function changeRow(ch: Change, c: Ctx) {
  const { title, detail } = changeText(ch, c.t);
  return html`<li class="change" data-at="${esc(ch.detectedAt ?? ch.at)}">
    <div class="row1"><span class="dot"></span><a href="${esc(ch.url)}"><span class="ref">${esc(ch.ref)}</span> ${esc(title)}</a><span class="when">${time(ch.at, c)}</span></div>
    ${detail ? html`<div class="detail">${esc(detail)}</div>` : ""}
  </li>`;
}

const section = (title: string, count: number, body: string, empty: string) =>
  html`<section><h2>${title} <span class="count">${count || ""}</span></h2>${count ? body : html`<p class="empty">${empty}</p>`}</section>`;

// --- page ------------------------------------------------------------------------

export type PageOptions = {
  /** true: served by src/server.ts, updated over a WebSocket. false: static file with meta refresh. */
  live: boolean;
  /** language when there's no view yet; otherwise the view's language wins */
  lang: Lang;
};

/** The part that gets swapped on every live update: error bar + both columns. */
export function renderApp(v: View): string {
  const t = dict(v.lang);
  const c: Ctx = { t, now: Date.parse(v.snapshot.takenAt), links: v.links };
  const s = v.snapshot;
  const mine = s.prs.filter((p) => p.role === "author" && p.status === "active");
  const reviews = s.prs.filter((p) => p.role === "reviewer");
  const merged = s.prs.filter((p) => p.status === "completed");
  const issues = s.issues.filter((i) => i.inScope);
  const prs = (list: PullRequest[]) => each(list, (p) => prCard(p, c));

  return html`${s.errors.length ? html`<div class="errors">${each(s.errors, (e) => html`<p>⚠ ${esc(e)} – ${t.staleSuffix}</p>`)}</div>` : ""}
<main>
  <div class="col">
    ${section(t.sections.todo, v.hints.length, html`<ul class="hints">${each(v.hints, (h) => hintRow(h, c))}</ul>`, t.empty.todo)}
    ${section(t.sections.changes, v.changes.length, html`<ul class="changes">${each(v.changes, (ch) => changeRow(ch, c))}</ul>`, t.empty.changes)}
  </div>
  <div class="col">
    ${v.sources.ado ? section(t.sections.myPrs, mine.length, prs(mine), t.empty.myPrs) : ""}
    ${v.sources.ado ? section(t.sections.reviews, reviews.length, prs(reviews), t.empty.reviews) : ""}
    ${v.sources.jira ? section(t.sections.tickets, issues.length, each(issues, (i) => issueRow(i, c)), t.empty.tickets) : ""}
    ${merged.length ? section(t.sections.merged, merged.length, prs(merged), "") : ""}
  </div>
</main>`;
}

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
<title>${t.title}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%233b5bdb'/%3E%3Cpath d='M4 11V7M8 11V4M12 11V8' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E">
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>${t.title}</h1>
  <span class="stamp">${t.asOf} <time id="stamp" class="abs" datetime="${takenAt ?? ""}">${takenAt ? hm.format(new Date(takenAt)) : "–"}</time></span>
  ${opts.live ? html`<span id="conn" class="conn off">${t.client.connecting}</span>` : ""}
  <span class="spacer"></span>
  <span id="unseen" class="unseen-count"></span>
  ${opts.live ? html`<button id="sound" type="button" title="${t.soundTitle}"></button><button id="refresh" type="button">${t.refresh}</button>` : ""}
  <button id="seen" type="button">${t.seenAll}</button>
  ${opts.live ? html`<button id="lang" type="button" data-lang="${lang === "de" ? "en" : "de"}">${t.switchLang}</button>` : ""}
</header>
<div id="app">${v ? renderApp(v) : html`<main><p class="empty">${t.firstPoll}</p></main>`}</div>
<script>${script(opts.live, t)}</script>
</body>
</html>`;
}

// Client side. "Seen" state and the sound setting live in localStorage, so no accounts needed.
// Times are formatted here too: they stay current between updates and use the browser's time zone.
// The texts come in as JSON; "<" is escaped so nothing in them can close the script tag.
const script = (live: boolean, t: Dict) => `
(() => {
  const LIVE = ${live};
  const T = ${JSON.stringify(t.client).replace(/</g, "\\u003c")};
  const LOCALE = ${JSON.stringify(t.locale)};
  const fill = (s, n) => s.replace("{n}", n);
  const $ = (id) => document.getElementById(id);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const SEEN_KEY = "dev-dashboard.lastSeen";
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
  const mark = () => {
    const lastSeen = Number(store.get(SEEN_KEY)) || 0;
    let n = 0;
    document.querySelectorAll("[data-at]").forEach((el) => {
      const isNew = Date.parse(el.dataset.at) > lastSeen;
      el.classList.toggle("unseen", isNew);
      if (isNew) n++;
    });
    document.title = n ? "(" + n + ") " + baseTitle : baseTitle;
    $("unseen").textContent = n ? fill(T.unseen, n) : "";
  };
  $("seen").addEventListener("click", () => { store.set(SEEN_KEY, String(Date.now())); mark(); });

  times();
  mark();
  setInterval(times, 30000);
  if (!LIVE) return;

  // --- language switch: cookie, so the server renders the right language right away ---
  $("lang").addEventListener("click", (e) => {
    document.cookie = "lang=" + e.currentTarget.dataset.lang + "; path=/; max-age=31536000; SameSite=Lax";
    location.reload();
  });

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
  const newest = () => Math.max(0, ...Array.from(document.querySelectorAll(".change[data-at]"), (el) => Date.parse(el.dataset.at)));
  let known = newest();
  let retry = 1000;
  const conn = (state, text) => { const el = $("conn"); el.className = "conn " + state; el.textContent = text; };
  const apply = (msg) => {
    $("app").innerHTML = msg.html;
    $("stamp").setAttribute("datetime", msg.takenAt);
    times();
    mark();
    const n = newest();
    if (n > known) ding();
    known = Math.max(known, n);
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
button.warn { border-color: var(--warn); color: var(--warn); }
.conn { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.conn::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.conn.on::before { background: var(--ok); }
.conn.busy::before { background: var(--warn); }
.conn.off::before { background: var(--bad); }
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
