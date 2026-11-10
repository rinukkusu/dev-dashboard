import { mdToHtml } from "@shared/markdown.ts";
import type { DiffLine, Suggestion, Thread } from "@shared/model.ts";
import { FileCodeIcon, MessageSquareIcon, SparklesIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/utils";

type ThreadsResponse = {
  pr: { id: string; ref: string; title: string; url: string };
  kind: "pr" | "issue";
  canReply: boolean;
  canResolve: boolean;
  threads: Thread[];
  job?: { id: string; suggestions: Suggestion[] };
};

/**
 * A PR's open threads (or a ticket's comments as one thread), each with a box to answer – prefilled
 * with what the agent proposed, if it did. Nothing is posted without a click.
 */
export function ThreadsDialog() {
  const t = useT();
  const id = useUi((s) => s.threads);
  const setUi = useUi((s) => s.set);
  const [data, setData] = useState<ThreadsResponse>();
  const [error, setError] = useState(false);
  // something typed that a reload would throw away
  const dirty = useRef(new Set<string>());

  const load = (after = false) =>
    api<ThreadsResponse>("GET", `/api/threads?pr=${encodeURIComponent(id!)}${after ? "&wait=1" : ""}`).then(
      (r) => {
        if (after && dirty.current.size) return;
        setData(r);
      },
      () => !after && setError(true),
    );

  useEffect(() => {
    setData(undefined);
    setError(false);
    dirty.current.clear();
    if (id) void load();
  }, [id]);

  // the ones with a proposal first
  const pending = (th: Thread) => (data?.job?.suggestions.some((s) => s.thread === th.id && !s.sent) ? 0 : 1);
  const threads = data ? [...data.threads].sort((a, b) => pending(a) - pending(b)) : [];
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && setUi({ threads: undefined })}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {data ? (
              <a href={data.pr.url} target="_blank" rel="noopener" className="hover:text-primary">
                <span className="mr-2 font-mono text-sm text-muted-foreground">{data.pr.ref}</span>
                {data.pr.title}
              </a>
            ) : (
              t.threads.loading
            )}
          </DialogTitle>
          <DialogDescription>{error ? t.threads.failed : data && (!data.threads.length ? t.threads.none : data.canReply ? "" : t.threads.readOnly)}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {data &&
            threads.map((th) => (
              <ThreadView
                key={th.id}
                data={data}
                thread={th}
                onDirty={(d) => (d ? dirty.current.add(th.id) : dirty.current.delete(th.id))}
                onSent={() => void load(true)}
              />
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThreadView({ data, thread: th, onDirty, onSent }: { data: ThreadsResponse; thread: Thread; onDirty: (dirty: boolean) => void; onSent: () => void }) {
  const t = useT();
  const full = new Intl.DateTimeFormat(t.locale, { dateStyle: "short", timeStyle: "short" });
  const suggestion = data.job?.suggestions.find((s) => s.thread === th.id);
  const [text, setText] = useState(suggestion && !suggestion.sent ? suggestion.reply : "");
  const [resolve, setResolve] = useState(!!suggestion?.resolve);
  const [state, setState] = useState<{ busy?: boolean; msg?: string; bad?: boolean; resolved?: boolean; mine: { text: string; at: number }[] }>({ mine: [] });
  const original = suggestion && !suggestion.sent ? suggestion.reply : "";

  const send = () => {
    if (!text.trim()) return;
    setState((s) => ({ ...s, busy: true, msg: t.threads.sending, bad: false }));
    api("POST", "/api/threads/reply", { pr: data.pr.id, thread: th.id, text, resolve, job: data.job?.id }).then(
      () => {
        // right away: the reply in the thread, the box empty; then the thread as the source has it
        setState((s) => ({ mine: [...s.mine, { text: text.trim(), at: Date.now() }], msg: resolve ? t.threads.resolved : t.threads.sent, resolved: resolve }));
        setText("");
        onDirty(false);
        onSent();
      },
      (err: { detail?: string }) => setState((s) => ({ ...s, busy: false, bad: true, msg: t.threads.failed + (err?.detail ? `: ${err.detail}` : "") })),
    );
  };

  return (
    <section className={cn("rounded-lg border", state.resolved && "opacity-60")}>
      {data.kind !== "issue" && (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 font-mono text-xs text-muted-foreground">
          {th.file ? <FileCodeIcon className="size-3.5" /> : <MessageSquareIcon className="size-3.5" />}
          {th.file ? `${th.file}${th.line ? `:${th.line}${th.endLine && th.endLine !== th.line ? `–${th.endLine}` : ""}` : ""}` : t.threads.general}
        </div>
      )}
      {th.file && th.line && <DiffSnippet pr={data.pr.id} thread={th.id} />}
      <div className="divide-y">
        {th.comments.map((c) => (
          <div key={c.id} className={cn("px-3 py-2", c.authorIsMe && "bg-info-soft/30")}>
            <div className="mb-1 text-xs text-muted-foreground">
              <b className="text-foreground">{c.authorIsMe ? `${c.author} (${t.threads.me})` : c.author}</b> · {full.format(new Date(c.at))}
            </div>
            {/* formatted and escaped by the server (Jira) or by mdToHtml */}
            <div className="rich" dangerouslySetInnerHTML={{ __html: c.html ?? mdToHtml(c.body, t.threads.suggested) }} />
          </div>
        ))}
        {state.mine.map((m, i) => (
          <div key={i} className="bg-info-soft/30 px-3 py-2">
            <div className="mb-1 text-xs text-muted-foreground">
              <b className="text-foreground">{t.threads.me}</b> · {full.format(new Date(m.at))}
            </div>
            <p className="text-sm whitespace-pre-wrap">{m.text}</p>
          </div>
        ))}
      </div>
      {data.canReply && !state.resolved && !(suggestion?.sent && !state.mine.length) && (
        <div className="grid gap-2 border-t p-3">
          {suggestion && !suggestion.sent && !state.mine.length && (
            <p className="flex items-center gap-1 text-xs text-primary">
              <SparklesIcon className="size-3.5" /> {t.threads.suggestion}
            </p>
          )}
          <Textarea
            rows={text ? Math.min(10, Math.max(3, text.split("\n").length + 1)) : 2}
            placeholder={t.threads.placeholder}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onDirty(e.target.value !== original);
            }}
          />
          <div className="flex items-center gap-3">
            {data.canResolve && (
              <label className="flex shrink-0 items-center gap-1.5 text-sm">
                <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} className="accent-primary" />
                {t.threads.resolve}
              </label>
            )}
            <span className="flex-1" />
            <Button size="sm" onClick={send} disabled={state.busy || !text.trim()}>
              {t.threads.send}
            </Button>
          </div>
          {/* errors carry the source's message with its URL: wrap anywhere */}
          {state.msg && <p className={cn("text-sm [overflow-wrap:anywhere]", state.bad ? "text-bad" : "text-ok")}>{state.msg}</p>}
        </div>
      )}
      {(state.resolved || (suggestion?.sent && !state.mine.length)) && <p className="border-t px-3 py-2 text-sm text-ok">{state.resolved ? t.threads.resolved : t.threads.sent}</p>}
    </section>
  );
}

/** The commented lines with a little context, loaded once the thread is shown. */
function DiffSnippet({ pr, thread }: { pr: string; thread: string }) {
  const t = useT();
  const [lines, setLines] = useState<DiffLine[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<{ lines: DiffLine[] }>("GET", `/api/threads/diff?pr=${encodeURIComponent(pr)}&thread=${encodeURIComponent(thread)}`).then(
      (d) => setLines(d.lines),
      () => setFailed(true),
    );
  }, [pr, thread]);
  if (failed) return <p className="border-b px-3 py-1.5 text-xs text-muted-foreground">{t.threads.noDiff}</p>;
  if (!lines?.length) return null;
  return (
    <div className="overflow-x-auto border-b">
      <table className="w-full border-collapse font-mono text-xs leading-relaxed">
        <tbody>
          {lines.map((l, i) =>
            l.kind === "gap" ? (
              <tr key={i}>
                <td colSpan={3} className="bg-muted/40 text-center text-muted-foreground">
                  ⋯
                </td>
              </tr>
            ) : (
              <tr key={i} className={cn(l.kind === "add" && "d-add", l.kind === "del" && "d-del", l.hit && "shadow-[inset_3px_0_0_var(--warn)]")}>
                <td className="w-px px-2 text-right text-muted-foreground select-none">{l.old ?? ""}</td>
                <td className="w-px px-2 text-right text-muted-foreground select-none">{l.new ?? ""}</td>
                <td className="px-2 whitespace-pre">
                  {l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}
                  {l.text}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
