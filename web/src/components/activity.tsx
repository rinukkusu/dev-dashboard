import { changeText } from "@shared/i18n.ts";
import type { Change } from "@shared/model.ts";
import { CheckCheckIcon, CirclePlayIcon } from "lucide-react";
import { useState } from "react";
import { create } from "zustand";
import { CommentPop, MuteButton, SendButton } from "@/components/bits";
import { SourceIcon } from "@/components/source-icon";
import { Ago } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useData } from "@/lib/data";
import { type ChangeGroup, groupChanges } from "@/lib/derive";
import { useT } from "@/lib/i18n";
import { isUnseen, sameThing, useSeen } from "@/lib/seen";
import { KEYS, storage } from "@/lib/storage";
import { cn } from "@/lib/utils";

/** The feed's filters, remembered per browser. */
type Filter = { only: "all" | "unseen"; runs: boolean };
const useFilter = create<Filter & { set(p: Partial<Filter>): void }>((set, get) => ({
  only: "all",
  runs: true,
  ...storage.json<Partial<Filter>>(KEYS.feed, {}),
  set(p) {
    set(p);
    const { only, runs } = get();
    storage.set(KEYS.feed, JSON.stringify({ only, runs }));
  },
}));

/**
 * What other people did since the last poll – votes, comments, status changes, merges, finished runs –
 * one entry per PR/ticket/pipeline, older changes folded in. New entries carry a blue dot: clicking it
 * marks that entry seen, opening the link marks everything new about the same thing.
 */
export function Activity({ className }: { className?: string }) {
  const t = useT();
  const { view, muted } = useData();
  const seen = useSeen();
  const filter = useFilter();
  const unseen = view.changes.filter((c) => isUnseen(c, seen, muted));
  const shown = view.changes.filter((c) => filter.runs || c.kind !== "run-finished");
  const groups = groupChanges(shown).filter((g) => filter.only === "all" || g.changes.some((c) => isUnseen(c, seen, muted)));
  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-10 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t.sections.changes}</h2>
        {unseen.length > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">{unseen.length}</span>}
        <span className="flex-1" />
        {unseen.length > 0 && (
          <Tip content={t.seenAll}>
            <Button variant="ghost" size="icon-sm" aria-label={t.seenAll} onClick={seen.markAll}>
              <CheckCheckIcon />
            </Button>
          </Tip>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 pr-2 pb-2 pl-4" role="toolbar">
        <div className="flex rounded-md border p-0.5 text-xs">
          {(["all", "unseen"] as const).map((only) => (
            <button
              key={only}
              type="button"
              aria-pressed={filter.only === only}
              onClick={() => filter.set({ only })}
              className={cn("rounded px-2 py-0.5 text-muted-foreground hover:text-foreground", filter.only === only && "bg-accent font-medium text-foreground")}
            >
              {only === "all" ? t.app.feed.all : t.app.feed.unseen}
            </button>
          ))}
        </div>
        <Tip content={filter.runs ? t.app.feed.hideRuns : t.app.feed.runs}>
          <button
            type="button"
            aria-pressed={filter.runs}
            aria-label={t.app.feed.runs}
            onClick={() => filter.set({ runs: !filter.runs })}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-[3px] text-xs text-muted-foreground hover:text-foreground",
              filter.runs ? "bg-accent text-foreground" : "line-through opacity-70",
            )}
          >
            <CirclePlayIcon className="size-3" /> {t.sections.runs}
          </button>
        </Tip>
      </div>
      {groups.length ? (
        <ul className="min-h-0 flex-1 space-y-px overflow-y-auto pb-2 pl-2 [scrollbar-width:thin]">
          {groups.map((g) => (
            <GroupRow key={g.key} group={g} />
          ))}
        </ul>
      ) : (
        <p className="px-4 text-sm text-muted-foreground">{view.changes.length ? t.app.feed.noneUnseen : t.empty.changes}</p>
      )}
    </div>
  );
}

const CONCLUSION_DOT: Record<string, string> = { success: "bg-ok", failure: "bg-bad", cancelled: "bg-muted-foreground", neutral: "bg-muted-foreground/60" };

/** The newest change of a PR/ticket/pipeline, and the older ones behind "+n more". */
function GroupRow({ group }: { group: ChangeGroup }) {
  const t = useT();
  const { muted } = useData();
  const seen = useSeen();
  const [open, setOpen] = useState(false);
  const [head, ...rest] = group.changes as [Change, ...Change[]];
  const unseen = group.changes.filter((c) => isUnseen(c, seen, muted));
  const runs = head.kind === "run-finished" && group.changes.length > 1;
  return (
    <li className={cn("rounded-l-md", unseen.length > 0 && "bg-info-soft/60")}>
      <ChangeRow change={head} unseen={unseen.length > 0} markIds={unseen.map((c) => c.id)} />
      {rest.length > 0 && (
        <div className="flex items-center gap-2 pr-2 pb-1.5 pl-[2.375rem]">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-xs text-muted-foreground hover:text-foreground">
            {open ? t.app.feed.less : t.app.feed.more(rest.length)}
          </button>
          {/* a pipeline's history at a glance, newest left */}
          {runs && !open && (
            <span className="flex items-center gap-0.5" aria-hidden>
              {group.changes.slice(0, 12).map((c) => (
                <span key={c.id} className={cn("size-1.5 rounded-full", CONCLUSION_DOT[c.conclusion ?? "neutral"])} />
              ))}
            </span>
          )}
        </div>
      )}
      {open && (
        <ul className="ml-6 border-l pb-1">
          {rest.map((c) => (
            <ChangeRow key={c.id} change={c} unseen={isUnseen(c, seen, muted)} markIds={[c.id]} compact />
          ))}
        </ul>
      )}
    </li>
  );
}

function ChangeRow({ change: c, unseen, markIds, compact }: { change: Change; unseen: boolean; markIds: string[]; compact?: boolean }) {
  const t = useT();
  const { view, muted, comments } = useData();
  const mark = useSeen((s) => s.mark);
  const { title, detail } = changeText(c, t);
  const isMuted = !!c.resource && muted.has(c.resource);
  const found = c.kind === "issue-comment" ? comments.get(c.id) : undefined;
  const openIt = () => {
    const ids = view.changes.filter((x) => sameThing(x) === sameThing(c)).map((x) => x.id);
    mark([...ids, ...markIds]);
  };
  const Tag = compact ? "li" : "div";
  return (
    <Tag className={cn("group relative rounded-l-md px-2 hover:bg-accent/50", compact ? "py-1.5" : "py-2", isMuted && "opacity-50")}>
      <div className="flex items-start gap-2">
        <Tip content={unseen ? t.markSeen : undefined}>
          <button
            type="button"
            aria-label={t.markSeen}
            disabled={!unseen}
            onClick={() => mark(markIds)}
            className={cn("mt-1.5 size-2 shrink-0 rounded-full", unseen ? "cursor-pointer bg-primary" : "bg-transparent")}
          />
        </Tip>
        {!compact && <SourceIcon resource={c.resource ?? c.ref} className="mt-0.5 size-3.5" />}
        <div className="min-w-0 flex-1">
          <a href={c.url} target="_blank" rel="noopener" onClick={openIt} onAuxClick={openIt} className={cn("block leading-snug hover:text-primary", compact ? "text-xs" : "text-sm")}>
            {!compact && <span className="mr-1.5 font-mono text-xs text-muted-foreground">{c.ref}</span>}
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
          {c.resource && !compact && <MuteButton id={c.resource} />}
        </div>
      </div>
    </Tag>
  );
}
