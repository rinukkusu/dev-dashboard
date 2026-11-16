// "What did I do?" – the last working days, each with its time cockpit bookings next to when I worked
// with Claude Code and what the dashboard saw me do. Anything no booking covers is marked orange, for
// the end-of-day booking.
import type { Timesheet, WorkSession } from "@shared/model.ts";
import { BotIcon, CheckSquareIcon, GitMergeIcon, GitPullRequestArrowIcon, GitPullRequestClosedIcon, MessageSquareIcon, RefreshCwIcon, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { TicketChip } from "@/components/bits";
import { Linked } from "@/components/todos";
import { useNow } from "@/components/time";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import {
  activityByDay,
  bookingText,
  gaps,
  groupByTicket,
  isBooked,
  localDay,
  minutes,
  projectTotals,
  recapDays,
  sessionsByDay,
  sessionSpan,
  sheetSpan,
  uncovered,
  UNBOOKED_MIN,
  type Did,
  type DidGroup,
  type DidKind,
  type SessionDay,
  type Span,
} from "@/lib/recap";
import { api } from "@/lib/store";
import { cn } from "@/lib/utils";

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

const ICON: Record<DidKind, LucideIcon> = {
  opened: GitPullRequestArrowIcon,
  merged: GitMergeIcon,
  closed: GitPullRequestClosedIcon,
  commented: MessageSquareIcon,
  todo: CheckSquareIcon,
};

type Recap = { sheets?: Timesheet[]; sheetsFailed?: boolean; sessions?: WorkSession[] };
/** off: time cockpit isn't set up – the page still shows sessions and activity */
type Load = { state: "loading" | "failed" | "ok" | "off"; recap?: Recap };

const useHm = () => {
  const t = useT();
  return useMemo(() => new Intl.DateTimeFormat(t.locale, { hour: "2-digit", minute: "2-digit" }), [t.locale]);
};

export function RecapPage() {
  const t = useT();
  const { view, prs, issues } = useData();
  const [workdays, setWorkdays] = useState(5);
  const today = localDay(new Date(useNow()));
  const days = useMemo(() => recapDays(new Date(`${today}T12:00:00`), workdays), [today, workdays]);
  const from = days.at(-1)!.day;
  const tcOn = view.hoursPerPoint !== undefined;
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchRecap = useCallback(
    (fresh: boolean) => {
      setLoad((l) => (l.recap ? l : { state: "loading" }));
      const since = new Date(`${from}T00:00:00`).getTime();
      const until = new Date(`${today}T00:00:00`).getTime() + 86_400_000 + 3_600_000; // + an hour for a DST switch
      api<Recap>("GET", `/api/recap?from=${from}&to=${today}&since=${since}&until=${until}${fresh ? "&fresh=1" : ""}`).then(
        (r) => setLoad({ state: !tcOn ? "off" : r.sheetsFailed ? "failed" : "ok", recap: r }),
        () => setLoad({ state: "failed" }),
      );
    },
    [tcOn, from, today],
  );
  useEffect(() => fetchRecap(false), [fetchRecap]);
  // while today is on screen, the sessions keep growing
  useEffect(() => {
    const id = setInterval(() => fetchRecap(false), 5 * 60_000);
    return () => clearInterval(id);
  }, [fetchRecap]);

  const did = useMemo(() => activityByDay([...prs.values()], [...issues.values()], view.todos ?? []), [prs, issues, view.todos]);
  const sheetsByDay = useMemo(() => {
    const m = new Map<string, Timesheet[]>();
    for (const s of load.recap?.sheets ?? []) m.set(s.begin.slice(0, 10), [...(m.get(s.begin.slice(0, 10)) ?? []), s]);
    return m;
  }, [load.recap]);
  const sessions = useMemo(() => sessionsByDay(load.recap?.sessions ?? []), [load.recap]);
  const yesterday = localDay(new Date(Date.parse(`${today}T12:00:00`) - 86_400_000));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex items-center gap-3 px-1">
        <p className="flex-1 text-sm text-muted-foreground">{tcOn ? t.recap.intro : t.recap.off}</p>
        <Tip content={t.recap.reload}>
          <Button variant="ghost" size="icon-sm" aria-label={t.recap.reload} onClick={() => fetchRecap(true)}>
            <RefreshCwIcon className={cn(load.state === "loading" && "animate-spin")} />
          </Button>
        </Tip>
      </div>
      {load.state === "failed" && <p className="mb-4 rounded-lg border border-bad/40 bg-bad/5 px-4 py-2 text-sm text-bad">{t.recap.failed}</p>}
      <div className="space-y-4">
        {days.map(({ day, weekend }) => {
          const sheets = sheetsByDay.get(day) ?? [];
          const done = did.get(day) ?? [];
          const worked = sessions.get(day) ?? [];
          if (weekend && !sheets.length && !done.length && !worked.length) return null;
          const label = day === today ? t.recap.today : day === yesterday ? t.recap.yesterday : undefined;
          return <Day key={day} day={day} label={label} today={day === today} weekend={weekend} sheets={sheets} sessions={worked} did={done} load={load.state} />;
        })}
      </div>
      <div className="mt-4 flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => setWorkdays(workdays + 5)}>
          {t.recap.more}
        </Button>
      </div>
    </div>
  );
}

function Day({ day, label, today, weekend, sheets, sessions, did, load }: {
  day: string;
  label?: string;
  today: boolean;
  weekend: boolean;
  sheets: Timesheet[];
  sessions: SessionDay[];
  did: Did[];
  load: Load["state"];
}) {
  const t = useT();
  const date = new Intl.DateTimeFormat(t.locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00`));
  const total = sheets.reduce((sum, s) => sum + s.hours, 0);
  const tcOn = load !== "off";
  // the comparison with the bookings only makes sense once there are some – a day without says so up top
  const check = load === "ok" && sheets.length > 0;
  const booked = useMemo(() => sheets.map(sheetSpan), [sheets]);
  const stretches = sessions.flatMap((s) => s.stretches);
  const holes = gaps(sheets, stretches);
  const sorted = [...sheets].sort((a, b) => a.begin.localeCompare(b.begin));
  return (
    <section aria-label={date} className="overflow-hidden rounded-lg border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2">
        <h2 className="font-semibold">{label ?? date}</h2>
        {label && <span className="text-sm text-muted-foreground">{date}</span>}
        <span className="flex-1" />
        {load === "ok" &&
          (sheets.length ? (
            <>
              <span className="hidden gap-1.5 text-xs text-muted-foreground sm:flex">
                {projectTotals(sheets).map(([project, hours]) => (
                  <span key={project} className="rounded-full bg-secondary px-2 tabular-nums">
                    {project} {fmt(hours)}
                  </span>
                ))}
              </span>
              <span className="text-sm font-semibold tabular-nums">{t.recap.hours(fmt(total))}</span>
            </>
          ) : today ? (
            <span className="text-xs text-muted-foreground">{t.recap.nothingYet}</span>
          ) : weekend ? null : (
            <span className="rounded-full border border-warn/40 bg-warn/10 px-2 text-xs font-medium text-warn">{t.recap.notBooked}</span>
          ))}
      </header>
      {(sheets.length > 0 || stretches.length > 0) && <Timeline booked={booked} stretches={stretches} check={check} />}
      <div className={cn("grid", tcOn && "lg:grid-cols-2 lg:divide-x")}>
        {tcOn && (
          <div className="min-w-0">
            <h3 className="sr-only">{t.recap.booked}</h3>
            {sorted.length ? (
              <ul className="divide-y">
                {sorted.map((s) => (
                  <BookingRows key={s.id} sheet={s} gap={holes.get(s.id)} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">{load === "loading" ? "…" : t.recap.noBookings}</p>
            )}
          </div>
        )}
        <div className="min-w-0 border-t lg:border-t-0">
          <Heading>{t.recap.claude}</Heading>
          {sessions.length ? (
            <ul className="pb-1">
              {sessions.map((s) => (
                <SessionRow key={s.key} session={s} booked={booked} check={check} />
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-2 text-sm text-muted-foreground">{load === "loading" ? "…" : t.recap.noClaude}</p>
          )}
          <Heading>{t.recap.activity}</Heading>
          {did.length ? (
            <ul className="pb-1">
              {groupByTicket(did).map((g) => (
                <GroupRows key={g.key} group={g} unbooked={check && !g.dids.some((d) => isBooked(d, sheets))} />
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-3 text-sm text-muted-foreground">{t.recap.noActivity}</p>
          )}
        </div>
      </div>
    </section>
  );
}

const Heading = ({ children }: { children: ReactNode }) => <h3 className="px-4 pt-2 pb-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>;

const HOUR = 3_600_000;
/** unbooked Claude work shorter than this isn't marked in the timeline */
const NOISE_MIN = 5;

/** The day at a glance: bookings above, Claude work below; Claude work no booking covers in orange. */
function Timeline({ booked, stretches, check }: { booked: Span[]; stretches: WorkSession[]; check: boolean }) {
  const t = useT();
  const hm = useHm();
  const spans = stretches.map(sessionSpan);
  const all = [...booked, ...spans];
  const midnight = new Date(Math.min(...all.map((s) => s.start)));
  midnight.setHours(0, 0, 0, 0);
  const at = (h: number) => midnight.getTime() + h * HOUR;
  // 7–17 at least, widened to whole hours around everything
  const first = Math.min(7, Math.floor((Math.min(...all.map((s) => s.start)) - midnight.getTime()) / HOUR));
  const last = Math.max(17, Math.ceil((Math.max(...all.map((s) => s.end)) - midnight.getTime()) / HOUR));
  const pos = (ms: number) => ((ms - at(first)) / (at(last) - at(first))) * 100;
  const block = (s: Span, className: string, title: string, key: string | number) => (
    <span
      key={key}
      title={title}
      className={cn("absolute inset-y-0 rounded-sm", className)}
      // a minute of work is still worth seeing
      style={{ left: `${pos(s.start)}%`, width: `max(${pos(s.end) - pos(s.start)}%, 2px)` }}
    />
  );
  const range = (s: Span) => `${hm.format(s.start)}–${hm.format(s.end)}`;
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return (
    <div className="border-b px-4 pt-2 pb-1" aria-hidden>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        <span>{t.recap.booked}</span>
        <div className="relative h-2.5 rounded-sm bg-muted/40">{booked.map((s, i) => block(s, "bg-primary/60", range(s), i))}</div>
        <span>{t.recap.claude}</span>
        <div className="relative h-2.5 rounded-sm bg-muted/40">
          {spans.map((s, i) => block(s, "bg-info/70", range(s), i))}
          {/* a minute or two past a booking's end is noise (the booking session itself, a last question) */}
          {check &&
            spans.flatMap((s, i) =>
              uncovered(s, booked)
                .filter((u) => minutes([u]) >= NOISE_MIN)
                .map((u, j) => block(u, "bg-warn", `${range(u)} · ${t.recap.unbookedMinutes(minutes([u]))}`, `u${i}-${j}`)),
            )}
        </div>
        <span />
        <div className="relative h-3">
          {hours.map((h) => (
            <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pos(at(h))}%` }}>
              {h % 2 === 0 ? h : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function BookingRows({ sheet: s, gap }: { sheet: Timesheet; gap?: Span & { worked: number } }) {
  const t = useT();
  const hm = useHm();
  const text = bookingText(s);
  const warn = !!gap && gap.worked >= UNBOOKED_MIN;
  return (
    <>
      {gap && (
        <li className={cn("flex items-baseline gap-3 px-4 py-1 text-xs text-muted-foreground italic", warn && "bg-warn/5 text-warn")}>
          <span className="w-24 shrink-0 font-mono not-italic">
            {hm.format(gap.start)}–{hm.format(gap.end)}
          </span>
          <span>
            {t.recap.gap(minutes([gap]))}
            {gap.worked > 0 && ` · ${t.recap.gapWorked(gap.worked)}`}
          </span>
        </li>
      )}
      <li className="flex items-baseline gap-3 px-4 py-1.5 text-sm">
        <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
          {s.begin.slice(11, 16)}–{s.end.slice(11, 16)}
        </span>
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{fmt(s.hours)}</span>
        <span className="min-w-0 flex-1">
          {s.task && (JIRA_KEY.test(s.task) ? <TicketChip ticketKey={s.task} /> : <span className="mr-1 font-medium">{s.task}</span>)}
          {text && (
            <span className="ml-1">
              <Linked text={text} />
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{s.project}</span>
      </li>
    </>
  );
}

function SessionRow({ session: s, booked, check }: { session: SessionDay; booked: Span[]; check: boolean }) {
  const t = useT();
  const hm = useHm();
  const spans = s.stretches.map(sessionSpan);
  const open = check ? minutes(spans.flatMap((x) => uncovered(x, booked))) : 0;
  const alone = s.prompts === 0;
  return (
    <li className={cn("flex items-baseline gap-2 px-4 py-1 text-sm", alone && "text-muted-foreground")}>
      <BotIcon className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          {s.keys.map((k) => (
            <span key={k} className="shrink-0">
              <Ref text={k} />
            </span>
          ))}
          <span className="truncate" title={s.title}>
            {s.title ?? s.project}
          </span>
        </span>
        <span className="block font-mono text-[11px] text-muted-foreground">
          {spans.map((x) => `${hm.format(x.start)}–${hm.format(x.end)}`).join(", ")}
          {" · "}
          {alone ? t.recap.alone : t.recap.prompts(s.prompts)} · {s.project}
        </span>
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{t.recap.minutes(minutes(spans))}</span>
      {open >= UNBOOKED_MIN && !alone && (
        <span className="shrink-0 rounded-full border border-warn/40 bg-warn/10 px-1.5 text-xs text-warn tabular-nums">{t.recap.unbookedMinutes(open)}</span>
      )}
    </li>
  );
}

/** A ticket key or PR ref, linked when the dashboard knows it. */
const Ref = ({ text }: { text: string }) => (
  <span className="font-mono text-xs">
    <Linked text={text} />
  </span>
);

function GroupRows({ group: g, unbooked }: { group: DidGroup; unbooked: boolean }) {
  const t = useT();
  const { lists } = useData();
  const issue = g.ticket ? lists.links.issueByTicket.get(g.ticket) : undefined;
  // a single PR or to-do without a ticket: one line
  if (!g.ticket) return <DidRow did={g.dids[0]!} unbooked={unbooked} />;
  const own = g.dids.find((d) => d.isIssue);
  return (
    <li className="px-4 py-1 text-sm">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate">
          <TicketChip ticketKey={g.ticket} />
          <span className="ml-1.5" title={issue?.title}>
            {issue?.title ?? own?.title ?? g.dids[0]!.title}
          </span>
        </span>
        {own && <Events did={own} />}
        {unbooked && <UnbookedDot />}
      </div>
      {g.dids.some((d) => !d.isIssue) && (
        <ul className="mt-0.5 ml-3 border-l pl-3">
          {g.dids
            .filter((d) => !d.isIssue)
            .map((d) => (
              <DidRow key={d.key} did={d} nested />
            ))}
        </ul>
      )}
    </li>
  );
}

function DidRow({ did: d, unbooked, nested }: { did: Did; unbooked?: boolean; nested?: boolean }) {
  const Icon = ICON[d.events[0]!.kind];
  return (
    <li className={cn("flex items-baseline gap-2 text-sm", nested ? "py-0.5" : "px-4 py-1")}>
      <Icon className="size-3.5 shrink-0 translate-y-0.5 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {d.ref && (
          <a href={d.url} target="_blank" rel="noopener" className="mr-1.5 font-mono text-primary hover:underline">
            {d.ref}
          </a>
        )}
        <span title={d.title}>{d.title}</span>
      </span>
      <Events did={d} />
      {unbooked && <UnbookedDot />}
    </li>
  );
}

/** "opened 06:53 · merged 08:37 · 2 comments 10:02" */
function Events({ did }: { did: Did }) {
  const t = useT();
  const hm = useHm();
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {did.events.map((e, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {e.kind === "commented" ? t.recap.comments(e.count ?? 1) : t.recap.did[e.kind]} <span className="font-mono">{hm.format(new Date(e.at))}</span>
        </span>
      ))}
    </span>
  );
}

function UnbookedDot() {
  const t = useT();
  return (
    <Tip content={t.recap.unbooked}>
      <span className="size-2 shrink-0 self-center rounded-full bg-warn" tabIndex={0} aria-label={t.recap.unbooked} />
    </Tip>
  );
}
