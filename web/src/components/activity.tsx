import { changeText } from "@shared/i18n.ts";
import type { Change } from "@shared/model.ts";
import { CheckCheckIcon } from "lucide-react";
import { CommentPop, MuteButton, SendButton } from "@/components/bits";
import { SourceIcon } from "@/components/source-icon";
import { Ago } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { isUnseen, sameThing, useSeen } from "@/lib/seen";
import { cn } from "@/lib/utils";

/**
 * What other people did since the last poll – votes, comments, status changes, merges, finished runs.
 * New entries carry a blue dot: clicking it marks that one seen, opening the link marks everything
 * new about the same PR/issue/run.
 */
export function Activity({ className }: { className?: string }) {
  const t = useT();
  const { view, muted } = useData();
  const seen = useSeen();
  const unseen = view.changes.filter((c) => isUnseen(c, seen, muted));
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 px-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t.sections.changes}</h2>
        {unseen.length > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">{unseen.length}</span>}
        <span className="flex-1" />
        {unseen.length > 0 && (
          <Button variant="ghost" size="sm" onClick={seen.markAll}>
            <CheckCheckIcon /> {t.seenAll}
          </Button>
        )}
      </div>
      {view.changes.length ? (
        <ul className="min-h-0 flex-1 space-y-px overflow-y-auto pr-1">
          {view.changes.map((c) => (
            <ChangeRow key={c.id} change={c} unseen={isUnseen(c, seen, muted)} />
          ))}
        </ul>
      ) : (
        <p className="px-1 text-sm text-muted-foreground">{t.empty.changes}</p>
      )}
    </div>
  );
}

function ChangeRow({ change: c, unseen }: { change: Change; unseen: boolean }) {
  const t = useT();
  const { view, muted, comments } = useData();
  const mark = useSeen((s) => s.mark);
  const { title, detail } = changeText(c, t);
  const isMuted = !!c.resource && muted.has(c.resource);
  const found = c.kind === "issue-comment" ? comments.get(c.id) : undefined;
  const openIt = () => {
    const ids = view.changes.filter((x) => sameThing(x) === sameThing(c)).map((x) => x.id);
    mark(ids);
  };
  return (
    <li className={cn("group relative rounded-md px-2 py-2 hover:bg-accent/50", unseen && "bg-info-soft/60", isMuted && "opacity-50")}>
      <div className="flex items-start gap-2">
        <Tip content={unseen ? t.markSeen : undefined}>
          <button
            type="button"
            aria-label={t.markSeen}
            disabled={!unseen}
            onClick={() => mark([c.id])}
            className={cn("mt-1.5 size-2 shrink-0 rounded-full", unseen ? "cursor-pointer bg-primary" : "bg-transparent")}
          />
        </Tip>
        <SourceIcon resource={c.resource ?? c.ref} className="mt-0.5 size-3.5" />
        <div className="min-w-0 flex-1">
          <a href={c.url} target="_blank" rel="noopener" onClick={openIt} onAuxClick={openIt} className="block text-sm leading-snug hover:text-primary">
            <span className="mr-1.5 font-mono text-xs text-muted-foreground">{c.ref}</span>
            {title}
          </a>
          {detail &&
            (found ? (
              <CommentPop comment={found.comment} issue={found.issue}>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
              </CommentPop>
            ) : (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{detail}</p>
            ))}
        </div>
        <div className="flex shrink-0 items-center">
          <Ago iso={c.at} className="text-xs text-muted-foreground" />
          {(c.kind === "pr-comment" || c.kind === "issue-comment") && <SendButton changeId={c.id} />}
          {c.resource && <MuteButton id={c.resource} />}
        </div>
      </div>
    </li>
  );
}
