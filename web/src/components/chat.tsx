import { mdToHtml } from "@shared/markdown.ts";
import type { ChatMessage } from "@shared/model.ts";
import { WrenchIcon } from "lucide-react";
import { fill, useT } from "@/lib/i18n";

/**
 * An agent's conversation from Claude's transcript: my prompts on the right, its answers on the
 * left, runs of tool calls as one line. Used by the dashboard's agent panel and the remote control.
 */
export function ChatMessages({ messages, pending }: { messages: ChatMessage[]; pending?: string }) {
  const t = useT();
  return (
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
