// The remote control for herdr on the phone (served by src/remote.ts): the agents as chats (latest first) and the spaces,
// and an agent as a chat to read and write to – with keys for answering its questions.
import { LANGS, type Lang } from "@shared/i18n.ts";
import type { AgentStatus, ChatMessage } from "@shared/model.ts";
import type { RemoteSpace } from "@shared/view.ts";
import { ArrowUpIcon, BellIcon, BellOffIcon, ChevronLeftIcon, ChevronRightIcon, EllipsisVerticalIcon, LogOutIcon, MessageCircleQuestionIcon, SendIcon, SmartphoneIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChatMessages } from "@/components/chat";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n";
import { api, useLang, useStore } from "@/lib/store";
import { agentError } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { questionOf } from "@shared/question.ts";
import { usePush } from "./push";
import { Ago } from "@/components/time";
import { agentHref, connectSpaces, deviceName, tabHref, useRemote, useRoute, type Tab } from "./state";

const LANG_NAMES: Record<Lang, string> = { en: "English", de: "Deutsch" };

/** keys for a waiting agent's question besides a number per choice */
const CONTROL_KEYS = ["enter", "esc", "up", "down"] as const;

type Me = { device: { id: string; name: string }; lang: Lang };
type ChatResponse = { found: boolean; unchanged?: boolean; status: AgentStatus; size?: number; title?: string; messages?: ChatMessage[] };

export function RemoteApp() {
  const t = useT();
  const lang = useLang();
  /** undefined = checking, null = not paired */
  const [me, setMe] = useState<Me | null>();
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t.remote.appTitle;
  }, [lang, t]);

  useEffect(() => {
    const takeLang = (l: unknown) => {
      if (!useStore.getState().lang && LANGS.includes(l as Lang)) useStore.setState({ lang: l as Lang });
    };
    const check = () =>
      api<Me>("GET", "/api/me").then(
        (r) => (takeLang(r.lang), setMe(r)),
        (e) => (takeLang(e?.lang), setMe(null)),
      );
    // the QR code's link: /pair#<code> – trade the code for this device's cookie
    const code = location.pathname === "/pair" ? location.hash.slice(1) : "";
    if (!code) return void check();
    history.replaceState(null, "", "/");
    api("POST", "/api/pair", { code, name: deviceName() }).then(check, (e) => {
      setProblem(e?.error === "too-many-tries" ? t.remote.tooMany : t.remote.badCode);
      void check();
    });
    // once only: t is just for the texts of a failed pairing, and a code can't be used twice
  }, []);
  const revoked = useCallback(() => setMe(null), []);

  if (me === undefined) return <Screen>{problem ? null : <p className="p-6 text-center text-sm text-muted-foreground">{t.remote.pairing}</p>}</Screen>;
  if (me === null) return <Unpaired problem={problem} />;
  return <Paired onRevoked={revoked} />;
}

function Screen({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex h-dvh max-w-2xl flex-col">{children}</div>;
}

function Unpaired({ problem }: { problem?: string }) {
  const t = useT();
  return (
    <Screen>
      <div className="m-auto grid max-w-sm justify-items-center gap-3 p-6 text-center">
        <SmartphoneIcon className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t.remote.unpaired}</h1>
        {problem && <p className="text-sm text-bad">{problem}</p>}
        <p className="text-sm text-muted-foreground">{t.remote.unpairedHint}</p>
      </div>
    </Screen>
  );
}

function Paired({ onRevoked }: { onRevoked: () => void }) {
  const { pane, tab } = useRoute();
  useEffect(() => connectSpaces(onRevoked), [onRevoked]);
  return pane ? <AgentScreen key={pane} pane={pane} /> : <HomeScreen tab={tab} onLogout={onRevoked} />;
}

// --- home: chats and spaces ---------------------------------------------------------------

function HomeScreen({ tab, onLogout }: { tab: Tab; onLogout: () => void }) {
  const t = useT();
  const { spaces, error, connection } = useRemote();
  return (
    <Screen>
      <header className="sticky top-0 z-10 border-b bg-card/90 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 text-lg font-semibold tracking-tight">{t.remote.appTitle}</h1>
          <ConnectionDot />
          <Menu onLogout={onLogout} />
        </div>
        <nav className="-mb-px flex" aria-label={t.remote.appTitle}>
          {(["chats", "spaces"] as const).map((x) => (
            <a
              key={x}
              href={tabHref(x)}
              aria-current={tab === x ? "page" : undefined}
              className={cn("flex-1 border-b-2 py-2.5 text-center text-sm", tab === x ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground")}
            >
              {t.remote.tabs[x]}
            </a>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-y-auto px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && <p className="mb-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}
        {!spaces.length && connection === "live" && !error && <p className="p-6 text-center text-sm text-muted-foreground">{t.remote.noSpaces}</p>}
        {tab === "chats" ? (
          <ChatList spaces={spaces} />
        ) : (
          <ul className="grid gap-3">
            {spaces.map((s) => (
              <SpaceCard key={s.id} space={s} />
            ))}
          </ul>
        )}
      </main>
    </Screen>
  );
}

type Last = { pane: string; at?: string; role?: ChatMessage["role"]; text?: string };

/**
 * Every agent as a conversation, the one with the latest message first – like a messenger. Agents
 * without a transcript (not Claude, or not started yet) come last.
 */
function ChatList({ spaces }: { spaces: RemoteSpace[] }) {
  const t = useT();
  const [last, setLast] = useState(new Map<string, Last>());
  const panes = spaces.flatMap((s) => s.agents.map((a) => a.pane)).join(",");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        const r = await api<{ chats: Last[] }>("GET", "/api/chats").catch(() => undefined);
        if (stopped) return;
        if (r) setLast(new Map(r.chats.map((c) => [c.pane, c])));
      }
      if (!stopped) timer = setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // again right away when agents come or go
  }, [panes]);

  const rows = spaces
    .flatMap((space) => space.agents.map((agent) => ({ space, agent, last: last.get(agent.pane) })))
    .sort((a, b) => (b.last?.at ?? "").localeCompare(a.last?.at ?? ""));
  if (!rows.length) return spaces.length ? <p className="p-6 text-center text-sm text-muted-foreground">{t.remote.noChats}</p> : null;
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {rows.map(({ space, agent, last: l }) => {
        const tab = space.tabs.length > 1 ? space.tabs.find((x) => x.id === agent.tab)?.label : undefined;
        return (
          <li key={agent.pane} className={cn(agent.status === "blocked" && "bg-warn-soft/40")}>
            <a href={agentHref(agent.pane)} className="block px-4 py-3 active:bg-accent">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{agent.title || agent.name || agent.kind || agent.pane}</span>
                {l?.at && <Ago iso={l.at} className="shrink-0 text-xs text-muted-foreground" />}
              </span>
              <span className="mt-0.5 flex items-center gap-2">
                <span className={cn("min-w-0 flex-1 truncate text-sm text-muted-foreground", l?.role === "tool" && "italic")}>
                  {l?.text ? `${l.role === "user" ? `${t.remote.you}: ` : ""}${l.text}` : " "}
                </span>
                <StatusPill status={agent.status} />
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">{[space.label, tab].filter(Boolean).join(" · ")}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function SpaceCard({ space }: { space: RemoteSpace }) {
  const t = useT();
  const tabName = (id?: string) => (space.tabs.length > 1 ? space.tabs.find((x) => x.id === id)?.label : undefined);
  return (
    <li className={cn("overflow-hidden rounded-xl border bg-card", space.status === "blocked" && "border-warn/60")}>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="min-w-0 flex-1 truncate font-medium">{space.label}</h2>
        {space.focused && <span className="text-xs text-muted-foreground">{t.remote.focusedOnPc}</span>}
      </div>
      {space.agents.length ? (
        <ul className="divide-y border-t">
          {space.agents.map((a) => (
            <li key={a.pane}>
              <a href={agentHref(a.pane)} className="flex min-h-14 items-center gap-3 px-4 py-2.5 active:bg-accent">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {[tabName(a.tab), a.name ?? a.kind].filter(Boolean).join(" · ") || a.pane}
                  </span>
                  {a.title && <span className="block truncate text-xs text-muted-foreground">{a.title}</span>}
                </span>
                <StatusPill status={a.status} />
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t px-4 py-2.5 text-sm text-muted-foreground">{t.remote.noAgents}</p>
      )}
    </li>
  );
}

function StatusPill({ status }: { status?: AgentStatus }) {
  const t = useT();
  if (!status) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
        status === "blocked" && "bg-warn-soft font-medium text-warn",
        status === "working" && "bg-info-soft text-info",
        status === "done" && "bg-ok-soft text-ok",
        (status === "idle" || status === "unknown") && "bg-secondary text-muted-foreground",
      )}
    >
      {t.herdr.status[status]}
    </span>
  );
}

function ConnectionDot() {
  const t = useT();
  const connection = useRemote((s) => s.connection);
  const label = { connecting: t.client.connecting, live: t.client.live, offline: t.client.offline }[connection];
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn("size-2 shrink-0 rounded-full", connection === "live" ? "bg-ok" : connection === "offline" ? "bg-bad" : "animate-pulse bg-muted-foreground")}
    />
  );
}

function Menu({ onLogout }: { onLogout: () => void }) {
  const t = useT();
  const lang = useLang();
  const setLang = useStore((s) => s.setLang);
  const push = usePush(lang);
  /** the test notification: sent, or why not – shown in the menu, which stays open for it */
  const [tested, setTested] = useState<"sent" | "failed">();
  const pushNote = { unsupported: t.remote.push.unsupported, denied: t.remote.push.denied, off: t.remote.push.off, on: t.remote.push.on }[push.state];
  return (
    <DropdownMenu onOpenChange={() => setTested(undefined)}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t.app.settings}>
          <EllipsisVerticalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LANGS.map((l) => (
          <DropdownMenuCheckboxItem key={l} checked={l === lang} onCheckedChange={() => setLang(l)}>
            {LANG_NAMES[l]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={push.state === "unsupported" || push.state === "denied" || push.busy}
          onSelect={(e) => {
            e.preventDefault();
            void push.toggle();
          }}
        >
          {push.state === "on" ? <BellIcon /> : <BellOffIcon />}
          <span className="flex-1">{t.remote.push.label}</span>
          <span className={cn("text-xs", push.state === "denied" ? "text-warn" : "text-muted-foreground")}>{pushNote}</span>
        </DropdownMenuItem>
        {push.state === "on" && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              push.test().then(
                () => setTested("sent"),
                () => setTested("failed"),
              );
            }}
          >
            <SendIcon />
            <span className="flex-1">{t.remote.push.test}</span>
            {tested === "sent" && <span className="text-xs text-ok">✓</span>}
          </DropdownMenuItem>
        )}
        {tested === "failed" && <p className="max-w-56 px-2 py-1 text-xs text-warn">{t.remote.push.failed}</p>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => api("POST", "/api/logout", {}).then(onLogout, onLogout)}>
          <LogOutIcon /> {t.remote.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- one agent ----------------------------------------------------------------------------

function AgentScreen({ pane }: { pane: string }) {
  const t = useT();
  /** back to the tab it was opened from */
  const { tab } = useRoute();
  const space = useRemote((s) => s.spaces.find((x) => x.agents.some((a) => a.pane === pane)));
  const agent = space?.agents.find((a) => a.pane === pane);
  const connection = useRemote((s) => s.connection);
  const [view, setView] = useState<"chat" | "terminal">("chat");
  const [hasChat, setHasChat] = useState(true);
  const [polledStatus, setPolledStatus] = useState<AgentStatus>();
  const [title, setTitle] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [terminal, setTerminal] = useState("");
  const [pending, setPending] = useState<string>();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string>();
  const since = useRef("");
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // the WebSocket knows first; the poll covers the time before it's there
  const status = agent?.status ?? polledStatus;
  const blocked = status === "blocked";

  // chat (or terminal) every 2 s while open; "since" makes an unchanged transcript cheap
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    since.current = "";
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          if (view === "chat") {
            const r = await api<ChatResponse>("GET", `/api/chat?pane=${encodeURIComponent(pane)}&since=${since.current}`);
            if (stopped) return;
            setPolledStatus(r.status);
            if (!r.found) {
              setHasChat(false);
              setView("terminal");
              return;
            }
            if (!r.unchanged) {
              since.current = String(r.size);
              setTitle(r.title);
              setMessages(r.messages ?? []);
              const lastUser = r.messages?.filter((m) => m.role === "user").at(-1);
              setPending((p) => (p && lastUser?.text === p.trim() ? undefined : p));
            }
          } else {
            const r = await api<{ text: string; status: AgentStatus }>("GET", `/api/read?pane=${encodeURIComponent(pane)}`);
            if (stopped) return;
            setPolledStatus(r.status);
            setTerminal(r.text);
          }
          setMsg(undefined);
        } catch (e) {
          if (!stopped) setMsg(agentError(t.client.agentErrors, e));
        }
      }
      if (!stopped) timer = setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pane, view, t]);

  // follow the conversation while you're at the bottom
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, terminal, pending, blocked]);

  const send = () => {
    const sent = text;
    if (!sent.trim()) return;
    setText("");
    setMsg(undefined);
    api("POST", "/api/prompt", { pane, text: sent }).then(
      () => {
        setPending(sent);
        stick.current = true;
      },
      (e) => {
        setText(sent);
        setMsg(agentError(t.client.agentErrors, e));
      },
    );
  };

  const tabName = space && space.tabs.length > 1 ? space.tabs.find((x) => x.id === agent?.tab)?.label : undefined;
  return (
    <Screen>
      <header className="sticky top-0 z-10 border-b bg-card/90 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <a href={tabHref(tab)} aria-label={t.remote.back}>
              <ChevronLeftIcon className="size-5" />
            </a>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] leading-tight font-semibold">
              {space?.label ?? pane}
              {tabName && <span className="font-normal text-muted-foreground"> › {tabName}</span>}
            </h1>
            {(title ?? agent?.title) && <p className="truncate text-xs text-muted-foreground">{title ?? agent?.title}</p>}
          </div>
          <StatusPill status={status} />
          {connection !== "live" && <ConnectionDot />}
        </div>
        {hasChat && (
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5 text-sm">
            {(["chat", "terminal"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn("rounded-md py-1.5 text-muted-foreground", view === v && "bg-card font-medium text-foreground shadow-xs")}
              >
                {t.herdr.dialog[v]}
              </button>
            ))}
          </div>
        )}
      </header>

      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3"
      >
        {view === "terminal" ? <pre className="font-mono text-[11px] leading-snug whitespace-pre-wrap">{terminal}</pre> : <ChatMessages messages={messages} pending={pending} />}
      </div>

      <footer className="border-t bg-card px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {blocked && <Question pane={pane} showScreen={view === "chat"} onError={setMsg} />}
        {msg && <p className="mb-2 text-sm text-bad">{msg}</p>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <AutoTextarea
            value={text}
            onChange={setText}
            onSubmit={send}
            disabled={blocked}
            placeholder={blocked ? t.remote.blockedSend : t.remote.placeholder}
          />
          <Button type="submit" size="icon" className="size-11 rounded-full" disabled={blocked || !text.trim()} aria-label={t.herdr.dialog.send}>
            <ArrowUpIcon className="size-5" />
          </Button>
        </form>
      </footer>
    </Screen>
  );
}

/**
 * The agent waits at a question or approval: what its screen shows (in the chat view – the terminal
 * view has it anyway, and the transcript gets the question only once it's answered) and keys to
 * answer with: one per choice it offers, and the usual ones. A prompt wouldn't get through now,
 * herdr refuses it.
 */
function Question({ pane, showScreen, onError }: { pane: string; showScreen: boolean; onError: (m: string) => void }) {
  const t = useT();
  const [question, setQuestion] = useState<ReturnType<typeof questionOf>>({ text: "", choices: [1, 2, 3] });
  const [busy, setBusy] = useState(false);
  // read in the terminal view too: the number keys follow the choices on screen
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await api<{ text: string }>("GET", `/api/read?pane=${encodeURIComponent(pane)}`).catch(() => undefined);
      if (stopped) return;
      if (r) setQuestion(questionOf(r.text));
      timer = setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pane]);

  const press = (key: string) => {
    setBusy(true);
    api("POST", "/api/keys", { pane, keys: [key] })
      .catch((e) => onError(agentError(t.client.agentErrors, e)))
      .finally(() => setBusy(false));
  };
  const keyName = (k: string) => t.remote.keyNames[k as keyof typeof t.remote.keyNames] ?? k;
  return (
    <div className="mb-2 rounded-lg border border-warn/50 bg-warn-soft/60 p-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warn">
        <MessageCircleQuestionIcon className="size-3.5" /> {t.remote.question}
      </p>
      {showScreen && question.text && <pre className="mb-2 max-h-[40vh] overflow-y-auto rounded bg-card/80 p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap">{question.text}</pre>}
      <div className="flex flex-wrap gap-1" aria-label={t.remote.answer}>
        {[...question.choices.map(String), ...CONTROL_KEYS].map((k) => (
          <Button key={k} type="button" variant="outline" disabled={busy} className="h-10 min-w-10 flex-1 px-1.5 text-sm" onClick={() => press(k)}>
            {keyName(k)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Grows with its text up to a few lines. On a phone Enter is a new line (the keyboard has no
 * Shift); with a hardware keyboard Ctrl/⌘+Enter sends.
 */
function AutoTextarea({ value, onChange, onSubmit, disabled, placeholder }: { value: string; onChange: (v: string) => void; onSubmit: () => void; disabled?: boolean; placeholder: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      enterKeyHint="enter"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          onSubmit();
        }
      }}
      // 16px: iOS zooms into smaller inputs
      className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-base leading-snug outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60"
    />
  );
}
