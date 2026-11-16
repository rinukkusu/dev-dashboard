// The recap page's logic: which days to show, what I did on each of them as far as the snapshot
// knows (PRs opened/merged, my comments, to-dos checked off) and when I worked with Claude Code –
// all checked against that day's time cockpit bookings.
import type { Issue, PullRequest, Timesheet, Todo, WorkSession } from "@shared/model.ts";

export type DidKind = "opened" | "merged" | "closed" | "commented" | "todo";
export type DidEvent = { kind: DidKind; at: string; /** comments that day */ count?: number };

/** One PR, ticket or to-do and what I did on it that day. */
export type Did = {
  /** unique per day, for React */
  key: string;
  /** the first thing that day */
  at: string;
  events: DidEvent[];
  title: string;
  ref?: string;
  url?: string;
  resource?: string;
  /** the Jira keys it's about: to group it under its ticket and find it in the bookings */
  keys: string[];
  /** a PR's number, to find it in the bookings ("PR 28682", "!213") */
  number?: number;
  /** someone else's PR: booking it on "PR Review" counts too */
  review?: boolean;
  /** the ticket itself (not a PR for it) */
  isIssue?: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD in the browser's time zone – time cockpit's days are local too. */
export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayOf = (iso: string) => localDay(new Date(iso));

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/**
 * The last `n` working days (Mon–Fri) up to today, newest first – plus the weekend days between them,
 * which the page only shows when something happened on them.
 */
export function recapDays(now: Date, n: number): { day: string; weekend: boolean }[] {
  const out: { day: string; weekend: boolean }[] = [];
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  for (let work = 0; work < n; d.setDate(d.getDate() - 1)) {
    const weekend = isWeekend(d);
    if (!weekend) work++;
    out.push({ day: localDay(d), weekend });
  }
  // a weekend right before the oldest working day isn't part of the range
  while (out.at(-1)?.weekend) out.pop();
  return out;
}

const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

/** What I did, per local day: one entry per PR/ticket/to-do and day. */
export function activityByDay(prs: PullRequest[], issues: Issue[], todos: Todo[]): Map<string, Did[]> {
  const days = new Map<string, Map<string, Did>>();
  const add = (base: Omit<Did, "key" | "at" | "events">, id: string, e: DidEvent) => {
    const day = dayOf(e.at);
    const list = days.get(day) ?? new Map<string, Did>();
    days.set(day, list);
    const d = list.get(id) ?? { ...base, key: `${id}:${day}`, at: e.at, events: [] };
    list.set(id, d);
    d.events.push(e);
    if (e.at < d.at) d.at = e.at;
  };
  /** my comments on one PR/ticket, counted per day */
  const commented = (base: Omit<Did, "key" | "at" | "events">, id: string, comments: { at: string; authorIsMe: boolean }[]) => {
    const mine = new Map<string, DidEvent>();
    for (const c of comments) {
      if (!c.authorIsMe) continue;
      const day = dayOf(c.at);
      const m = mine.get(day);
      if (!m) mine.set(day, { kind: "commented", at: c.at, count: 1 });
      else {
        m.count!++;
        if (c.at < m.at) m.at = c.at;
      }
    }
    for (const e of mine.values()) add(base, id, e);
  };

  for (const p of prs) {
    const base = { title: p.title, ref: p.ref, url: p.url, resource: p.id, keys: p.ownKeys ?? p.ticketKeys, number: p.number, review: p.role !== "author" };
    if (p.role === "author") add(base, p.id, { kind: "opened", at: p.createdAt });
    if (p.closedAt && (p.role === "author" || p.closedByMe) && p.status !== "active") {
      add(base, p.id, { kind: p.status === "completed" ? "merged" : "closed", at: p.closedAt });
    }
    commented(base, p.id, p.comments);
  }
  for (const i of issues) {
    commented({ title: i.title, ref: i.ref, url: i.url, resource: i.id, keys: JIRA_KEY.test(i.ref) ? [i.ref] : [], isIssue: true }, i.id, i.comments);
  }
  for (const x of todos) {
    if (x.doneAt) add({ title: x.text, keys: [] }, `todo:${x.id}`, { kind: "todo", at: x.doneAt });
  }
  const out = new Map<string, Did[]>();
  for (const [day, list] of days) {
    const dids = [...list.values()];
    for (const d of dids) d.events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    out.set(day, dids.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
  }
  return out;
}

/** Entries about the same ticket, under that ticket; the rest on their own. In the order they started. */
export type DidGroup = { key: string; ticket?: string; at: string; dids: Did[] };

export function groupByTicket(dids: Did[]): DidGroup[] {
  const groups = new Map<string, DidGroup>();
  for (const d of dids) {
    const ticket = d.keys[0];
    const key = ticket ?? d.key;
    const g = groups.get(key) ?? { key, ticket, at: d.at, dids: [] };
    groups.set(key, g);
    g.dids.push(d);
    if (d.at < g.at) g.at = d.at;
  }
  for (const g of groups.values()) g.dids.sort((a, b) => Number(!!b.isIssue) - Number(!!a.isIssue) || Date.parse(a.at) - Date.parse(b.at));
  return [...groups.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bookedText = (sheets: Timesheet[]) => sheets.map((s) => `${s.task ?? ""} ${s.description}`).join("\n");
const mentions = (text: string, key: string) => new RegExp(`(?<![\\w-])${escape(key)}(?!\\d)`).test(text);

/** Whether the text names this PR number: "PR 28682", "!213", "#12" – or, from four digits on, just "28682" or a range "28672-28676". */
function mentionsNumber(text: string, n: number): boolean {
  if (new RegExp(`(?:[!#]|\\bPR\\s*)${n}(?!\\d)`, "i").test(text)) return true;
  if (n < 1000) return false; // "3" or "12" could be anything
  if (new RegExp(`(?<![\\d.,:])${n}(?![\\d.,:]\\d|\\d)`).test(text)) return true;
  for (const m of text.matchAll(/(?<!\d)(\d{4,})\s*[-–]\s*(\d{4,})(?!\d)/g)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (b > a && b - a <= 50 && n >= a && n <= b) return true;
  }
  return false;
}

/**
 * Whether a booking of the day covers it: its ticket is the task or named in the text, the PR number
 * is mentioned, or – for someone else's PR – something went on "PR Review". To-dos aren't about anything bookable.
 */
export function isBooked(did: Did, sheets: Timesheet[]): boolean {
  if (did.events.every((e) => e.kind === "todo")) return true;
  const text = bookedText(sheets);
  if (did.keys.some((k) => mentions(text, k))) return true;
  if (did.number !== undefined && mentionsNumber(text, did.number)) return true;
  return !!did.review && sheets.some((s) => /review/i.test(s.task ?? ""));
}

/** The booking's own text: time cockpit's descriptions start with the task code ("CT-2052 | …"). */
export function bookingText(s: Timesheet): string {
  if (!s.task) return s.description;
  if (s.description === s.task) return "";
  return s.description.startsWith(`${s.task} | `) ? s.description.slice(s.task.length + 3) : s.description;
}

/** Hours per project, biggest first. */
export function projectTotals(sheets: Timesheet[]): [project: string, hours: number][] {
  const sums = new Map<string, number>();
  for (const s of sheets) sums.set(s.project, (sums.get(s.project) ?? 0) + s.hours);
  return [...sums].sort((a, b) => b[1] - a[1]);
}

// --- time: bookings, gaps, Claude sessions ---------------------------------------------------------

export type Span = { start: number; end: number };

/** A booking's span; time cockpit's times are local wall-clock, which is what `new Date()` reads them as. */
export const sheetSpan = (s: Timesheet): Span => ({ start: new Date(s.begin).getTime(), end: new Date(s.end).getTime() });
export const sessionSpan = (w: WorkSession): Span => ({ start: Date.parse(w.start), end: Date.parse(w.end) });

/** The parts of `span` no booking covers. */
export function uncovered(span: Span, booked: Span[]): Span[] {
  let rest: Span[] = [span];
  for (const b of booked) {
    rest = rest.flatMap((r) => {
      if (b.end <= r.start || b.start >= r.end) return [r];
      return [
        ...(b.start > r.start ? [{ start: r.start, end: b.start }] : []),
        ...(b.end < r.end ? [{ start: b.end, end: r.end }] : []),
      ];
    });
  }
  return rest;
}

export const minutes = (spans: Span[]) => Math.round(spans.reduce((sum, s) => sum + s.end - s.start, 0) / 60_000);

/** Worked with Claude but not booked: less than this is noise (a quick question, the booking session itself). */
export const UNBOOKED_MIN = 10;

/** Unbooked time between two bookings of a day, from this long. */
const GAP_MIN = 15;

export type Gap = Span & { /** minutes of Claude work in it */ worked: number };

/** The holes between a day's bookings – the lunch break too, the page can't know – with the Claude work in them. */
export function gaps(sheets: Timesheet[], sessions: WorkSession[]): Map<string, Gap> {
  const out = new Map<string, Gap>();
  const sorted = [...sheets].sort((a, b) => a.begin.localeCompare(b.begin));
  let until = sorted[0] && sheetSpan(sorted[0]).end;
  for (const s of sorted.slice(1)) {
    const span = sheetSpan(s);
    if (until !== undefined && span.start - until >= GAP_MIN * 60_000) {
      const gap = { start: until, end: span.start };
      // (sessions can run side by side: count the time, not each session)
      const worked = minutes([gap]) - minutes(uncovered(gap, sessions.map(sessionSpan)));
      // keyed by the booking after it, where the page shows it
      out.set(s.id, { ...gap, worked });
    }
    until = Math.max(until ?? 0, span.end);
  }
  return out;
}

/** One Claude Code session on one day, with its active stretches. */
export type SessionDay = { key: string; title?: string; project: string; stretches: WorkSession[]; prompts: number; keys: string[]; start: string };

/** The stretches by local day, then by session; each day's sessions in the order they started. */
export function sessionsByDay(stretches: WorkSession[]): Map<string, SessionDay[]> {
  const days = new Map<string, Map<string, SessionDay>>();
  for (const w of stretches) {
    const day = dayOf(w.start);
    const list = days.get(day) ?? new Map<string, SessionDay>();
    days.set(day, list);
    const s = list.get(w.session) ?? { key: `${w.session}:${day}`, title: w.title, project: w.project, stretches: [], prompts: 0, keys: [], start: w.start };
    list.set(w.session, s);
    s.stretches.push(w);
    s.prompts += w.prompts;
    for (const k of w.keys) if (!s.keys.includes(k)) s.keys.push(k);
    if (w.start < s.start) s.start = w.start;
  }
  const out = new Map<string, SessionDay[]>();
  for (const [day, list] of days) {
    const sessions = [...list.values()];
    for (const s of sessions) {
      s.stretches.sort((a, b) => a.start.localeCompare(b.start));
      s.keys = s.keys.slice(0, 3);
    }
    out.set(day, sessions.sort((a, b) => a.start.localeCompare(b.start)));
  }
  return out;
}
