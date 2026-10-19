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
  html`<time class="rel" datetime="${isoDate}" title="${fmt.format(new Date(isoDate))}">${ago(isoDate, now)}</time>`;

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
  html`<li class="change" data-at="${esc(c.detectedAt ?? c.at)}">
    <div class="row1"><span class="dot"></span><a href="${esc(c.url)}"><span class="ref">${esc(c.ref)}</span> ${esc(c.title)}</a><span class="when">${time(c.at, now)}</span></div>
    ${c.detail ? html`<div class="detail">${esc(c.detail)}</div>` : ""}
  </li>`;

const section = (title: string, count: number, body: string, empty: string) =>
  html`<section><h2>${title} <span class="count">${count || ""}</span></h2>${count ? body : html`<p class="empty">${empty}</p>`}</section>`;

// --- page ------------------------------------------------------------------------

export type PageOptions = {
  /** true: served by src/server.ts, updated over a WebSocket. false: static file with meta refresh. */
  live: boolean;
};

/** The part that gets swapped on every live update: error bar + both columns. */
export function renderApp(v: View): string {
  const now = Date.parse(v.snapshot.takenAt);
  const s = v.snapshot;
  const mine = s.prs.filter((p) => p.role === "author" && p.status === "active");
  const reviews = s.prs.filter((p) => p.role === "reviewer");
  const merged = s.prs.filter((p) => p.status === "completed");
  const issues = s.issues.filter((i) => i.inScope);

  return html`${s.errors.length ? html`<div class="errors">${each(s.errors, (e) => html`<p>⚠ ${esc(e)} – zeige letzten bekannten Stand.</p>`)}</div>` : ""}
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
</main>`;
}

/** Full page. Without a view (server just started, nothing stored yet) it shows a placeholder. */
export function renderHtml(v: View | undefined, opts: PageOptions): string {
  const takenAt = v?.snapshot.takenAt;
  return html`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${!opts.live && v ? html`<meta http-equiv="refresh" content="${v.refreshSeconds}">` : ""}
<title>Dev-Dashboard</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%233b5bdb'/%3E%3Cpath d='M4 11V7M8 11V4M12 11V8' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E">
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>Dev-Dashboard</h1>
  <span class="stamp">Stand <time id="stamp" class="abs" datetime="${takenAt ?? ""}">${takenAt ? fmtTime.format(new Date(takenAt)) : "–"}</time></span>
  ${opts.live ? `<span id="conn" class="conn off">verbinde…</span>` : ""}
  <span class="spacer"></span>
  <span id="unseen" class="unseen-count"></span>
  ${opts.live ? `<button id="sound" type="button" title="Ton bei neuen Änderungen"></button><button id="refresh" type="button">Jetzt aktualisieren</button>` : ""}
  <button id="seen" type="button">Alles gesehen</button>
</header>
<div id="app">${v ? renderApp(v) : `<main><p class="empty">Erster Abruf läuft…</p></main>`}</div>
<script>${script(opts.live)}</script>
</body>
</html>`;
}

// Client side. "Seen" state and the sound setting live in localStorage, so no accounts needed.
// Times are formatted here too: they stay current between updates and use the browser's time zone.
const script = (live: boolean) => `
(() => {
  const LIVE = ${live};
  const $ = (id) => document.getElementById(id);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const SEEN_KEY = "dev-dashboard.lastSeen";
  const SOUND_KEY = "dev-dashboard.sound";
  const baseTitle = document.title;

  // --- times ---
  const full = new Intl.DateTimeFormat("de-AT", { dateStyle: "short", timeStyle: "short" });
  const hm = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" });
  const ago = (t) => {
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return "gerade eben";
    if (min < 60) return "vor " + min + " Min";
    const h = Math.round(min / 60);
    if (h < 24) return "vor " + h + " Std";
    const d = Math.round(h / 24);
    return d === 1 ? "gestern" : "vor " + d + " Tagen";
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
    $("unseen").textContent = n ? n + " neu" : "";
  };
  $("seen").addEventListener("click", () => { store.set(SEEN_KEY, String(Date.now())); mark(); });

  times();
  mark();
  setInterval(times, 30000);
  if (!LIVE) return;

  // --- sound ---
  // Browsers only allow audio after a user gesture; until then the button asks for a click.
  let ctx;
  const soundOn = () => store.get(SOUND_KEY) !== "off";
  const soundLabel = () => {
    const b = $("sound");
    const ready = !!ctx && ctx.state === "running";
    b.textContent = !soundOn() ? "🔕 Ton aus" : ready ? "🔔 Ton an" : "🔔 Klick zum Aktivieren";
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
    ws.onopen = () => { retry = 1000; conn("on", "live"); };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "view") { apply(msg); conn("on", "live"); }
      else if (msg.type === "polling") conn("busy", "aktualisiere…");
    };
    ws.onclose = () => {
      conn("off", "offline – verbinde neu…");
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
