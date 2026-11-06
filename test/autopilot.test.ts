import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerOf, collect, markerOf, repliesOf, ripen, startAutopilot, summaryOf } from "../src/autopilot.ts";
import { withJobs } from "../src/engine.ts";
import { pickAgent, type Herdr } from "../src/herdr.ts";
import { DEFAULTS, prepareAuto, type Target } from "../src/launch.ts";
import type { Agent, Change, Comment, Prefs, PullRequest, Space } from "../src/model.ts";
import { projectDirName } from "../src/transcript.ts";

const prefs = (): Prefs => ({ watches: [], muted: [], sent: [], routes: {}, jobs: [] });

const agent = (paneId: string, extra: Partial<Agent> = {}): Agent => ({ paneId, kind: "claude", status: "idle", tabId: paneId.replace(":p", ":t"), ...extra });
const space = (id: string, label: string, agents: Agent[], activeTabId?: string): Space => ({
  id, number: 1, label, status: "idle", ticketKeys: label.match(/[A-Z]+-\d+/g) ?? [], agents, focused: false, activeTabId,
});

// --- routing -------------------------------------------------------------------

test("pickAgent: sticky pane first, then the active tab, then the most recently busy agent", () => {
  const w14 = space("w14", "DEMA-20 - Form. Versand", [agent("w14:p1", { seq: 35 }), agent("w14:p3", { seq: 36 }), agent("w14:p4", { seq: 116 })], "w14:t3");
  expect(pickAgent([w14], "w14:p1")?.agent.paneId).toBe("w14:p1");
  expect(pickAgent([w14], "w99:p1")?.agent.paneId).toBe("w14:p3"); // sticky pane is gone
  expect(pickAgent([{ ...w14, activeTabId: undefined }])?.agent.paneId).toBe("w14:p4");
  expect(pickAgent([space("w1", "x", [])])).toBeUndefined();
});

test("pickAgent prefers a Claude – only its answer can be read back", () => {
  const s = space("w2", "DEMA-1", [agent("w2:p1", { kind: "codex", seq: 9 }), agent("w2:p2", { seq: 1 })], "w2:t1");
  expect(pickAgent([s])?.agent.paneId).toBe("w2:p2");
});

// --- collecting ------------------------------------------------------------------

const comment = (id: string, resource = "ado:pr:7", extra: Partial<Change> = {}): Change => ({
  id: `pr:${resource}:c:${id}`, at: "2026-11-04T10:00:00Z", kind: "pr-comment", resource, ref: "!7", url: "https://pr/7", subject: "PR", actor: "Tobi", text: id, ...extra,
});

test("comments of a PR are collected into one job, sent after a quiet moment", () => {
  const p = prefs();
  const t0 = Date.parse("2026-11-04T10:00:00Z");
  expect(collect(p, [comment("1"), comment("2"), { ...comment("3"), kind: "pr-vote" }], t0)).toBe(true);
  expect(collect(p, [comment("4")], t0 + 60_000)).toBe(true);
  expect(p.jobs).toHaveLength(1);
  expect(p.jobs[0]!.changeIds).toHaveLength(3);
  expect(ripen(p, 120_000, t0 + 150_000)).toBe(false); // 90 s after the last one
  expect(ripen(p, 120_000, t0 + 181_000)).toBe(true);
  expect(p.jobs[0]!.status).toBe("queued");
});

test("muted PRs and comments already sent by hand don't make a job", () => {
  const p = prefs();
  p.muted = ["ado:pr:7"];
  p.sent = [comment("2", "ado:pr:8").id];
  collect(p, [comment("1"), comment("2", "ado:pr:8")]);
  expect(p.jobs).toHaveLength(0);
});

// --- answers ---------------------------------------------------------------------

const msgs = (...m: [string, string, string?][]) => m.map(([role, text, at], i) => ({ id: String(i), role: role as "user", text, at }));

test("answerOf: the last text after the marked prompt, up to the next thing typed, with the artifact link", () => {
  const m = msgs(
    ["user", "earlier"],
    ["assistant", "old answer"],
    ["user", "[dashboard j1] New comments on !7"],
    ["assistant", "Looking at it, draft at https://claude.ai/code/artifact/abc-123"],
    ["tool", "Bash: git diff"],
    ["assistant", "Summary: renamed it.\n\nDetails: https://claude.ai/artifact/final-9"],
    ["user", "thanks, now something else"],
    ["assistant", "unrelated"],
  );
  expect(answerOf(m, "[dashboard j1]")).toEqual({ reply: "Summary: renamed it.\n\nDetails: https://claude.ai/artifact/final-9", artifact: "https://claude.ai/artifact/final-9" });
  expect(answerOf(m, "[dashboard j2]")).toBeUndefined();
});

test("answerOf: without the marker, the first prompt since sending counts", () => {
  const m = msgs(["user", "old", "2026-11-04T09:00:00Z"], ["user", "[Pasted text #1]", "2026-11-04T10:00:02Z"], ["assistant", "done", "2026-11-04T10:05:00Z"]);
  expect(answerOf(m, "[dashboard j1]", "2026-11-04T10:00:00Z")?.reply).toBe("done");
});

test("summaryOf: the Summary line, else the first real line", () => {
  expect(summaryOf("Some intro\n**Summary:** Two fixes made, one question left.")).toBe("Two fixes made, one question left.");
  expect(summaryOf("Kurzfazit: Alles erledigt.")).toBe("Alles erledigt.");
  expect(summaryOf("\n## Changes to `send()`\nmore")).toBe("Changes to send()");
});

// --- prompt ----------------------------------------------------------------------

const pr: PullRequest = {
  id: "ado:pr:7", source: "ado", number: 7, ref: "!7", url: "https://pr/7", title: "Versand", repo: "app", branch: "feature/versand", targetBranch: "main",
  author: "me", role: "author", status: "active", createdAt: "2026-11-01T00:00:00Z", reviewers: [], comments: [], ticketKeys: ["DEMA-20"],
} as unknown as PullRequest;
const cm = (id: string, text: string): Comment => ({ id, author: "Tobi", authorIsMe: false, text, at: "2026-11-04T10:00:00Z" });

test("prepareAuto: marker, every comment quoted, the branch for a PR", () => {
  const text = prepareAuto(DEFAULTS, { kind: "pr", pr }, [cm("1", "rename this"), cm("2", "line one\nline two")], "[dashboard j1]", "German");
  expect(text.startsWith("[dashboard j1] New comments on !7")).toBe(true);
  expect(text).toContain("  > line one\n  > line two");
  expect(text).toContain("feature/versand");
  expect(text).toContain("Answer in German");
  expect(prepareAuto({ ...DEFAULTS, auto: { prompt: "just {comments}" } }, { kind: "pr", pr }, [cm("1", "x")], "[dashboard j1]", "German")).toStartWith("[dashboard j1] ");
  // no threads known: nothing to propose replies for
  expect(text).not.toContain("```replies");
});

test("prepareAuto: with its threads, the new comments stand in their conversation and replies are asked for", () => {
  const threads = [
    { id: "41", file: "/src/send.ts", line: 12, comments: [
      { id: "41:1", author: "me", authorIsMe: true, body: "Moved it here.", at: "2026-11-04T09:00:00Z" },
      { id: "41:2", author: "Tobi", authorIsMe: false, body: "Why not\nin the service?", at: "2026-11-04T10:00:00Z" },
    ] },
    { id: "42", comments: [{ id: "42:1", author: "Tobi", authorIsMe: false, body: "unrelated", at: "2026-11-03T10:00:00Z" }] },
  ];
  const text = prepareAuto(DEFAULTS, { kind: "pr", pr: { ...pr, threads } }, [cm("41:2", "Why not in the service?"), cm("77:1", "gone")], "[dashboard j1]", "German");
  expect(text).toContain("Thread 41 on /src/send.ts:12:\n- me (me) (2026-11-04T09:00:00Z):\n  > Moved it here.\n- Tobi (2026-11-04T10:00:00Z) NEW:\n  > Why not\n  > in the service?");
  expect(text).not.toContain("Thread 42"); // no new comment in it
  expect(text).toContain("comment id 77:1"); // not in an open thread: as before
  expect(text).toContain("6. Propose a reply for each thread (41)");
  expect(text).toContain('```replies\n[{"thread": "41", "reply": "…", "resolve": false}]\n```');
  // a custom template gets the request appended
  const custom = prepareAuto({ ...DEFAULTS, auto: { prompt: "{marker} {comments}" } }, { kind: "pr", pr: { ...pr, threads } }, [cm("41:2", "x")], "[dashboard j1]", "German");
  expect(custom).toContain("```replies");
});

test("repliesOf: the last replies block becomes proposals and leaves the answer", () => {
  const answer = [
    "Summary: Moved it.",
    "",
    "Details …",
    "",
    "```replies",
    '[{"thread": "41", "reply": "Good point – moved it into the service.", "resolve": true}, {"thread": "42", "reply": "  "}, {"reply": "no thread"}]',
    "```",
  ].join("\n");
  expect(repliesOf(answer)).toEqual({
    text: "Summary: Moved it.\n\nDetails …",
    suggestions: [{ thread: "41", reply: "Good point – moved it into the service.", resolve: true }],
  });
  // broken JSON: everything stays as it was, nothing proposed
  const broken = "Summary: x\n```replies\n[{thread: 41}]\n```";
  expect(repliesOf(broken)).toEqual({ text: broken, suggestions: [] });
  expect(repliesOf("Summary: x")).toEqual({ text: "Summary: x", suggestions: [] });
});

// --- to-dos ----------------------------------------------------------------------

test("withJobs: a job joins the to-do of its PR, otherwise it becomes one; read answers drop out", () => {
  const hint = { level: "action" as const, reason: "threads" as const, resource: "ado:pr:7", ref: "!7", msg: ["openThreads", 2, "PR"] as const, url: "u" };
  const base = { ref: "!7", url: "u", changeIds: ["a"], createdAt: "x", lastAt: "2026-11-04T10:00:00Z" };
  const jobs = [
    { ...base, id: "j1", resource: "ado:pr:7", status: "answered" as const, read: false },
    { ...base, id: "j2", resource: "ado:pr:8", status: "sent" as const },
    { ...base, id: "j3", resource: "ado:pr:9", status: "answered" as const, read: true },
  ];
  const out = withJobs([hint], jobs);
  expect(out.map((h) => [h.resource, h.reason, h.job?.id])).toEqual([
    ["ado:pr:7", "threads", "j1"],
    ["ado:pr:8", "agent-reply", "j2"],
  ]);
});

// --- a whole round, with a fake herdr and a transcript on disk ------------------

const dir = await mkdtemp(join(tmpdir(), "autopilot-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("tick: sends to the free agent, waits for it, reads the answer from its transcript", async () => {
  const cwd = "C:\\CleverTax";
  await mkdir(join(dir, projectDirName(cwd)), { recursive: true });
  const transcript = join(dir, projectDirName(cwd), "s1.jsonl");
  const a = agent("w14:p4", { seq: 10, cwd, session: { kind: "id", value: "s1" } });
  const spaces = [space("w14", "DEMA-20 - Form. Versand", [a], "w14:t4")];
  const prompts: { pane: string; text: string }[] = [];
  const herdr: Herdr = {
    spaces: () => spaces,
    error: () => undefined,
    refresh: async () => {},
    read: async () => "",
    prompt: async (pane, text) => void prompts.push({ pane, text }),
    start: async () => { throw new Error("no start expected"); },
    focus: async () => {},
    stop() {},
  };
  const p = prefs();
  const target: Target = { kind: "pr", pr };
  const comments: Record<string, Comment> = { [comment("1").id]: cm("1", "rename this") };
  collect(p, [comment("1")], Date.now() - 10_000);
  let saves = 0;
  const pilot = startAutopilot({
    herdr, prefs: p, save: async () => void saves++, publish() {},
    findComment: (id) => (comments[id] ? { target, comment: comments[id] } : undefined),
    loadPrompts: async () => DEFAULTS, claudeProjects: dir, debounceSeconds: 0, language: "German",
  });
  try {
    // still working: wait, and say why
    a.status = "working";
    await pilot.tick();
    expect(prompts).toHaveLength(0);
    expect(p.jobs[0]!.waiting).toBe("busy");
    // idle again – its tab being open in herdr doesn't matter
    a.status = "idle";
    a.focused = true;

    await pilot.tick();
    expect(p.jobs[0]!.waiting).toBeUndefined();
    expect(prompts.map((x) => x.pane)).toEqual(["w14:p4"]);
    const job = p.jobs[0]!;
    expect(job.status).toBe("sent");
    expect(p.routes["ado:pr:7"]).toBe("w14:p4");
    expect(p.sent).toContain(comment("1").id);

    // still idle from before: no answer yet, and nothing sent twice
    await pilot.tick();
    expect(job.status).toBe("sent");
    expect(prompts).toHaveLength(1);

    // it worked and settled; the transcript has the answer
    const line = (o: object) => JSON.stringify(o);
    await writeFile(transcript, [
      line({ type: "user", uuid: "u1", message: { content: prompts[0]!.text } }),
      line({ type: "assistant", uuid: "a1", message: { content: [{ type: "text", text: "Summary: Renamed it, see https://claude.ai/artifact/p-1" }] } }),
    ].join("\n"));
    a.seq = 12;
    a.status = "done";
    await pilot.tick();
    expect(job).toMatchObject({ status: "answered", summary: "Renamed it, see https://claude.ai/artifact/p-1", artifact: "https://claude.ai/artifact/p-1", read: false });
    expect(saves).toBeGreaterThan(0);
  } finally {
    pilot.stop();
  }
});

test("tick: no space for the PR – starts one with the prompt as its first", async () => {
  const started: { label: string; prompt: string }[] = [];
  const herdr: Herdr = {
    spaces: () => [],
    error: () => undefined,
    refresh: async () => {},
    read: async () => "",
    prompt: async () => {},
    start: async (o) => (started.push(o), { pane: "w20:p1", sent: true }),
    focus: async () => {},
    stop() {},
  };
  const p = prefs();
  collect(p, [comment("1")], Date.now() - 10_000);
  const pilot = startAutopilot({
    herdr, prefs: p, save: async () => {}, publish() {},
    findComment: () => ({ target: { kind: "pr", pr }, comment: cm("1", "x") }),
    loadPrompts: async () => DEFAULTS, claudeProjects: dir, workdir: "C:\\CleverTax", debounceSeconds: 0, language: "German",
  });
  try {
    await pilot.tick();
    expect(started).toHaveLength(1);
    expect(started[0]!.prompt).toContain(markerOf(p.jobs[0]!));
    expect(p.jobs[0]).toMatchObject({ status: "sent", pane: "w20:p1" });
  } finally {
    pilot.stop();
  }
});

test("tick: the new space asked something first – once answered, it gets the prompt even while focused", async () => {
  const spaces: Space[] = [];
  const prompts: string[] = [];
  const herdr: Herdr = {
    spaces: () => spaces,
    error: () => undefined,
    refresh: async () => {},
    read: async () => "",
    prompt: async (pane) => void prompts.push(pane),
    start: async () => ({ pane: "w20:p1", sent: false }),
    focus: async () => {},
    stop() {},
  };
  const p = prefs();
  collect(p, [comment("1")], Date.now() - 10_000);
  const pilot = startAutopilot({
    herdr, prefs: p, save: async () => {}, publish() {},
    findComment: () => ({ target: { kind: "pr", pr }, comment: cm("1", "x") }),
    loadPrompts: async () => DEFAULTS, claudeProjects: dir, workdir: "C:\\CleverTax", debounceSeconds: 0, language: "German",
  });
  try {
    await pilot.tick();
    expect(p.jobs[0]).toMatchObject({ status: "queued", pane: "w20:p1" });
    // "trust this folder?" – you answer it in herdr, so its pane is focused
    const a = agent("w20:p1", { status: "blocked" });
    a.focused = true;
    spaces.push(space("w20", "!7", [a]));
    await pilot.tick();
    expect(prompts).toHaveLength(0);
    a.status = "idle";
    await pilot.tick();
    expect(prompts).toEqual(["w20:p1"]);
    expect(p.jobs[0]!.status).toBe("sent");
  } finally {
    pilot.stop();
  }
});

test("a to-do with an answered job shows 🤖 with the answer, the artifact link and 'read' (live only)", async () => {
  const { renderApp } = await import("../src/render.ts");
  const { link } = await import("../src/correlate.ts");
  const job = {
    id: "j1", resource: "ado:pr:7", ref: "!7", url: "u", changeIds: ["a", "b"], status: "answered" as const, createdAt: "x",
    lastAt: "2026-11-04T10:00:00Z", answeredAt: "2026-11-04T10:30:00Z", pane: "w14:p4", summary: "Renamed it.",
    reply: "Summary: Renamed it.\n<script>x</script>", artifact: "https://claude.ai/artifact/p-1", read: false,
  };
  const view = {
    lang: "de" as const,
    snapshot: { takenAt: "2026-11-04T10:30:00Z", prs: [], issues: [], runs: [], errors: [] },
    changes: [],
    hints: withJobs([], [job]),
    links: link([], []),
    muted: new Set<string>(),
    watched: new Set<string>(),
    refreshSeconds: 300,
    runsKeepHours: 24,
    statusOrder: [],
    sources: ["ado" as const],
    sent: new Set<string>(),
  };
  const live = renderApp(view, true);
  expect(live).toContain(`class="job st-answered unread"`);
  expect(live).toContain(`href="https://claude.ai/artifact/p-1"`);
  expect(live).toContain(`data-job-read="j1"`);
  expect(live).toContain("&lt;script&gt;");
  expect(renderApp(view, false)).not.toContain("data-job-read");
  // proposals not posted yet: a button to review them
  const proposing = renderApp({ ...view, hints: withJobs([], [{ ...job, suggestions: [{ thread: "41", reply: "ok", resolve: false }, { thread: "42", reply: "x", resolve: false, sent: true }] }]) }, true);
  expect(proposing).toContain(`data-threads="ado:pr:7"`);
  expect(proposing).toContain("Antwortvorschläge prüfen (1)");
  // artifact opened: no dot any more, but still on the to-do
  const seen = renderApp({ ...view, hints: withJobs([], [{ ...job, seen: true }]) }, true);
  expect(seen).toContain(`class="job st-answered"`);
});

test("💬 n on PR cards and on every to-do of a PR: a button that opens its threads (live, where the source has them)", async () => {
  const { renderApp } = await import("../src/render.ts");
  const { link } = await import("../src/correlate.ts");
  const withThreads = { ...pr, openThreads: 2, isDraft: false, hasConflicts: false, threads: [] } as PullRequest;
  const github = { ...pr, id: "github:o/r#3", ref: "r#3", openThreads: 1, isDraft: false, hasConflicts: false } as PullRequest;
  const hint = (resource: string) => ({ level: "action" as const, reason: "waiting" as const, resource, ref: "!7", msg: ["reviewerWaiting", "Tobi", "PR"] as const, url: "u" });
  const view = {
    lang: "de" as const,
    snapshot: { takenAt: "2026-11-04T10:30:00Z", prs: [withThreads, github], issues: [], runs: [], errors: [] },
    changes: [],
    hints: [hint("ado:pr:7"), hint("github:o/r#3")],
    links: link([withThreads, github], []),
    muted: new Set<string>(),
    watched: new Set<string>(),
    refreshSeconds: 300,
    runsKeepHours: 24,
    statusOrder: [],
    sources: ["ado" as const, "github" as const],
    sent: new Set<string>(),
  };
  const live = renderApp(view as never, true);
  // to-do and card of the ADO PR
  expect(live.match(/data-threads="ado:pr:7"[^>]*>💬 2</g)).toHaveLength(2);
  // GitHub has no threads to show: the count only
  expect(live).not.toContain(`data-threads="github:o/r#3"`);
  expect(live).toContain(`💬 1</span>`);
  expect(renderApp(view as never, false)).not.toContain("data-threads");
});

test("a ticket is one thread: 💬 n of its comments, yellow while the last isn't mine; the prompt asks for one comment", async () => {
  const { renderApp } = await import("../src/render.ts");
  const { link } = await import("../src/correlate.ts");
  const c = (id: string, mine: boolean): Comment => ({ id, author: mine ? "me" : "Tobi", authorIsMe: mine, text: "x", wiki: "x", at: "2026-11-04T10:00:00Z" });
  const issue = (key: string, comments: Comment[]) => ({
    id: `jira:${key}`, source: "jira" as const, ref: key, url: "u", title: "T", type: "Story", status: "In Arbeit",
    statusCategory: "indeterminate" as const, updatedAt: "2026-11-04T10:00:00Z", comments, scope: "list" as const,
  });
  const open = issue("DEMA-1", [c("1", true), c("2", false)]);
  const answered = issue("DEMA-2", [c("3", false), c("4", true)]);
  const view = {
    lang: "de" as const,
    snapshot: { takenAt: "2026-11-04T10:30:00Z", prs: [], issues: [open, answered], runs: [], errors: [] },
    changes: [],
    hints: [{ level: "action" as const, reason: "feedback" as const, resource: open.id, ref: "DEMA-1", msg: ["feedback", "Tobi", "Feedback"] as const, url: "u" }],
    links: link([], [open, answered]),
    muted: new Set<string>(),
    watched: new Set<string>(),
    refreshSeconds: 300,
    runsKeepHours: 24,
    statusOrder: [],
    sources: ["jira" as const],
    sent: new Set<string>(),
  };
  const live = renderApp(view as never, true);
  expect(live).toContain(`class="badge warn threads-open" data-threads="jira:DEMA-1"`);
  expect(live).toContain(`class="badge threads-open" data-threads="jira:DEMA-2"`);
  expect(live.match(/data-threads="jira:DEMA-1"/g)!.length).toBeGreaterThanOrEqual(2); // to-do and issue row

  const prompt = prepareAuto(DEFAULTS, { kind: "ticket", issue: open }, [c("2", false)], "[dashboard j1]", "German");
  expect(prompt).toContain("Propose one comment for the ticket");
  expect(prompt).toContain('[{"thread": "issue", "reply": "…"}]');
});

test("a GitLab issue gets one proposed comment in Markdown; its comments go in full", () => {
  const issue = {
    id: "gitlab:mari/testprojekt#1", source: "gitlab" as const, ref: "testprojekt#1", url: "u", title: "Add docker file", type: "Issue",
    status: "Open", statusCategory: "indeterminate" as const, updatedAt: "2026-11-04T10:00:00Z", comments: [], scope: "involved" as const,
  };
  const c: Comment = { id: "9", author: "Tobi", authorIsMe: false, text: "one line", full: "first\nsecond", at: "2026-11-04T10:00:00Z" };
  const prompt = prepareAuto(DEFAULTS, { kind: "ticket", issue }, [c], "[dashboard j1]", "German");
  expect(prompt).toContain("  > first\n  > second");
  expect(prompt).toContain("in Markdown");
  expect(prompt).toContain('[{"thread": "issue", "reply": "…"}]');
});

test("a GitLab issue finds its space by its ref, and its start prompt names GitLab", async () => {
  const { spacesForItem } = await import("../src/herdr.ts");
  const { prepare } = await import("../src/launch.ts");
  const issue = {
    id: "gitlab:mari/testprojekt#1", source: "gitlab" as const, ref: "testprojekt#1", url: "u", title: "Add docker file", type: "Issue",
    status: "Open", statusCategory: "indeterminate" as const, updatedAt: "2026-11-04T10:00:00Z", comments: [], scope: "involved" as const,
  };
  const spaces = [space("w1", "testprojekt#1 - Add docker file", []), space("w2", "testprojekt#12 - other", []), space("w3", "DEMA-20 x", [])];
  expect(spacesForItem(spaces, { kind: "ticket", issue }).map((s) => s.id)).toEqual(["w1"]);
  const launch = prepare(DEFAULTS, { kind: "ticket", issue });
  expect(launch.label).toBe("testprojekt#1 - Add docker file");
  expect(launch.prompt).toStartWith("Read through GitLab issue testprojekt#1");
});

test("a waiting reason this version doesn't know (left in prefs.json) doesn't break the page", async () => {
  const { renderApp } = await import("../src/render.ts");
  const { link } = await import("../src/correlate.ts");
  const job = { id: "j9", resource: "ado:pr:9", ref: "!9", url: "u", changeIds: ["a"], status: "queued" as const, createdAt: "x", lastAt: "2026-11-04T10:00:00Z", waiting: "focused" as never };
  const view = {
    lang: "de" as const, snapshot: { takenAt: "2026-11-04T10:30:00Z", prs: [], issues: [], runs: [], errors: [] }, changes: [],
    hints: withJobs([], [job]), links: link([], []), muted: new Set<string>(), watched: new Set<string>(),
    refreshSeconds: 300, runsKeepHours: 24, statusOrder: [], sources: ["ado" as const], sent: new Set<string>(),
  };
  expect(() => renderApp(view as never, true)).not.toThrow();
});
