import { hintText } from "@shared/i18n.ts";
import type { HintLevel } from "@shared/model.ts";
import type { Space } from "@shared/model.ts";
import { InboxIcon, MessageSquareTextIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { CommentPop, JobChip, MuteButton, NoteButton, NoteText, ResolveButton, Spaces, ThreadsBadge } from "@/components/bits";
import { REASON_ICON, SEVERE } from "@/components/reason";
import { Rows, Section } from "@/components/section";
import { SourceIcon } from "@/components/source-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useData } from "@/lib/data";
import { agentsAtWork, type InboxItem, waitingOnOthers } from "@/lib/derive";
import { useCursor } from "@/lib/keys";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { PrRow } from "@/pages/lists";

const LEVELS: HintLevel[] = ["action", "ready", "info"];

export function Inbox({ items }: { items: InboxItem[] }) {
  const t = useT();
  const { view } = useData();
  const cursor = useCursor((s) => s.resource);
  const waiting = waitingOnOthers(view, items);
  const working = agentsAtWork(view, items);
  return (
    <>
      {!items.length ? (
        <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
          <InboxIcon className="size-10 opacity-40" />
          <p>{t.app.inboxEmpty}</p>
        </div>
      ) : (
        LEVELS.map((level) => {
          const group = items.filter((i) => i.level === level);
          if (!group.length) return null;
          return (
            <Section key={level} id={`inbox-${level}`} title={t.app.levels[level]} count={group.length}>
              <Rows>
                {group.map((item) => (
                  <InboxRow key={item.resource} item={item} selected={item.resource === cursor} />
                ))}
              </Rows>
            </Section>
          );
        })
      )}
      {/* the rest at a glance, so an empty inbox means "nothing stuck", not "nothing to see" */}
      {working.length > 0 && (
        <Section id="inbox-working" title={t.app.agentsWorking} count={working.length}>
          <Rows>
            {working.map((sp) => (
              <WorkingRow key={sp.id} space={sp} />
            ))}
          </Rows>
        </Section>
      )}
      {waiting.length > 0 && (
        <Section id="inbox-waiting" title={t.app.waitingOthers} count={waiting.length}>
          <Rows>
            {waiting.map((pr) => (
              <PrRow key={pr.id} pr={pr} />
            ))}
          </Rows>
        </Section>
      )}
      <MutedList />
    </>
  );
}

function InboxRow({ item, selected }: { item: InboxItem; selected: boolean }) {
  const t = useT();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const { comments } = useData();
  const openAgent = useUi((s) => s.openAgent);
  const meta = item.pr
    ? `${item.pr.repo} · ${item.pr.branch} → ${item.pr.targetBranch}`
    : item.issue
      ? `${item.issue.type} · ${item.issue.status}`
      : item.run
        ? `${item.run.repo}${item.run.branch ? ` · ${item.run.branch}` : ""}`
        : undefined;
  const title = item.title ?? hintText(t, item.hints[0]!.msg);
  // agents: the row opens the chat instead of a link
  const onTitle = item.pane
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        openAgent({ pane: item.pane!, label: item.ref });
      }
    : undefined;
  return (
    <li
      ref={ref}
      aria-current={selected || undefined}
      className={cn(
        "group relative flex scroll-my-16 items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/40",
        selected && "bg-accent/60 ring-2 ring-primary/50 ring-inset",
        "before:absolute before:inset-y-0 before:left-0 before:w-0.5",
        item.level === "action" && "before:bg-warn",
        item.level === "ready" && "before:bg-ok",
        item.level === "info" && "before:bg-info",
      )}
    >
      <SourceIcon resource={item.resource} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <a href={item.url} target={onTitle ? undefined : "_blank"} rel="noopener" onClick={onTitle} className="flex min-w-0 items-baseline gap-2 hover:text-primary">
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.ref}</span>
          <span className="truncate font-medium">{title}</span>
        </a>
        {meta && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>}
        <NoteText id={item.resource} />
        <div className="mt-1.5 flex flex-wrap items-center gap-1 empty:hidden">
          {item.hints.map((h, i) => {
            const Icon = REASON_ICON[h.reason];
            const found = h.comment ? comments.get(h.comment) : undefined;
            const badge = (
              <Badge variant={h.level === "ready" ? "ok" : h.level === "info" ? "info" : SEVERE.has(h.reason) ? "bad" : "warn"} tabIndex={0}>
                <Icon />
                {t.reasons[h.reason]}
              </Badge>
            );
            return found ? (
              <CommentPop key={i} comment={found.comment} issue={found.issue}>
                {badge}
              </CommentPop>
            ) : (
              <Tip key={i} content={hintText(t, h.msg)}>
                {badge}
              </Tip>
            );
          })}
          {item.pr && <Spaces item={{ kind: "pr", pr: item.pr }} />}
          {item.issue && <Spaces item={{ kind: "ticket", issue: item.issue }} />}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ThreadsBadge resource={item.resource} />
        {item.job && <JobChip job={item.job} />}
        <NoteButton id={item.resource} keyed />
        <ResolveButton id={item.resource} />
        <MuteButton id={item.resource} />
      </div>
    </li>
  );
}

/** A space whose agent is busy: which ticket, what it's doing, its chat. */
function WorkingRow({ space }: { space: Space }) {
  const t = useT();
  const openAgent = useUi((s) => s.openAgent);
  const agent = space.agents.find((a) => a.status === "working")!;
  return (
    <li className="flex items-center gap-3 px-4 py-2 text-sm">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-info" />
      <span className="shrink-0 font-medium">{space.label}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{agent.title ?? t.herdr.status.working}</span>
      <Button variant="ghost" size="sm" onClick={() => openAgent({ pane: agent.paneId, label: space.label })}>
        <MessageSquareTextIcon /> {t.herdr.open}
      </Button>
    </li>
  );
}

/** Muted things with a way back; titles from whatever is still in the snapshot. */
function MutedList() {
  const t = useT();
  const { view, muted } = useData();
  if (!muted.size) return null;
  const s = view.snapshot;
  const known = new Map<string, { ref: string; title: string; url: string }>([
    ...s.prs.map((p) => [p.id, { ref: p.ref, title: p.title, url: p.url }] as const),
    ...s.issues.map((i) => [i.id, { ref: i.ref, title: i.title, url: i.url }] as const),
    ...s.runs.map((r) => [r.id, { ref: r.name, title: r.title, url: r.url }] as const),
    ...(view.herdr?.spaces ?? []).map((sp) => [`herdr:${sp.id}`, { ref: "herdr", title: sp.label, url: "#spaces" }] as const),
  ]);
  return (
    <Section id="muted" title={t.sections.muted} count={muted.size} defaultOpen={false}>
      <Rows>
        {[...muted].map((id) => {
          const k = known.get(id);
          return (
            <li key={id} className="group flex items-center gap-3 px-4 py-2 text-sm">
              <SourceIcon resource={id} className="size-3.5" />
              {k ? (
                <a href={k.url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate hover:text-primary">
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{k.ref}</span>
                  {k.title}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{id}</span>
              )}
              <MuteButton id={id} />
            </li>
          );
        })}
      </Rows>
    </Section>
  );
}
