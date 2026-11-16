// My own to-dos (or notes) at the top of the inbox: not tied to a PR or ticket, kept in prefs.json.
import type { Todo } from "@shared/model.ts";
import { ChevronRightIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Section } from "@/components/section";
import { Ago } from "@/components/time";
import { Input } from "@/components/ui/input";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Something that looks like a Jira key or a PR ref (!44, app#12) – linked when the dashboard knows it. */
const REF = /(?<![\w-])([A-Z][A-Z0-9]+-\d+|[\w.-]*[!#]\d+)(?![\w-])/g;

/** The text with the tickets/PRs it mentions as links. */
export function Linked({ text }: { text: string }) {
  const { prs, issues } = useData();
  const known = new Map<string, string>();
  for (const i of issues.values()) known.set(i.ref, i.url);
  for (const p of prs.values()) known.set(p.ref, p.url);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(REF)) {
    const url = known.get(m[1]!);
    if (!url) continue;
    parts.push(text.slice(at, m.index));
    parts.push(
      <a key={m.index} href={url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="font-mono text-primary hover:underline">
        {m[1]}
      </a>,
    );
    at = m.index + m[0].length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

export function Todos() {
  const t = useT();
  const { view } = useData();
  const todos = view.todos ?? [];
  const open = todos.filter((x) => !x.doneAt);
  // most recently checked off first
  const done = todos.filter((x) => x.doneAt).sort((a, b) => Date.parse(b.doneAt!) - Date.parse(a.doneAt!));
  const [showDone, setShowDone] = useState(false);
  const add = async (form: HTMLFormElement) => {
    const text = String(new FormData(form).get("text") ?? "");
    if (!text.trim()) return;
    try {
      await api("POST", "/api/todos", { text });
      form.reset();
    } catch {
      // keep what was typed
    }
  };
  return (
    <Section id="todos" title={t.todos.title} count={open.length} alwaysShow>
      <div className="overflow-hidden rounded-lg border bg-card">
        <form
          className="border-b p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add(e.currentTarget);
          }}
        >
          <Input name="text" maxLength={2000} placeholder={t.todos.placeholder} aria-label={t.todos.placeholder} className="border-transparent shadow-none" />
        </form>
        {open.length > 0 && (
          <ul className="divide-y">
            {open.map((x) => (
              <TodoRow key={x.id} todo={x} />
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <div className={cn(open.length > 0 && "border-t")}>
            <button type="button" aria-expanded={showDone} onClick={() => setShowDone(!showDone)} className="flex w-full items-center gap-1.5 px-4 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRightIcon className={cn("size-3.5 transition-transform", showDone && "rotate-90")} />
              {t.todos.done(done.length)}
            </button>
            {showDone && (
              <ul className="divide-y border-t">
                {done.map((x) => (
                  <TodoRow key={x.id} todo={x} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function TodoRow({ todo }: { todo: Todo }) {
  const t = useT();
  const [editing, setEditing] = useState<string>();
  const done = !!todo.doneAt;
  const patch = (body: { text?: string; done?: boolean }) => api("PATCH", "/api/todos", { id: todo.id, ...body }).catch(() => {});
  const save = async () => {
    if (editing !== undefined && editing.trim() !== todo.text) await patch({ text: editing });
    setEditing(undefined);
  };
  return (
    <li className="group flex items-start gap-3 px-4 py-2 text-sm">
      <input
        type="checkbox"
        checked={done}
        aria-label={done ? t.todos.reopen : t.todos.check}
        onChange={() => void patch({ done: !done })}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
      />
      {editing !== undefined ? (
        <Input
          autoFocus
          value={editing}
          maxLength={2000}
          aria-label={t.todos.edit}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(undefined);
          }}
          className="-my-1 h-7 flex-1"
        />
      ) : (
        <button
          type="button"
          title={t.todos.edit}
          onClick={() => setEditing(todo.text)}
          className={cn("min-w-0 flex-1 cursor-text text-left break-words whitespace-pre-line", done && "text-muted-foreground line-through")}
        >
          <Linked text={todo.text} />
        </button>
      )}
      <Ago iso={todo.doneAt ?? todo.createdAt} className="shrink-0 text-xs text-muted-foreground" />
      <button
        type="button"
        aria-label={t.todos.remove}
        title={t.todos.remove}
        onClick={() => void api("DELETE", `/api/todos?id=${encodeURIComponent(todo.id)}`).catch(() => {})}
        className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 pointer-coarse:opacity-60"
      >
        <XIcon className="size-3.5" />
      </button>
    </li>
  );
}
