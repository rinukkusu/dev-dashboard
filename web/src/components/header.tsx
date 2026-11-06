import { LANGS } from "@shared/i18n.ts";
import { ActivityIcon, BellIcon, BellOffIcon, EyeIcon, KeyboardIcon, LanguagesIcon, MonitorIcon, MonitorOffIcon, RefreshCwIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/ui/tooltip";
import type { Lists } from "@/lib/derive";
import { usePage, type Page } from "@/lib/hash";
import { useT } from "@/lib/i18n";
import { useNotify } from "@/lib/notify";
import { useSound } from "@/lib/sound";
import { api, useLang, useStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/utils";

const LANG_NAMES = { en: "English", de: "Deutsch" } as const;

/** The old page's texts start with an emoji or "+" – the icons say that here. */
const plain = (s: string) => s.replace(/^[^\p{L}]+/u, "");

export function Header({ lists, unseen = 0 }: { lists?: Lists; unseen?: number }) {
  const t = useT();
  const setUi = useUi((s) => s.set);
  const page = usePage();
  const tabs: { page: Page; show: boolean; count?: number; alert?: boolean }[] = [
    { page: "inbox", show: true, count: lists?.counts.inbox },
    { page: "board", show: !!lists?.hasJira },
    { page: "prs", show: !!lists?.hasCode, count: lists?.counts.pendingReviews },
    { page: "issues", show: true, count: lists?.involvedIssues.length },
    { page: "runs", show: !!lists?.hasCode, count: lists?.counts.runsActive, alert: lists?.counts.runFailed },
    { page: "spaces", show: !!lists?.spaces.length, count: lists?.counts.agentsBlocked },
  ];
  return (
    <header className="sticky top-0 z-20 flex h-12 items-center gap-4 border-b bg-card/90 px-4 backdrop-blur">
      <span className="font-semibold tracking-tight">{t.title}</span>
      <nav className="flex items-center gap-0.5 overflow-x-auto">
        {tabs
          .filter((tab) => tab.show)
          .map((tab) => (
            <a
              key={tab.page}
              href={`#${tab.page}`}
              aria-current={page === tab.page ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                page === tab.page && "bg-accent font-medium text-foreground",
              )}
            >
              {t.app.nav[tab.page]}
              {!!tab.count && <span className="rounded-full bg-primary/15 px-1.5 text-xs font-semibold text-primary tabular-nums">{tab.count}</span>}
              {tab.alert && <span className="size-1.5 rounded-full bg-bad" aria-label={t.run.failure} />}
            </a>
          ))}
      </nav>
      <span className="flex-1" />
      {lists && (
        <button
          type="button"
          onClick={() => setUi({ palette: true })}
          className="hidden h-8 w-56 items-center gap-2 rounded-md border bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">{t.app.palette.button} …</span>
          <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">Ctrl K</kbd>
        </button>
      )}
      {lists && (
        <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t.app.palette.button} onClick={() => setUi({ palette: true })}>
          <SearchIcon />
        </Button>
      )}
      <Status />
      {lists && (
        <Tip content={t.watch.title}>
          <Button variant="ghost" size="sm" onClick={() => setUi({ watch: true })}>
            <EyeIcon /> <span className="hidden md:inline">{plain(t.watch.button)}</span>
          </Button>
        </Tip>
      )}
      {lists && (
        <Tip content={t.sections.changes}>
          <Button variant="ghost" size="sm" className="relative xl:hidden" aria-label={t.sections.changes} onClick={() => setUi({ activity: true })}>
            <ActivityIcon />
            {unseen > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">{unseen}</span>}
          </Button>
        </Tip>
      )}
      <RefreshButton />
      <SettingsMenu />
    </header>
  );
}

/** Connection dot and when the data is from. */
function Status() {
  const t = useT();
  const connection = useStore((s) => s.connection);
  const takenAt = useStore((s) => s.view?.snapshot.takenAt);
  // (no `?? []` inside the selector: a new array on every call makes React render forever)
  const errors = useStore((s) => s.view?.snapshot.errors);
  const herdrError = useStore((s) => s.view?.herdr?.error);
  const problems = [...(errors ?? []), ...(herdrError ? [herdrError] : [])];
  const label = { connecting: t.client.connecting, live: t.client.live, offline: t.client.offline }[connection];
  const hm = new Intl.DateTimeFormat(t.locale, { hour: "2-digit", minute: "2-digit" });
  return (
    <Tip
      content={
        problems.length ? (
          <ul className="space-y-1">
            {problems.map((p) => (
              <li key={p}>⚠ {p}</li>
            ))}
            <li className="opacity-70">{t.staleSuffix}</li>
          </ul>
        ) : (
          label
        )
      }
    >
      <span className="flex items-center gap-2 text-xs text-muted-foreground" tabIndex={0}>
        <span
          className={cn(
            "size-2 rounded-full",
            connection === "live" && !problems.length && "bg-ok",
            connection === "live" && problems.length && "bg-warn",
            connection === "connecting" && "animate-pulse bg-muted-foreground",
            connection === "offline" && "bg-bad",
          )}
        />
        {problems.length ? <span className="text-warn">{problems.length} ⚠</span> : null}
        {takenAt && (
          <span className="tabular-nums">
            {t.asOf} {hm.format(new Date(takenAt))}
          </span>
        )}
      </span>
    </Tip>
  );
}

function RefreshButton() {
  const t = useT();
  const polling = useStore((s) => s.polling);
  const [clicked, setClicked] = useState(false);
  useEffect(() => {
    if (!polling) setClicked(false);
  }, [polling]);
  const busy = polling || clicked;
  return (
    <Tip content={t.refresh}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t.refresh}
        disabled={busy}
        onClick={() => {
          setClicked(true);
          api("POST", "/api/refresh").catch(() => setClicked(false));
        }}
      >
        <RefreshCwIcon className={cn(busy && "animate-spin")} />
      </Button>
    </Tip>
  );
}

function SettingsMenu() {
  const t = useT();
  const lang = useLang();
  const setLang = useStore((s) => s.setLang);
  const sound = useSound();
  const notify = useNotify();
  const setUi = useUi((s) => s.set);
  return (
    <DropdownMenu>
      <Tip content={t.app.settings}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t.app.settings}>
            <SettingsIcon />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); sound.toggle(); }}>
          {sound.on ? <BellIcon /> : <BellOffIcon />}
          <span className="flex-1">{t.soundTitle}</span>
          <span className={cn("text-xs", sound.on && !sound.ready ? "text-warn" : "text-muted-foreground")}>
            {plain(!sound.on ? t.client.soundOff : sound.ready ? t.client.soundOn : t.client.soundClick)}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={notify.permission === "unsupported"}
          onSelect={(e) => {
            e.preventDefault();
            void notify.toggle();
          }}
        >
          {notify.on ? <MonitorIcon /> : <MonitorOffIcon />}
          <span className="flex-1">{t.app.notify.label}</span>
          <span className={cn("text-xs", notify.permission === "denied" ? "text-warn" : "text-muted-foreground")}>
            {notify.permission === "unsupported"
              ? t.app.notify.unsupported
              : notify.permission === "denied"
                ? t.app.notify.denied
                : notify.on
                  ? t.app.notify.on
                  : t.app.notify.off}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setUi({ keys: true })}>
          <KeyboardIcon />
          <span className="flex-1">{t.app.keys.button}</span>
          <kbd className="font-mono text-xs text-muted-foreground">?</kbd>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <LanguagesIcon className="size-3.5" /> {t.app.language}
        </DropdownMenuLabel>
        {LANGS.map((l) => (
          <DropdownMenuCheckboxItem key={l} checked={l === lang} onCheckedChange={() => setLang(l)}>
            {LANG_NAMES[l]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
