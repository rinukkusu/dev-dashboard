// When I worked with Claude Code: active stretches per session, from its transcripts
// (~/.claude/projects/<cwd>/<session>.jsonl), for the recap page – the same idea as the
// time-booking skill's activity.py. A pause longer than GAP_MS ends a stretch.
import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { KeyExtractor } from "./correlate.ts";
import type { WorkSession } from "./model.ts";

const GAP_MS = 10 * 60_000;
/** stretches without a single prompt of mine (Claude finishing background work) shorter than this are dropped */
const MIN_AUTO_MS = 60_000;

type Event = { t: number; human: boolean; keys?: string[] };
type Parsed = { size: number; mtimeMs: number; events: Event[]; title?: string; firstPrompt?: string; cwd?: string };

type Block = { type?: string; text?: string };
type Entry = {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  aiTitle?: string;
  cwd?: string;
  message?: { content?: string | Block[] };
};

/** Things Claude Code writes as "user" that I didn't type. */
const isNoise = (text: string) => /^\s*<(command-|local-command-|system-reminder|task-notification)/.test(text) || /^\[Request interrupted/.test(text);

const textOf = (content: string | Block[] | undefined) =>
  typeof content === "string" ? content : (content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");

/** Reads the lines of a transcript into `into`; returns how far it got (only whole lines count). */
function parseLines(chunk: string, into: Parsed, extractKeys: KeyExtractor): number {
  let used = 0;
  for (let at = 0; ; ) {
    const nl = chunk.indexOf("\n", at);
    if (nl < 0) break;
    const line = chunk.slice(at, nl);
    at = used = nl + 1;
    // cheap filter before parsing: tool results can be huge and we only need a few line types
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"') && !line.includes('"type":"ai-title"')) continue;
    let e: Entry;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "ai-title") {
      into.title = e.aiTitle || into.title;
      continue;
    }
    if ((e.type !== "user" && e.type !== "assistant") || e.isSidechain || !e.timestamp) continue;
    const t = Date.parse(e.timestamp);
    if (Number.isNaN(t)) continue;
    into.cwd ??= e.cwd;
    const content = e.message?.content;
    if (e.type === "user") {
      // a tool result: Claude at work, not me
      const typed = typeof content === "string" || (Array.isArray(content) && content.some((b) => b.type === "text") && !content.some((b) => b.type === "tool_result"));
      const text = typed ? textOf(content) : "";
      // slash commands, caveats, reminders: written by Claude Code, not a sign of anyone working
      if (typed && (e.isMeta || isNoise(text))) continue;
      const human = typed && !!text.trim();
      if (human) into.firstPrompt ??= text.trim().split("\n")[0]!.slice(0, 120);
      const keys = human ? extractKeys(text) : [];
      into.events.push(keys.length ? { t, human, keys } : { t, human });
    } else {
      const keys = extractKeys(textOf(content));
      into.events.push(keys.length ? { t, human: false, keys } : { t, human: false });
    }
  }
  return used;
}

/** Parsed transcripts by path; a growing file is only read from where we left off. */
export class SessionReader {
  private cache = new Map<string, Parsed>();

  constructor(
    private dir: string,
    private extractKeys: KeyExtractor,
  ) {}

  private async read(path: string, size: number, mtimeMs: number): Promise<Parsed> {
    const old = this.cache.get(path);
    if (old && old.size === size && old.mtimeMs === mtimeMs) return old;
    // appended to (the usual case for a running session): only the new part; otherwise from scratch
    const p: Parsed = old && size > old.size ? old : { size: 0, mtimeMs, events: [] };
    const fh = await open(path, "r");
    try {
      const buf = Buffer.alloc(size - p.size);
      await fh.read(buf, 0, buf.length, p.size);
      const text = buf.toString("utf8");
      const used = parseLines(text, p, this.extractKeys);
      p.size += Buffer.byteLength(text.slice(0, used), "utf8");
      p.mtimeMs = mtimeMs;
    } finally {
      await fh.close();
    }
    this.cache.set(path, p);
    return p;
  }

  /** Active stretches between `since` and `until` (epoch ms), oldest first. */
  async between(since: number, until: number): Promise<WorkSession[]> {
    const out: WorkSession[] = [];
    const projects = await readdir(this.dir).catch(() => [] as string[]);
    const seen = new Set<string>();
    for (const project of projects) {
      const files = await readdir(join(this.dir, project)).catch(() => [] as string[]);
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const path = join(this.dir, project, f);
        const st = await stat(path).catch(() => undefined);
        if (!st?.isFile() || st.mtimeMs < since) continue;
        seen.add(path);
        const p = await this.read(path, st.size, st.mtimeMs);
        out.push(...stretches(basename(f, ".jsonl"), p, since, until));
      }
    }
    // forget files that are out of range now, so the cache doesn't grow forever
    for (const path of this.cache.keys()) if (!seen.has(path)) this.cache.delete(path);
    return out.sort((a, b) => a.start.localeCompare(b.start));
  }
}

const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

function stretches(session: string, p: Parsed, since: number, until: number): WorkSession[] {
  const events = p.events.filter((e) => e.t >= since && e.t < until).sort((a, b) => a.t - b.t);
  if (!events.length) return [];
  // the session's keys overall, for stretches that don't name one themselves
  const all = new Map<string, number>();
  for (const e of p.events) for (const k of e.keys ?? []) all.set(k, (all.get(k) ?? 0) + 1);
  const title = p.title ?? p.firstPrompt;
  const project = basename((p.cwd ?? "").replace(/\\/g, "/"));

  const out: WorkSession[] = [];
  let group: Event[] = [];
  const flush = () => {
    if (!group.length) return;
    const start = group[0]!.t;
    const end = group.at(-1)!.t;
    const prompts = group.filter((e) => e.human).length;
    if (prompts || end - start >= MIN_AUTO_MS) {
      const counts = new Map<string, number>();
      for (const e of group) for (const k of e.keys ?? []) counts.set(k, (counts.get(k) ?? 0) + 1);
      out.push({
        id: `${session}:${start}`,
        session,
        title,
        project,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        prompts,
        keys: top(counts.size ? counts : all),
      });
    }
    group = [];
  };
  for (const e of events) {
    if (group.length && e.t - group.at(-1)!.t > GAP_MS) flush();
    group.push(e);
  }
  flush();
  return out;
}
