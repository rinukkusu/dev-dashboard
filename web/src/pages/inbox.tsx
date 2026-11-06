import { hintText } from "@shared/i18n.ts";
import type { HintLevel } from "@shared/model.ts";
import { InboxIcon } from "lucide-react";
import { REASON_ICON, SEVERE } from "@/components/reason";
import { SourceIcon } from "@/components/source-icon";
import { Badge } from "@/components/ui/badge";
import { Tip } from "@/components/ui/tooltip";
import type { InboxItem } from "@/lib/derive";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LEVELS: HintLevel[] = ["action", "ready", "info"];

export function Inbox({ items }: { items: InboxItem[] }) {
  const t = useT();
  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
        <InboxIcon className="size-10 opacity-40" />
        <p>{t.app.inboxEmpty}</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {LEVELS.map((level) => {
        const group = items.filter((i) => i.level === level);
        if (!group.length) return null;
        return (
          <section key={level}>
            <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t.app.levels[level]} <span className="tabular-nums opacity-70">{group.length}</span>
            </h2>
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {group.map((item) => (
                <InboxRow key={item.resource} item={item} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function InboxRow({ item }: { item: InboxItem }) {
  const t = useT();
  const meta = item.pr ? `${item.pr.repo} · ${item.pr.branch} → ${item.pr.targetBranch}` : item.issue ? `${item.issue.type} · ${item.issue.status}` : item.run?.repo;
  return (
    <li
      className={cn(
        "group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40",
        "before:absolute before:inset-y-0 before:left-0 before:w-0.5",
        item.level === "action" && "before:bg-warn",
        item.level === "ready" && "before:bg-ok",
        item.level === "info" && "before:bg-info",
      )}
    >
      <SourceIcon resource={item.resource} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <a href={item.url} target="_blank" rel="noopener" className="flex min-w-0 items-baseline gap-2 hover:text-primary">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.ref}</span>
          <span className="truncate font-medium">{item.title ?? hintText(t, item.hints[0]!.msg)}</span>
        </a>
        {meta && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {item.hints.map((h, i) => {
          const Icon = REASON_ICON[h.reason];
          return (
            <Tip key={i} content={hintText(t, h.msg)}>
              <Badge variant={h.level === "ready" ? "ok" : h.level === "info" ? "info" : SEVERE.has(h.reason) ? "bad" : "warn"} tabIndex={0}>
                <Icon />
                {t.reasons[h.reason]}
              </Badge>
            </Tip>
          );
        })}
      </div>
    </li>
  );
}
