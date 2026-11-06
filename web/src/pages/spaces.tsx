import type { Agent, AgentStatus, Space } from "@shared/model.ts";
import { CheckIcon, LocateFixedIcon, MessageSquareTextIcon } from "lucide-react";
import { MuteButton, TicketChip } from "@/components/bits";
import { Section } from "@/components/section";
import { Button } from "@/components/ui/button";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/utils";

const DOT: Record<AgentStatus | "none", string> = {
  blocked: "bg-warn",
  done: "bg-ok",
  working: "bg-info animate-pulse",
  idle: "bg-muted-foreground/50",
  unknown: "bg-muted-foreground/30",
  none: "bg-muted-foreground/30",
};

/** herdr spaces: the ones named after a ticket first, the rest (reviews, side projects) below. */
export function SpacesPage() {
  const t = useT();
  const { lists } = useData();
  const linked = lists.spaces.filter((sp) => sp.ticketKeys.length);
  const other = lists.spaces.filter((sp) => !sp.ticketKeys.length);
  const grid = (list: Space[]) => (
    <div className="grid gap-3 md:grid-cols-2">
      {list.map((sp) => (
        <SpaceCard key={sp.id} space={sp} />
      ))}
    </div>
  );
  return (
    <>
      <Section id="spaces" title={t.herdr.section} count={linked.length} empty={t.herdr.empty}>
        {grid(linked)}
      </Section>
      {other.length > 0 && (
        <Section id="spaces-other" title={t.herdr.other} count={other.length}>
          {grid(other)}
        </Section>
      )}
    </>
  );
}

const focus = (target: { pane: string } | { space: string }) => api("POST", "/api/herdr/focus", target).catch(() => {});

function SpaceCard({ space }: { space: Space }) {
  const t = useT();
  const { lists, muted } = useData();
  const resource = `herdr:${space.id}`;
  const prs = [...new Set(space.ticketKeys.flatMap((k) => lists.links.prsByTicket.get(k) ?? []))];
  return (
    <article className={cn("group rounded-lg border bg-card p-4", muted.has(resource) && "opacity-50")}>
      <div className="flex items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", DOT[space.agents[0]?.status ?? "none"])} />
        <span className="font-mono text-xs text-muted-foreground">{space.number}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{space.label}</span>
        {space.focused && <span className="rounded bg-secondary px-1.5 text-xs text-muted-foreground">herdr ●</span>}
        {!space.agents.length && (
          <Button variant="ghost" size="sm" onClick={() => focus({ space: space.id })}>
            <LocateFixedIcon /> {t.herdr.focus}
          </Button>
        )}
        <MuteButton id={resource} />
      </div>
      {(space.ticketKeys.length > 0 || prs.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {space.ticketKeys.map((k) => (
            <TicketChip key={k} ticketKey={k} />
          ))}
          {prs.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noopener" title={p.title} className="inline-flex h-5 items-center gap-0.5 rounded-md border px-1.5 font-mono text-xs hover:bg-accent">
              {p.ref}
              {p.status === "completed" && <CheckIcon className="size-3 text-ok" />}
            </a>
          ))}
        </div>
      )}
      {space.agents.length ? (
        <ul className="mt-3 divide-y rounded-md border">
          {space.agents.map((a) => (
            <AgentRow key={a.paneId} agent={a} space={space} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{t.herdr.noAgent}</p>
      )}
    </article>
  );
}

function AgentRow({ agent: a, space }: { agent: Agent; space: Space }) {
  const t = useT();
  const openAgent = useUi((s) => s.openAgent);
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm">
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[a.status])} />
      <span className="shrink-0 text-xs text-muted-foreground">{t.herdr.status[a.status]}</span>
      <span className="shrink-0 font-medium">{a.name ?? a.kind ?? "Agent"}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground" title={a.cwd}>
        {a.title}
      </span>
      <Button variant="ghost" size="sm" onClick={() => openAgent({ pane: a.paneId, label: space.label })}>
        <MessageSquareTextIcon /> {t.herdr.open}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t.herdr.focus} title={t.herdr.focus} onClick={() => focus({ pane: a.paneId })}>
        <LocateFixedIcon />
      </Button>
    </li>
  );
}
