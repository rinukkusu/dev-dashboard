import { mdToHtml } from "@shared/markdown.ts";
import type { AgentStatus } from "@shared/model.ts";
import type { ChatMessage } from "@shared/model.ts";
import { LocateFixedIcon, SendHorizontalIcon, WrenchIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { fill, useT } from "@/lib/i18n";
import { api } from "@/lib/store";
import { agentError, useUi, type AgentOpen } from "@/lib/ui";
import { cn } from "@/lib/utils";

type ChatResponse = { found: boolean; unchanged?: boolean; status: AgentStatus; size?: number; title?: string; messages?: ChatMessage[] };

/**
 * An agent as a chat (Claude's transcript) or its raw terminal, with a box to write to it – the text
 * goes into its terminal as if typed in herdr. A panel on the right, so the dashboard stays in view.
 */
export function AgentSheet() {
  const current = useUi((s) => s.agent);
  const setUi = useUi((s) => s.set);
  return (
    <Sheet open={!!current} onOpenChange={(o) => !o && setUi({ agent: undefined })}>
      <SheetContent className="sm:max-w-2xl">{current && <AgentChat key={`${current.pane}|${current.prefill ?? ""}`} open={current} />}</SheetContent>
    </Sheet>
  );
}

function AgentChat({ open }: { open: AgentOpen }) {
  const t = useT();
  const openAgent = useUi((s) => s.openAgent);
  const [pane, setPane] = useState(open.pane);
  const [label, setLabel] = useState(open.label);
  /** a new tab in this space gets the text instead of an agent */
  const [newTabIn, setNewTabIn] = useState<{ id: string; label: string }>();
  const [view, setView] = useState<"chat" | "terminal">("chat");
  const [hasChat, setHasChat] = useState(true);
  const [status, setStatus] = useState<AgentStatus>();
  const [title, setTitle] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [terminal, setTerminal] = useState("");
  const [pending, setPending] = useState<string>();
  const [text, setText] = useState(open.prefill ?? "");
  const [comment, setComment] = useState(open.comment);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | undefined>(open.note ? { text: open.note, bad: true } : undefined);
  const since = useRef("");
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // poll every 2 s while open; "since" makes an unchanged transcript cheap
  useEffect(() => {
    if (newTabIn) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    since.current = "";
    const tick = async () => {
      try {
        if (view === "chat") {
          const r = await api<ChatResponse>("GET", `/api/herdr/chat?pane=${encodeURIComponent(pane)}&since=${since.current}`);
          if (stopped) return;
          setStatus(r.status);
          if (!r.found) {
            // not Claude, or no transcript: the terminal is all there is
            setHasChat(false);
            setView("terminal");
            return;
          }
          setHasChat(true);
          if (!r.unchanged) {
            since.current = String(r.size);
            setTitle(r.title);
            setMessages(r.messages ?? []);
            const lastUser = r.messages?.filter((m) => m.role === "user").at(-1);
            setPending((p) => (p && lastUser?.text === p.trim() ? undefined : p));
          }
        } else {
          const r = await api<{ text: string; status: AgentStatus }>("GET", `/api/herdr/read?pane=${encodeURIComponent(pane)}`);
          if (stopped) return;
          setStatus(r.status);
          setTerminal(r.text);
        }
      } catch (e) {
        if (!stopped) setMsg({ text: agentError(t.client.agentErrors, e), bad: true });
      }
      if (!stopped) timer = setTimeout(tick, 2000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pane, view, newTabIn, t]);

  // follow the conversation while you're at the bottom
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, terminal, pending]);

  const send = () => {
    if (!text.trim()) return;
    setMsg(undefined);
    if (newTabIn && open.choice) {
      const space = newTabIn;
      setMsg({ text: t.herdr.start.starting });
      api<{ pane: string; sent: boolean }>("POST", "/api/herdr/start", { kind: open.choice.kind, id: open.choice.id, label: t.herdr.start.tabLabel, prompt: text, space: space.id }).then(
        (r) =>
          openAgent(
            r.sent
              ? { pane: r.pane, label: space.label }
              : { pane: r.pane, label: space.label, prefill: text, comment: open.choice!.kind === "comment" ? open.choice!.id : undefined, note: t.herdr.start.needsAnswer },
          ),
        (err) => setMsg({ text: agentError(t.client.agentErrors, err), bad: true }),
      );
      return;
    }
    const sent = text;
    setText("");
    api("POST", "/api/herdr/prompt", { pane, text: sent, comment }).then(
      () => {
        setPending(sent);
        setComment(undefined);
        stick.current = true;
      },
      (err) => {
        setText(sent);
        setMsg({ text: agentError(t.client.agentErrors, err), bad: true });
      },
    );
  };

  const choice = open.choice && (open.choice.candidates.length > 1 || open.choice.spaces.length) ? open.choice : undefined;

  return (
    <>
      <div className="border-b px-5 pt-4 pb-3">
        <SheetTitle className="pr-8">
          {label}
          {title && <span className="font-normal text-muted-foreground"> · {title}</span>}
        </SheetTitle>
        <SheetDescription className="sr-only">{t.herdr.dialog.chat}</SheetDescription>
        {choice && (
          <label className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            {t.herdr.start.target}
            <Select
              className="flex-1"
              defaultValue={`pane:${pane}`}
              onChange={(e) => {
                const v = e.target.value;
                if (v.startsWith("pane:")) {
                  const a = choice.candidates.find((c) => `pane:${c.pane}` === v)!;
                  setNewTabIn(undefined);
                  setPane(a.pane);
                  setLabel(a.label);
                  setMessages([]);
                  setTerminal("");
                  setMsg(undefined);
                } else {
                  const s = choice.spaces.find((x) => `space:${x.id}` === v)!;
                  setNewTabIn(s);
                  setLabel(s.label);
                  setMessages([]);
                  setTerminal("");
                  setStatus(undefined);
                  setMsg({ text: t.herdr.start.newTabNote });
                }
              }}
            >
              {choice.candidates.map((a) => (
                <option key={a.pane} value={`pane:${a.pane}`}>
                  {a.label}
                  {a.tab ? ` › ${a.tab}` : ""}
                  {a.title ? ` — ${a.title}` : ""} · {t.herdr.status[a.status] ?? a.status}
                </option>
              ))}
              {choice.spaces.map((s) => (
                <option key={s.id} value={`space:${s.id}`}>
                  {t.herdr.start.newTab.replace("{space}", s.label)}
                </option>
              ))}
            </Select>
          </label>
        )}
        <div className="mt-3 flex items-center gap-1">
          {hasChat && (
            <Button variant={view === "chat" ? "secondary" : "ghost"} size="sm" onClick={() => setView("chat")}>
              {t.herdr.dialog.chat}
            </Button>
          )}
          <Button variant={view === "terminal" ? "secondary" : "ghost"} size="sm" onClick={() => setView("terminal")}>
            {t.herdr.dialog.terminal}
          </Button>
          {status && (
            <span
              className={cn(
                "ml-2 rounded px-1.5 text-xs",
                status === "blocked" && "bg-warn-soft text-warn",
                status === "working" && "bg-info-soft text-info",
                status === "done" && "bg-ok-soft text-ok",
                (status === "idle" || status === "unknown") && "bg-secondary text-muted-foreground",
              )}
            >
              {t.herdr.status[status]}
            </span>
          )}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => api("POST", "/api/herdr/focus", { pane }).catch((e) => setMsg({ text: agentError(t.client.agentErrors, e), bad: true }))}>
            <LocateFixedIcon /> {t.herdr.focus}
          </Button>
        </div>
      </div>

      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4"
      >
        {view === "terminal" ? (
          <pre className="font-mono text-xs leading-snug whitespace-pre-wrap">{terminal}</pre>
        ) : (
          <div className="flex flex-col gap-3">
            {groupTools(messages).map((m) =>
              Array.isArray(m) ? (
                <ToolRun key={m[0]!.id} steps={m} />
              ) : m.role === "assistant" ? (
                <div key={m.id} className="rich max-w-[90%] min-w-0 self-start overflow-x-auto rounded-lg bg-muted/60 px-3 py-2" dangerouslySetInnerHTML={{ __html: mdToHtml(m.text, t.threads.suggested) }} />
              ) : (
                <div key={m.id} className="max-w-[85%] self-end rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
                  {m.text}
                </div>
              ),
            )}
            {pending && <div className="max-w-[85%] self-end rounded-lg bg-primary/60 px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">{pending}</div>}
          </div>
        )}
      </div>

      <div className="border-t px-5 py-3">
        {status === "blocked" && <p className="mb-2 text-sm text-warn">{t.herdr.dialog.blockedNote}</p>}
        {msg && <p className={cn("mb-2 text-sm", msg.bad ? "text-bad" : "text-muted-foreground")}>{msg.text}</p>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <Textarea
            autoFocus
            rows={open.prefill ? 7 : 2}
            placeholder={t.herdr.dialog.placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // like a chat: Enter sends, Shift+Enter is a new line
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            onFocus={(e) => e.currentTarget.setSelectionRange(0, 0)}
          />
          <Button type="submit" size="icon" aria-label={t.herdr.dialog.send} title={t.herdr.dialog.send}>
            <SendHorizontalIcon />
          </Button>
        </form>
      </div>
    </>
  );
}

/** A run of tool calls becomes one line you can open: "5 steps · last one". */
function groupTools(messages: ChatMessage[]): (ChatMessage | ChatMessage[])[] {
  const out: (ChatMessage | ChatMessage[])[] = [];
  for (const m of messages) {
    const last = out.at(-1);
    if (m.role === "tool" && Array.isArray(last)) last.push(m);
    else out.push(m.role === "tool" ? [m] : m);
  }
  return out;
}

function ToolRun({ steps }: { steps: ChatMessage[] }) {
  const t = useT();
  const summary = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <WrenchIcon className="size-3 shrink-0" />
      <span className="truncate">{steps.length === 1 ? steps[0]!.text : `${fill(t.herdr.dialog.toolSteps, steps.length)} · ${steps.at(-1)!.text}`}</span>
    </span>
  );
  if (steps.length === 1) return <div className="flex min-w-0 text-xs text-muted-foreground">{summary}</div>;
  return (
    <details className="min-w-0 text-xs text-muted-foreground">
      <summary className="flex min-w-0 cursor-pointer list-none">{summary}</summary>
      <ul className="mt-1 space-y-0.5 pl-5">
        {steps.map((s) => (
          <li key={s.id} className="truncate">
            {s.text}
          </li>
        ))}
      </ul>
    </details>
  );
}
