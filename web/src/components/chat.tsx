import { ATTACHED, fileName, IMAGE, messageFiles } from "@shared/files.ts";
import { mdToHtml } from "@shared/markdown.ts";
import type { ChatMessage } from "@shared/model.ts";
import { ArchiveIcon, ChevronRightIcon, FileIcon, WrenchIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { ImageViewer } from "@/components/image-viewer";
import { fill, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Files in the chat: where one opens, and the folders whose files may be shown (null = any). */
export type ChatFiles = { href: (path: string) => string; roots: string[] | null };

/**
 * An agent's conversation from Claude's transcript: my prompts on the right, its answers on the
 * left, runs of tool calls as one line. Used by the dashboard's agent panel and the remote control.
 * With files: what I sent and the files the agent names below the message, pictures as pictures.
 */
export function ChatMessages({ messages, pending, files }: { messages: ChatMessage[]; pending?: string; files?: ChatFiles }) {
  return (
    <div className="flex flex-col gap-3">
      {groupTools(messages).map((m) =>
        Array.isArray(m) ? (
          <ToolRun key={m[0]!.id} steps={m} />
        ) : m.role === "summary" ? (
          <Summary key={m.id} text={m.text} />
        ) : (
          <Message key={m.id} role={m.role} text={m.text} files={files} />
        ),
      )}
      {pending && <Message role="user" text={pending} files={files} pending />}
    </div>
  );
}

function Message({ role, text, files, pending }: { role: ChatMessage["role"]; text: string; files?: ChatFiles; pending?: boolean }) {
  const t = useT();
  const shown = files ? messageFiles(text, files.roots) : { text, files: [] };
  const mine = role === "user";
  return (
    <div className={cn("flex max-w-[90%] min-w-0 flex-col gap-1", mine ? "items-end self-end" : "items-start self-start")}>
      {shown.text &&
        (mine ? (
          <div className={cn("max-w-full rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground", pending ? "bg-primary/60" : "bg-primary")}>{shown.text}</div>
        ) : (
          <div className="rich max-w-full min-w-0 overflow-x-auto rounded-lg bg-muted/60 px-3 py-2" dangerouslySetInnerHTML={{ __html: mdToHtml(shown.text, t.threads.suggested) }} />
        ))}
      {files && shown.files.length > 0 && (
        <div className={cn("flex flex-wrap gap-1.5", mine && "justify-end", pending && "opacity-60")}>
          {shown.files.map((p) => (
            <Attachment key={p} path={p} href={files.href(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A picture as a picture (full screen to zoom a tap away), anything else – or a picture that won't load – as its name. */
function Attachment({ path, href }: { path: string; href: string }) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const name = fileName(path);
  if (IMAGE.test(path) && !broken) {
    return (
      <>
        <button type="button" title={name} onClick={() => setOpen(true)} className="block overflow-hidden rounded-lg border bg-muted">
          <img src={href} alt={name} loading="lazy" onError={() => setBroken(true)} className="max-h-48 max-w-[16rem] object-contain" />
        </button>
        {open && <ImageViewer src={href} name={name} href={href} onClose={close} />}
      </>
    );
  }
  return (
    // in this window: a new one is a window of its own in the installed app, and back would close it all
    <a href={href} title={path} className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs hover:bg-accent">
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </a>
  );
}

/** the message the agent gets: what I wrote, then a line per file I sent */
export const withFiles = (text: string, paths: string[]) => [text.trim(), paths.map((p) => ATTACHED + p).join("\n")].filter(Boolean).join("\n\n");

/**
 * Claude Code compacted the conversation: a notice across the chat, not a message from me –
 * the summary it wrote behind it, opened on demand.
 */
function Summary({ text }: { text: string }) {
  const t = useT();
  return (
    <details className="group min-w-0 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 select-none">
        <span className="h-px flex-1 bg-border" />
        <span className="inline-flex items-center gap-1.5">
          <ArchiveIcon className="size-3 shrink-0" />
          {t.herdr.dialog.compacted}
          <ChevronRightIcon className="size-3 shrink-0 transition-transform group-open:rotate-90" />
        </span>
        <span className="h-px flex-1 bg-border" />
      </summary>
      {text && <div className="rich mt-2 min-w-0 overflow-x-auto rounded-lg border border-dashed px-3 py-2 text-foreground/80" dangerouslySetInnerHTML={{ __html: mdToHtml(text, t.threads.suggested) }} />}
    </details>
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
