import { useEffect, useMemo } from "react";
import { Header } from "@/components/header";
import { TooltipProvider } from "@/components/ui/tooltip";
import { inbox, lists } from "@/lib/derive";
import { usePage } from "@/lib/hash";
import { useT } from "@/lib/i18n";
import { connect, useLang, useStore } from "@/lib/store";
import { Inbox } from "@/pages/inbox";

export function App() {
  const t = useT();
  const lang = useLang();
  const page = usePage();
  const view = useStore((s) => s.view);
  const derived = useMemo(() => view && lists(view), [view]);
  const items = useMemo(() => (view ? inbox(view) : []), [view]);

  useEffect(connect, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  // unseen to-dos in the tab title, handy as a pinned tab
  useEffect(() => {
    document.title = items.length ? `(${items.length}) ${t.title}` : t.title;
  }, [items.length, t.title]);

  return (
    <TooltipProvider>
      <Header lists={derived} />
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        {!view ? (
          <p className="py-24 text-center text-muted-foreground">{t.firstPoll}</p>
        ) : page === "inbox" ? (
          <Inbox items={items} />
        ) : (
          <p className="py-24 text-center text-muted-foreground">
            {t.app.soon}{" "}
            <a className="text-primary underline-offset-4 hover:underline" href={`/#${page === "board" ? "home" : page}`}>
              →
            </a>
          </p>
        )}
      </main>
    </TooltipProvider>
  );
}
