// Autopilot: new comments of other people go to an agent on their own – what you'd otherwise type
// yourself ("read the new comments on PR #X and work through them").
//   collect  – a new comment joins the job of its PR/ticket (reviewers write several in a row)
//   ripen    – a while after the last one the job is queued
//   tick     – queued jobs go to the agent of their space (sticky, see pickAgent) once it's free and
//              nobody is typing in it, or to a new space; sent jobs are answered once the agent
//              settles again – the answer comes from its Claude transcript, found by the job's marker
// The jobs live in prefs.json, so a restart neither loses nor repeats them.
import { HerdrError, pickAgent, spacesForItem, type Herdr } from "./herdr.ts";
import { message } from "./http.ts";
import { agentName, prepare, prepareAuto, type Prompts, type Target } from "./launch.ts";
import type { AgentJob, Change, Comment, Prefs, Suggestion } from "./model.ts";
import { markSent } from "./prefs.ts";
import { findTranscript, readChat, type ChatMessage } from "./transcript.ts";

const COMMENT_KINDS = new Set<Change["kind"]>(["pr-comment", "issue-comment"]);
const OPEN: AgentJob["status"][] = ["collecting", "queued"];

export const markerOf = (job: AgentJob) => `[dashboard ${job.id}]`;

const newId = (now: number) => `j${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** New comments join the not yet sent job of their PR/ticket, or start one. True if anything changed. */
export function collect(prefs: Prefs, fresh: Change[], now = Date.now()): boolean {
  const muted = new Set(prefs.muted);
  const sent = new Set(prefs.sent);
  const iso = new Date(now).toISOString();
  let changed = false;
  for (const ch of fresh) {
    if (!COMMENT_KINDS.has(ch.kind) || !ch.resource || muted.has(ch.resource) || sent.has(ch.id)) continue;
    let job = prefs.jobs.find((j) => j.resource === ch.resource && OPEN.includes(j.status));
    if (!job) {
      job = { id: newId(now), resource: ch.resource, ref: ch.ref, url: ch.url, changeIds: [], status: "collecting", createdAt: iso, lastAt: iso };
      prefs.jobs.push(job);
    }
    if (job.changeIds.includes(ch.id)) continue;
    job.changeIds.push(ch.id);
    job.lastAt = iso;
    // more comments while it waits for a free agent: collect a little longer, they go together
    job.status = "collecting";
    changed = true;
  }
  return changed;
}

/** Jobs whose last comment is debounceMs old are ready to go. */
export function ripen(prefs: Prefs, debounceMs: number, now = Date.now()): boolean {
  let changed = false;
  for (const j of prefs.jobs) {
    if (j.status === "collecting" && now - Date.parse(j.lastAt) >= debounceMs) {
      j.status = "queued";
      changed = true;
    }
  }
  return changed;
}

/** Answered and looked at, or failed, a week ago: gone. At most 200 jobs either way. */
export function prune(prefs: Prefs, now = Date.now()): boolean {
  const before = prefs.jobs.length;
  const week = 7 * 24 * 3_600_000;
  prefs.jobs = prefs.jobs
    .filter((j) => !((j.status === "answered" || j.status === "failed") && now - Date.parse(j.answeredAt ?? j.lastAt) > week))
    .slice(-200);
  return prefs.jobs.length !== before;
}

const ARTIFACT = /https:\/\/claude\.ai\/(?:code\/)?artifacts?\/[\w-]+/g;
const SUMMARY = /^[#>*_\s]*(?:summary|kurzfazit|zusammenfassung|fazit)[*_\s]*:[*_\s]*(.+)$/im;

/** "Summary:" line of an answer, or its first real line. */
export function summaryOf(reply: string): string {
  const line = reply.match(SUMMARY)?.[1] ?? reply.split("\n").find((l) => l.replace(/[#>*_\s-]/g, "")) ?? "";
  const clean = line.replace(/[*_`]+/g, "").replace(/^#+\s*/, "").trim();
  return clean.length > 240 ? clean.slice(0, 239).trimEnd() + "…" : clean;
}

/** The fenced block with proposed thread replies the auto prompt asks for (the last one counts). */
const REPLIES = /```[ \t]*(?:dashboard-)?replies[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*/gi;

/**
 * Splits the agent's answer into its text and the replies it proposes for threads – a JSON list
 * of {thread, reply, resolve} in a ```replies block. A broken block stays in the text, unparsed.
 */
export function repliesOf(answer: string): { text: string; suggestions: Suggestion[] } {
  const blocks = [...answer.matchAll(REPLIES)];
  const last = blocks.at(-1);
  if (!last) return { text: answer, suggestions: [] };
  let list: unknown;
  try {
    list = JSON.parse(last[1]!);
  } catch {
    return { text: answer, suggestions: [] };
  }
  if (!Array.isArray(list)) return { text: answer, suggestions: [] };
  const suggestions = list
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({ thread: String(s.thread ?? "").trim(), reply: typeof s.reply === "string" ? s.reply.trim() : "", resolve: s.resolve === true }))
    .filter((s) => s.thread && s.reply);
  const text = (answer.slice(0, last.index) + answer.slice(last.index! + last[0].length)).replace(/\n{3,}/g, "\n\n").trim();
  return { text, suggestions };
}

/**
 * The agent's answer to a job: its text after the prompt with the marker, up to the next thing
 * you typed. The final message is the answer; an artifact link may be in any of them.
 * Without the marker (a paste the agent shows shortened, say) the first prompt since sentAt counts.
 */
export function answerOf(messages: ChatMessage[], marker: string, sentAt?: string): { reply: string; artifact?: string } | undefined {
  let start = messages.findLastIndex((m) => m.role === "user" && m.text.includes(marker));
  if (start < 0 && sentAt) {
    const since = Date.parse(sentAt) - 5000;
    start = messages.findIndex((m) => m.role === "user" && m.at !== undefined && Date.parse(m.at) >= since);
  }
  if (start < 0) return undefined;
  const after = messages.slice(start + 1);
  const end = after.findIndex((m) => m.role === "user");
  const turn = (end < 0 ? after : after.slice(0, end)).filter((m) => m.role === "assistant");
  const reply = turn.at(-1)?.text;
  if (!reply) return undefined;
  const links = turn.flatMap((m) => m.text.match(ARTIFACT) ?? []);
  return { reply, artifact: links.at(-1) };
}

export type AutopilotDeps = {
  herdr: Herdr;
  prefs: Prefs;
  save(): Promise<void>;
  /** re-render the pages */
  publish(): void;
  /** a comment change id → the comment and the ticket/PR it's on (server's findTarget) */
  findComment(changeId: string): { target: Target; comment?: Comment } | undefined;
  loadPrompts(): Promise<Prompts>;
  claudeProjects: string;
  /** where new spaces start; unset = jobs without a space fail */
  workdir?: string;
  debounceSeconds: number;
  /** language the answer should be in, e.g. "German" */
  language: string;
};

/** Gives up on a job: shown as failed on its to-do until looked at. */
const fail = (job: AgentJob, error: string) => {
  job.status = "failed";
  job.error = error;
  job.answeredAt = new Date().toISOString();
  console.error(`autopilot ${job.ref}: ${error}`);
};

/**
 * Runs the jobs: call tick() whenever herdr or the polled state changed (and now and then anyway).
 * Ticks never overlap; one that comes in while another runs is run again afterwards.
 */
export function startAutopilot(d: AutopilotDeps) {
  let running = false;
  let again = false;
  const starting = new Set<string>();

  /** Notes why a job waits; true when that's news for the page. */
  const wait = (job: AgentJob, why: NonNullable<AgentJob["waiting"]>) => {
    if (job.waiting === why) return false;
    job.waiting = why;
    return true;
  };

  const sentTo = (job: AgentJob, pane: string, seq: number | undefined) => {
    job.status = "sent";
    job.waiting = undefined;
    job.pane = pane;
    job.sentAt = new Date().toISOString();
    job.sentSeq = seq;
    d.prefs.routes[job.resource] = pane;
    for (const id of job.changeIds) markSent(d.prefs, id);
    console.log(`autopilot ${job.ref}: ${job.changeIds.length} comment(s) → ${pane}`);
  };

  /** Ticket/PR of the job and its comments, from the current snapshot (or the change log). */
  const resolve = (job: AgentJob) => {
    const found = job.changeIds.map((id) => d.findComment(id)).filter((f) => f !== undefined);
    const target = found[0]?.target;
    const comments = found.map((f) => f.comment).filter((c): c is Comment => !!c);
    return target && comments.length ? { target, comments } : undefined;
  };

  /** Hands a queued job to its agent – true if anything changed. */
  async function send(job: AgentJob, busy: Set<string>): Promise<boolean> {
    const r = resolve(job);
    if (!r) {
      fail(job, "ticket/PR or its comments are gone");
      return true;
    }
    const { target } = r;
    const spaces = spacesForItem(d.herdr.spaces(), target);
    const all = d.herdr.spaces().flatMap((s) => s.agents);
    // a space we started for it: that agent, once it's ready
    const own = job.pane ? all.find((a) => a.paneId === job.pane) : undefined;
    const agent = own ?? pickAgent(spaces, d.prefs.routes[job.resource])?.agent;
    const prompts = await d.loadPrompts();
    const prompt = prepareAuto(prompts, target, r.comments, markerOf(job), d.language);

    if (!agent) {
      if (job.pane || starting.has(job.id)) return false; // still coming up
      if (!d.workdir) {
        fail(job, "no space with an agent and HERDR_WORKDIR unset");
        return true;
      }
      // no space yet: start one, the prompt goes in as its first
      const { label, args } = prepare(prompts, target);
      const ref = target.kind === "ticket" ? target.issue.ref : target.pr.ref;
      const taken = new Set(all.map((a) => a.name ?? ""));
      starting.add(job.id);
      try {
        const started = await d.herdr.start({ label, cwd: d.workdir, name: agentName(ref, taken), kind: prompts.agent, args, prompt });
        job.pane = started.pane;
        d.prefs.routes[job.resource] = started.pane;
        // asked something first ("trust this folder?"): stays queued until it's idle
        if (started.sent) sentTo(job, started.pane, undefined);
        else console.log(`autopilot ${job.ref}: started ${started.pane}, it asks something first`);
      } catch (e) {
        fail(job, `starting a space failed: ${message(e)}`);
      } finally {
        starting.delete(job.id);
      }
      return true;
    }

    // one job per agent at a time, and only while it's idle/done
    if (busy.has(agent.paneId)) return wait(job, "busy");
    if (agent.status === "blocked") return wait(job, "blocked");
    if (agent.status !== "idle" && agent.status !== "done") return wait(job, "busy");
    try {
      await d.herdr.prompt(agent.paneId, prompt);
      sentTo(job, agent.paneId, agent.seq);
      busy.add(agent.paneId);
      return true;
    } catch (e) {
      if (e instanceof HerdrError && e.code === "agent_blocked") return wait(job, "blocked"); // waits at a question – later
      fail(job, `sending failed: ${message(e)}`);
      return true;
    }
  }

  /** Reads the answer of a sent job once its agent did something and settled again. */
  async function check(job: AgentJob): Promise<boolean> {
    const agent = d.herdr.spaces().flatMap((s) => s.agents).find((a) => a.paneId === job.pane);
    if (!agent) {
      fail(job, "the agent is gone");
      return true;
    }
    if (agent.status !== "idle" && agent.status !== "done") return false;
    // right after sending it may still be idle from before: wait for its next state change
    const moved = job.sentSeq === undefined || agent.seq === undefined ? Date.now() - Date.parse(job.sentAt!) > 15_000 : agent.seq > job.sentSeq;
    if (!moved) return false;

    let answer: { reply: string; artifact?: string } | undefined;
    const isClaude = !agent.kind || /claude/i.test(agent.kind);
    const path = isClaude ? await findTranscript(d.claudeProjects, agent.session, agent.cwd) : undefined;
    if (path) {
      const chat = await readChat(path, 8_000_000, 5000);
      answer = answerOf(chat.messages, markerOf(job), job.sentAt);
    }
    // no transcript (other agent, or not found): what the terminal shows, after a grace period
    if (!answer && (!path || Date.now() - Date.parse(job.sentAt!) > 10 * 60_000)) {
      const text = (await d.herdr.read(agent.paneId, 120)).trim();
      answer = { reply: text, artifact: text.match(ARTIFACT)?.at(-1) };
    }
    if (!answer) return false;
    job.status = "answered";
    job.answeredAt = new Date().toISOString();
    // proposed thread replies: shown in the threads dialog, not as JSON in the answer
    const { text, suggestions } = repliesOf(answer.reply);
    job.reply = text;
    job.summary = summaryOf(text);
    if (suggestions.length) job.suggestions = suggestions;
    job.artifact = answer.artifact;
    job.read = false;
    console.log(`autopilot ${job.ref}: answered${job.artifact ? ` (${job.artifact})` : ""}`);
    return true;
  }

  async function run() {
    let changed = ripen(d.prefs, d.debounceSeconds * 1000) || prune(d.prefs);
    if (!d.herdr.error()) {
      for (const job of d.prefs.jobs.filter((j) => j.status === "sent")) {
        try {
          changed = (await check(job)) || changed;
        } catch (e) {
          console.error(`autopilot ${job.ref}: reading the answer failed: ${message(e)}`);
        }
      }
      const busy = new Set(d.prefs.jobs.filter((j) => j.status === "sent" && j.pane).map((j) => j.pane!));
      // oldest first; a job that waits doesn't hold up the others
      for (const job of d.prefs.jobs.filter((j) => j.status === "queued")) {
        changed = (await send(job, busy)) || changed;
      }
    }
    if (changed) {
      await d.save();
      d.publish();
    }
  }

  async function tick(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await run();
      } while (again);
    } catch (e) {
      console.error(`autopilot: ${message(e)}`);
    } finally {
      running = false;
    }
  }

  /** New changes from a poll: collect them, then see what can go out. */
  async function onFresh(fresh: Change[]) {
    if (collect(d.prefs, fresh)) {
      await d.save();
      d.publish();
    }
    await tick();
  }

  // debounce and herdr's state need a clock of their own, the herdr poll only fires on changes
  const timer = setInterval(() => void tick(), 10_000);
  return { tick, onFresh, stop: () => clearInterval(timer) };
}
