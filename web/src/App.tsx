import type { ViewData } from "@shared/view.ts";
import { useEffect, useMemo, useRef } from "react";
import { Activity } from "@/components/activity";
import { Header } from "@/components/header";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AgentSheet } from "@/dialogs/agent";
import { StartDialog } from "@/dialogs/start";
import { ThreadsDialog } from "@/dialogs/threads";
import { WatchDialog } from "@/dialogs/watch";
import { buildData, DataContext, type Data } from "@/lib/data";
import { inbox, lists } from "@/lib/derive";
import { usePage } from "@/lib/hash";
import { useT } from "@/lib/i18n";
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
  useEffect(() => seen.prune(data.view.changes), [data.view.changes]);
  // unseen changes in the tab title, handy as a pinned tab
  useEffect(() => {
    document.title = unseen ? `(${unseen}) ${t.title}` : t.title;
  }, [unseen, t.title]);

  return (
    <>
      <Header lists={data.lists} unseen={unseen} />
      <div className="mx-auto flex w-full max-w-[1920px] gap-6 px-4">
        <main className="min-w-0 flex-1 py-6">
          {page === "inbox" && <Inbox items={items} />}
          {page === "board" && <BoardPage />}
          {page === "prs" && <PrsPage />}
          {page === "issues" && <IssuesPage />}
          {page === "runs" && <RunsPage />}
          {page === "spaces" && <SpacesPage />}
        </main>
        {/* the live feed: a column next to the page on wide screens, a panel otherwise */}
        <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-96 shrink-0 border-l py-4 pl-4 xl:block">
          <Activity className="h-full" />
        </aside>
      </div>
      <Sheet open={activityOpen} onOpenChange={(o) => setUi({ activity: o })}>
        <SheetContent className="sm:max-w-md">
          <SheetTitle className="sr-only">{t.sections.changes}</SheetTitle>
          <Activity className="h-full px-3 py-3" />
        </SheetContent>
      </Sheet>
      <WatchDialog />
      <ThreadsDialog />
      <StartDialog />
      <AgentSheet />
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
