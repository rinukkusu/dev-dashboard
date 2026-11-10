import type { ViewData } from "@shared/view.ts";
import { useEffect, useMemo, useRef } from "react";
import { Activity } from "@/components/activity";
import { Header } from "@/components/header";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentSheet } from "@/dialogs/agent";
import { KeysDialog } from "@/dialogs/keys";
import { Palette } from "@/dialogs/palette";
import { StartDialog } from "@/dialogs/start";
import { ThreadsDialog } from "@/dialogs/threads";
import { WatchDialog } from "@/dialogs/watch";
import { buildData, DataContext, type Data } from "@/lib/data";
import { inbox, lists } from "@/lib/derive";
import { usePage } from "@/lib/hash";
import { hintText } from "@shared/i18n.ts";
import { useT } from "@/lib/i18n";
import { useShortcuts } from "@/lib/keys";
import { freshHints, notify, notifyKey } from "@/lib/notify";
import { arrivedAt, isUnseen, useSeen } from "@/lib/seen";
import { chime } from "@/lib/sound";
import { connect, useLang, useStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { BoardPage } from "@/pages/board";
import { Inbox } from "@/pages/inbox";
import { IssuesPage, PrsPage, RunsPage } from "@/pages/lists";
import { SpacesPage } from "@/pages/spaces";

export function App() {
  const t = useT();
  const lang = useLang();
  const view = useStore((s) => s.view);
  const data = useMemo(() => view && buildData(view, lists(view)), [view]);

  useEffect(connect, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <TooltipProvider>
      {!data ? (
        <>
          <Header />
          <p className="py-24 text-center text-muted-foreground">{t.firstPoll}</p>
        </>
      ) : (
        <DataContext.Provider value={data}>
          <Page data={data} />
        </DataContext.Provider>
      )}
    </TooltipProvider>
  );
}

function Page({ data }: { data: Data }) {
  const t = useT();
  const page = usePage();
  const items = useMemo(() => inbox(data.view), [data.view]);
  const seen = useSeen();
  const activityOpen = useUi((s) => s.activity);
  const setUi = useUi((s) => s.set);
  const unseen = data.view.changes.filter((c) => isUnseen(c, seen, data.muted)).length;

  useChime(data.view, data.muted);
  useNotifications(data.view, data.muted);
  useShortcuts(data, items, page === "inbox");
  useEffect(() => seen.prune(data.view.changes), [data.view.changes]);
  // unseen changes in the tab title, handy as a pinned tab
  useEffect(() => {
    document.title = unseen ? `(${unseen}) ${t.title}` : t.title;
  }, [unseen, t.title]);

  return (
    <>
      <Header lists={data.lists} unseen={unseen} />
      <div className="flex w-full">
        <main className="mx-auto w-full max-w-[1536px] min-w-0 flex-1 px-4 py-6">
          {page === "inbox" && <Inbox items={items} />}
          {page === "board" && <BoardPage />}
          {page === "prs" && <PrsPage />}
          {page === "issues" && <IssuesPage />}
          {page === "runs" && <RunsPage />}
          {page === "spaces" && <SpacesPage />}
        </main>
        {/* the live feed: a column at the window's right edge on wide screens, a panel otherwise */}
        <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-96 shrink-0 border-l bg-card/40 pt-2 xl:block">
          <Activity className="h-full" />
        </aside>
      </div>
      <Sheet open={activityOpen} onOpenChange={(o) => setUi({ activity: o })}>
        <SheetContent className="sm:max-w-md">
          <SheetTitle className="sr-only">{t.sections.changes}</SheetTitle>
          <Activity className="h-full pt-3" />
        </SheetContent>
      </Sheet>
      <WatchDialog />
      <ThreadsDialog />
      <StartDialog />
      <AgentSheet />
      <Palette />
      <KeysDialog />
    </>
  );
}

/**
 * Rings when a new change comes in (muted ones don't count), or an agent starts waiting for you.
 * Not on the first view: that's what was there before the page opened.
 */
function useChime(view: ViewData, muted: Set<string>) {
  const newest = Math.max(0, ...view.changes.filter((c) => !(c.resource && muted.has(c.resource))).map(arrivedAt));
  const waiting = view.hints.filter((h) => h.reason === "agent-blocked").length;
  const before = useRef<{ newest: number; waiting: number }>(undefined);
  useEffect(() => {
    const b = before.current;
    if (b && (newest > b.newest || waiting > b.waiting)) chime();
    before.current = { newest: Math.max(newest, b?.newest ?? 0), waiting };
  }, [newest, waiting]);
}

/** A desktop notification for each new hint worth one (see notify.ts); not for the first view. */
function useNotifications(view: ViewData, muted: Set<string>) {
  const t = useT();
  const before = useRef<Set<string>>(undefined);
  useEffect(() => {
    const keys = new Set(view.hints.map(notifyKey));
    if (before.current) {
      const s = view.snapshot;
      const titles = new Map<string, string>([...s.prs.map((p) => [p.id, p.title] as const), ...s.issues.map((i) => [i.id, i.title] as const)]);
      for (const h of freshHints(view.hints, before.current, muted)) {
        const title = titles.get(h.resource);
        notify(`${t.reasons[h.reason]} · ${h.ref}`, title ?? hintText(t, h.msg), notifyKey(h), () => {
          location.hash = "inbox";
        });
      }
    }
    before.current = keys;
  }, [view.hints, view.snapshot, muted, t]);
}
