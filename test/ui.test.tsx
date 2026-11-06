import "./dom.ts";
import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { JobChip, Spaces, ThreadsBadge } from "@/components/bits";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildData, DataContext } from "@/lib/data";
import { lists } from "@/lib/derive";
import { useStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { withJobs } from "../src/engine.ts";
import { dict, hintText } from "../src/i18n.ts";
import type { AgentJob, Comment, Issue, PullRequest, Space } from "../src/model.ts";
import type { ViewData } from "../src/view.ts";

const de = dict("de");
// (not testing-library's `screen`: that binds to document.body on import, before dom.ts ran)
const screen = () => within(document.body);

const view = (over: Partial<ViewData> & { prs?: PullRequest[]; issues?: Issue[] } = {}): ViewData => ({
  snapshot: { takenAt: "2026-11-04T10:30:00Z", prs: over.prs ?? [], issues: over.issues ?? [], runs: [], errors: [] },
  changes: [],
  hints: [],
  muted: [],
  watched: [],
  sent: [],
  runsKeepHours: 24,
  statusOrder: [],
  sources: ["ado", "github", "jira"],
  defaultLang: "de",
  ...over,
});

/** Renders with the view in place, the way App provides it. */
function show(v: ViewData, ui: ReactNode) {
  useStore.setState({ view: v, lang: "de" });
  return render(
    <TooltipProvider>
      <DataContext.Provider value={buildData(v, lists(v))}>{ui}</DataContext.Provider>
    </TooltipProvider>,
  );
}

afterEach(() => {
  cleanup();
  useUi.setState({ agent: undefined, threads: undefined, start: undefined });
});

const pr = (over: Partial<PullRequest>): PullRequest => ({
  id: "ado:pr:7", source: "ado", ref: "!7", number: 7, title: "Versand", url: "u", repo: "app", branch: "feature/versand", targetBranch: "main",
  author: "me", role: "author", status: "active", createdAt: "2026-11-04T08:00:00Z", isDraft: false, hasConflicts: false,
  reviewers: [], openThreads: 0, comments: [], ticketKeys: [], ...over,
});

const issue = (key: string, comments: Comment[] = []): Issue => ({
  id: `jira:${key}`, source: "jira", ref: key, url: "u", title: "Formular Versand", type: "Story", status: "In Arbeit",
  statusCategory: "indeterminate", updatedAt: "2026-11-04T10:00:00Z", comments, scope: "list",
});

const comment = (id: string, mine: boolean): Comment => ({ id, author: mine ? "me" : "Tobi", authorIsMe: mine, text: "x", wiki: "x", at: "2026-11-04T10:00:00Z" });

test("an answered job: a dot until looked at; its popover has the answer (escaped), the artifact, 'read' and the proposals", async () => {
  const job: AgentJob = {
    id: "j1", resource: "ado:pr:7", ref: "!7", url: "u", changeIds: ["a", "b"], status: "answered", createdAt: "x",
    lastAt: "2026-11-04T10:00:00Z", answeredAt: "2026-11-04T10:30:00Z", pane: "w14:p4", summary: "Renamed it.",
    reply: "Summary: Renamed it.\n<script>x</script>", artifact: "https://claude.ai/artifact/p-1", read: false,
    suggestions: [{ thread: "41", reply: "ok", resolve: false }, { thread: "42", reply: "x", resolve: false, sent: true }],
  };
  const { container, rerender } = show(view(), <JobChip job={job} />);
  const trigger = screen().getByRole("button", { name: de.auto.status.answered });
  expect(trigger.querySelector(".bg-primary")).not.toBeNull(); // the unread dot
  await act(async () => fireEvent.click(trigger));
  expect(screen().getByText("Renamed it.")).toBeTruthy();
  expect(screen().getByRole("link", { name: de.auto.artifact }).getAttribute("href")).toBe("https://claude.ai/artifact/p-1");
  expect(screen().getByRole("button", { name: de.auto.read })).toBeTruthy();
  expect(document.body.innerHTML).toContain("&lt;script&gt;");
  expect(document.querySelector("script")).toBeNull();
  // one proposal not posted yet: a button that opens the threads
  await act(async () => fireEvent.click(screen().getByRole("button", { name: de.threads.review.replace("{n}", "1") })));
  expect(useUi.getState().threads).toBe("ado:pr:7");
  // the artifact was opened: no dot any more, still on the to-do
  rerender(
    <TooltipProvider>
      <DataContext.Provider value={buildData(view(), lists(view()))}>
        <JobChip job={{ ...job, seen: true }} />
      </DataContext.Provider>
    </TooltipProvider>,
  );
  expect(container.querySelector("button .bg-primary")).toBeNull();
});

test("💬 n opens a PR's threads where the source has them; GitHub just shows the count", () => {
  const ado = pr({ openThreads: 2, threads: [] });
  const github = pr({ id: "github:o/r#3", source: "github", ref: "r#3", openThreads: 1 });
  show(view({ prs: [ado, github] }), (
    <>
      <ThreadsBadge resource={ado.id} />
      <ThreadsBadge resource={github.id} />
    </>
  ));
  fireEvent.click(screen().getByRole("button", { name: `${de.threads.button}: 2` }));
  expect(useUi.getState().threads).toBe("ado:pr:7");
  expect(screen().queryByRole("button", { name: `${de.badges.openThreads}: 1` })).toBeNull();
  expect(screen().getByText("1")).toBeTruthy();
});

test("a ticket is one thread: 💬 n of its comments, amber while the last one isn't mine", () => {
  const open = issue("DEMA-1", [comment("1", true), comment("2", false)]);
  const answered = issue("DEMA-2", [comment("3", false), comment("4", true)]);
  show(view({ issues: [open, answered] }), (
    <>
      <ThreadsBadge resource={open.id} />
      <ThreadsBadge resource={answered.id} />
    </>
  ));
  const openBadge = screen().getByRole("button", { name: `${de.badges.commentsOpen}: 2` });
  const answeredBadge = screen().getByRole("button", { name: `${de.badges.comments}: 2` });
  expect(openBadge.innerHTML).toContain("text-warn");
  expect(answeredBadge.innerHTML).not.toContain("text-warn");
  fireEvent.click(openBadge);
  expect(useUi.getState().threads).toBe("jira:DEMA-1");
});

test("a ticket shows the space named after it; clicking opens its agent's chat", () => {
  const ticket = issue("DEMA-20");
  const space: Space = {
    id: "w2", number: 2, label: "DEMA-20 - Form. Versand", status: "blocked", ticketKeys: ["DEMA-20"], focused: false,
    agents: [{ paneId: "w2:p2", kind: "claude", status: "blocked" }],
  };
  show(view({ issues: [ticket], herdr: { spaces: [space], canStart: true } }), <Spaces item={{ kind: "ticket", issue: ticket }} />);
  fireEvent.click(screen().getByRole("button", { name: new RegExp(de.herdr.status.blocked) }));
  expect(useUi.getState().agent).toEqual({ pane: "w2:p2", label: "DEMA-20 - Form. Versand" });
});

test("without a space: a button to start one – only for open tickets, and only with HERDR_WORKDIR", () => {
  const ticket = issue("DEMA-21");
  const done = { ...issue("DEMA-22"), statusCategory: "done" as const };
  show(view({ issues: [ticket, done], herdr: { spaces: [], canStart: true } }), (
    <>
      <Spaces item={{ kind: "ticket", issue: ticket }} />
      <Spaces item={{ kind: "ticket", issue: done }} />
    </>
  ));
  expect(screen().getAllByRole("button", { name: de.herdr.start.button })).toHaveLength(1);
  cleanup();
  show(view({ issues: [ticket], herdr: { spaces: [], canStart: false } }), <Spaces item={{ kind: "ticket", issue: ticket }} />);
  expect(screen().queryByRole("button", { name: de.herdr.start.button })).toBeNull();
});

test("a waiting reason this version doesn't know (left in prefs.json) doesn't break anything", () => {
  const job = { id: "j9", resource: "ado:pr:9", ref: "!9", url: "u", changeIds: ["a"], status: "queued" as const, createdAt: "x", lastAt: "2026-11-04T10:00:00Z", waiting: "focused" as never };
  const [hint] = withJobs([], [job]);
  expect(hintText(de, hint!.msg)).toBe(de.auto.hint.queued);
  expect(() => show(view({ hints: [hint!] }), <JobChip job={job} />)).not.toThrow();
});

test("the feed folds a pipeline's runs into one entry; 'New' hides what's seen; runs can be hidden", async () => {
  const { Activity } = await import("@/components/activity");
  const { useSeen } = await import("@/lib/seen");
  useSeen.setState({ lastSeen: Date.parse("2026-11-04T09:30:00Z"), ids: new Set() });
  const run = (id: string, at: string, conclusion: "failure" | "success"): ViewData["changes"][number] =>
    ({ id, at, kind: "run-finished", resource: `ado:run:${id}`, ref: "jp-ci", url: "u", subject: "jp-ci", conclusion });
  const changes = [
    run("r1", "2026-11-04T08:00:00Z", "failure"),
    run("r2", "2026-11-04T09:00:00Z", "failure"),
    run("r3", "2026-11-04T10:00:00Z", "success"),
    { id: "c1", at: "2026-11-04T07:00:00Z", kind: "pr-merged" as const, resource: "ado:pr:7", ref: "!7", url: "u", subject: "Versand" },
  ];
  show(view({ changes }), <Activity />);
  expect(screen().getAllByRole("listitem")).toHaveLength(2);
  const more = screen().getByRole("button", { name: de.app.feed.more(2) });
  fireEvent.click(more);
  expect(screen().getAllByRole("listitem")).toHaveLength(4); // the group's older runs, nested
  fireEvent.click(screen().getByRole("button", { name: de.app.feed.unseen }));
  expect(screen().queryByText(/Versand/)).toBeNull(); // merged before "seen", so not new
  fireEvent.click(screen().getByRole("button", { name: de.app.feed.all }));
  fireEvent.click(screen().getByRole("button", { name: de.app.feed.runs }));
  expect(screen().getAllByRole("listitem")).toHaveLength(1);
  fireEvent.click(screen().getByRole("button", { name: de.app.feed.runs })); // back, for the next test
});

test("keyboard: j picks the first inbox entry, e marks its changes seen, Ctrl+K opens the search", async () => {
  const { useCursor, useShortcuts } = await import("@/lib/keys");
  const { useSeen } = await import("@/lib/seen");
  const { inbox } = await import("@/lib/derive");
  useSeen.setState({ lastSeen: 0, ids: new Set() });
  const p = pr({ openThreads: 1 });
  const v = view({
    prs: [p],
    hints: [{ level: "action", reason: "threads", resource: p.id, ref: p.ref, url: p.url, msg: ["openThreads", 1, p.title] }],
    changes: [{ id: "c1", at: "2026-11-04T10:00:00Z", kind: "pr-comment", resource: p.id, ref: p.ref, url: p.url, subject: p.title }],
  });
  function Keys() {
    useShortcuts(buildData(v, lists(v)), inbox(v), true);
    return null;
  }
  show(v, <Keys />);
  fireEvent.keyDown(document, { key: "j" });
  expect(useCursor.getState().resource).toBe(p.id);
  fireEvent.keyDown(document, { key: "e" });
  expect(useSeen.getState().ids.has("c1")).toBe(true);
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(useUi.getState().palette).toBe(true);
  useUi.setState({ palette: false });
  useCursor.setState({ resource: undefined });
});
