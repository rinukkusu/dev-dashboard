import { kanban } from "@shared/board.ts";
import type { Issue } from "@shared/model.ts";
import { CheckIcon, MessageSquareIcon } from "lucide-react";
import { CommentPop, MuteButton, NoteButton, NoteText, Spaces, ThreadsBadge, WatchedBadge } from "@/components/bits";
import { Section } from "@/components/section";
import { SourceIcon } from "@/components/source-icon";
import { Tip } from "@/components/ui/tooltip";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { feedback } from "./lists";

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** The sprint as a kanban, columns as on the Jira board. Empty columns shrink to a narrow strip. */
export function BoardPage() {
  const t = useT();
  const { lists, view } = useData();
  const columns = kanban(lists.tickets, view.snapshot.board, view.statusOrder);
  return (
    <Section id="tickets" title={t.sections.tickets} count={lists.tickets.length} empty={t.empty.tickets}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const points = col.issues.filter((i) => i.points !== undefined);
          if (!col.issues.length) {
            return (
              <div key={col.name} className="flex w-9 shrink-0 justify-center rounded-lg border border-dashed py-3" title={col.name}>
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase [writing-mode:vertical-rl]">{col.name}</span>
              </div>
            );
          }
          return (
            <div key={col.name} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2">
              <h3 className="flex items-center gap-2 px-1 pt-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {col.name}
                <span className="tabular-nums opacity-70">{col.issues.length}</span>
                <span className="flex-1" />
                {points.length > 0 && (
                  <Tip content={t.storyPoints}>
                    <span className="rounded bg-background px-1.5 font-mono tabular-nums normal-case">{fmt(points.reduce((s, i) => s + i.points!, 0))} SP</span>
                  </Tip>
                )}
              </h3>
              {col.issues.map((i) => (
                <TicketCard key={i.id} issue={i} />
              ))}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function TicketCard({ issue }: { issue: Issue }) {
  const t = useT();
  const { lists, muted } = useData();
  const prs = lists.links.prsByTicket.get(issue.ref) ?? [];
  const last = feedback(issue);
  return (
    <article className={cn("group rounded-md border bg-card p-3 shadow-xs transition-colors hover:border-primary/40", muted.has(issue.id) && "opacity-50")}>
      <div className="flex items-center gap-1.5">
        <SourceIcon resource={issue.id} className="size-3.5" />
        <a href={issue.url} target="_blank" rel="noopener" className="font-mono text-xs text-muted-foreground hover:text-primary">
          {issue.ref}
        </a>
        <span className="text-xs text-muted-foreground">· {issue.type}</span>
        <span className="flex-1" />
        <ThreadsBadge resource={issue.id} />
        <WatchedBadge id={issue.id} />
        {issue.points !== undefined && (
          <Tip content={t.storyPoints}>
            <span className="rounded-full bg-secondary px-1.5 text-xs font-semibold tabular-nums">{fmt(issue.points)}</span>
          </Tip>
        )}
        <NoteButton id={issue.id} />
        <MuteButton id={issue.id} className="-mr-1" />
      </div>
      <a href={issue.url} target="_blank" rel="noopener" className="mt-1.5 block text-sm leading-snug font-medium hover:text-primary">
        {issue.title}
      </a>
      <NoteText id={issue.id} />
      <Booked issue={issue} />
      {(prs.length > 0 || last) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          {prs.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noopener" title={p.title} className="inline-flex items-center gap-0.5 rounded border px-1 font-mono hover:bg-accent">
              {p.ref}
              {p.status === "completed" && <CheckIcon className="size-3 text-ok" aria-label={t.mergedSuffix} />}
            </a>
          ))}
          {last && (
            <CommentPop comment={last} issue={issue}>
              <span className="inline-flex items-center gap-1 text-warn" title={last.wiki ? undefined : `${last.author}: ${last.text}`}>
                <MessageSquareIcon className="size-3" /> {last.author}
              </span>
            </CommentPop>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-1 empty:hidden">
        <Spaces item={{ kind: "ticket", issue }} />
      </div>
    </article>
  );
}

/** Booked hours (time cockpit) against story points × hours per point; without points just the hours. */
function Booked({ issue }: { issue: Issue }) {
  const t = useT();
  const { view } = useData();
  const perPoint = view.hoursPerPoint;
  if (issue.bookedHours === undefined || !perPoint) return null;
  if (!issue.points) {
    return issue.bookedHours > 0 ? <p className="mt-2 text-xs text-muted-foreground tabular-nums">{t.booked.hours(fmt(issue.bookedHours))}</p> : null;
  }
  const budget = issue.points * perPoint;
  const pct = Math.round((issue.bookedHours / budget) * 100);
  const tone = pct > 150 ? "bad" : pct > 100 ? "warn" : "ok";
  return (
    <Tip content={t.booked.budget(fmt(issue.points), fmt(perPoint))}>
      <div className="mt-2 flex items-center gap-2" tabIndex={0}>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", tone === "ok" && "bg-primary/70", tone === "warn" && "bg-warn", tone === "bad" && "bg-bad")} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <span className={cn("text-xs text-muted-foreground tabular-nums", tone === "warn" && "text-warn", tone === "bad" && "text-bad")}>
          {fmt(issue.bookedHours)}/{fmt(budget)} h
        </span>
      </div>
    </Tip>
  );
}
