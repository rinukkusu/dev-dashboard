// Small pieces the lists share: chips, badges and the buttons on a row.
import { jiraToHtml } from "@shared/jira-wiki.ts";
import { mdToHtml } from "@shared/markdown.ts";
import type { AgentJob, AgentStatus, Comment, Issue, PullRequest, Reviewer, Space, StatusCategory } from "@shared/model.ts";
import { spacesForItem } from "@shared/spaces.ts";
import {
  BellIcon, BellOffIcon, BotIcon, CheckIcon, CircleAlertIcon, EyeIcon, HourglassIcon, LoaderIcon, MessageSquareIcon,
  MinusIcon, PlusIcon, SendHorizontalIcon, XIcon, type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Ago } from "@/components/time";
import { Badge } from "@/components/ui/badge";
import { HoverPop } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { api } from "@/lib/store";
import { agentError, prepareStart, useUi } from "@/lib/ui";
import { cn } from "@/lib/utils";

const chip = "inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs whitespace-nowrap";

/** Bell on a row: muted things stay in the lists, dimmed, but don't ring, count or nag. */
export function MuteButton({ id, className }: { id: string; className?: string }) {
  const t = useT();
  const { muted } = useData();
  const on = muted.has(id);
  const Icon = on ? BellOffIcon : BellIcon;
  return (
    <Tip content={on ? t.unmute : t.mute}>
      <button
        type="button"
        aria-label={on ? t.unmute : t.mute}
        aria-pressed={on}
        onClick={(e) => {
          e.preventDefault();
          api("POST", "/api/mute", { id, muted: !on }).catch(() => {});
        }}
        className={cn(
          "rounded p-1 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100",
          on ? "opacity-100" : "opacity-0 group-hover:opacity-100 pointer-coarse:opacity-60",
          className,
        )}
      >
        <Icon className="size-3.5" />
      </button>
    </Tip>
  );
}

export const WatchedBadge = ({ id }: { id: string }) => {
  const t = useT();
  return useData().watched.has(id) ? (
    <Tip content={t.badges.watched}>
      <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={t.badges.watched} />
    </Tip>
  ) : null;
};

const CATEGORY: Record<StatusCategory, "outline" | "info" | "ok"> = { new: "outline", indeterminate: "info", done: "ok" };

export const StatusPill = ({ status, category }: { status: string; category: StatusCategory }) => (
  <Badge variant={CATEGORY[category]} className="font-normal">
    {status}
  </Badge>
);

/** A ticket key with its status; links to the ticket when it's known. */
export function TicketChip({ ticketKey }: { ticketKey: string }) {
  const issue = useData().lists.links.issueByTicket.get(ticketKey);
  if (!issue) return <span className={cn(chip, "font-mono text-muted-foreground")}>{ticketKey}</span>;
  return (
    <a href={issue.url} target="_blank" rel="noopener" title={issue.title} className={cn(chip, "hover:bg-accent")}>
      <span className="font-mono">{ticketKey}</span>
      <span className={cn("text-muted-foreground", issue.statusCategory === "done" && "text-ok", issue.statusCategory === "indeterminate" && "text-info")}>{issue.status}</span>
    </a>
  );
}

const VOTE: Record<Reviewer["vote"], { icon: LucideIcon; className: string }> = {
  approved: { icon: CheckIcon, className: "border-ok/40 text-ok" },
  approvedWithSuggestions: { icon: CheckIcon, className: "border-ok/40 text-ok" },
  none: { icon: MinusIcon, className: "text-muted-foreground" },
  waiting: { icon: HourglassIcon, className: "border-warn/40 text-warn" },
  rejected: { icon: XIcon, className: "border-bad/40 text-bad" },
};

export function ReviewerChip({ reviewer: r }: { reviewer: Reviewer }) {
  const t = useT();
  const { icon: Icon, className } = VOTE[r.vote];
  return (
    <Tip content={`${r.name}: ${t.vote[r.vote]}${r.required ? ` (${t.required})` : ""}`}>
      <span className={cn(chip, className, r.isMe && "font-semibold")} tabIndex={0}>
        <Icon className="size-3" />
        {r.name}
        {r.required && <span aria-hidden>*</span>}
      </span>
    </Tip>
  );
}

const AGENT: Record<AgentStatus | "none", string> = {
  blocked: "border-warn/50 bg-warn-soft text-warn",
  done: "border-ok/50 bg-ok-soft text-ok",
  working: "border-info/50 bg-info-soft text-info",
  idle: "text-muted-foreground",
  unknown: "text-muted-foreground",
  none: "text-muted-foreground",
};

/** A herdr space on a ticket/PR: the state of its most urgent agent; opens its chat. */
export function SpaceChip({ space }: { space: Space }) {
  const t = useT();
  const openAgent = useUi((s) => s.openAgent);
  const a = space.agents[0];
  return (
    <Tip content={`${space.label}${a?.kind ? ` · ${a.kind}` : ""}`}>
      <button
        type="button"
        className={cn(chip, "cursor-pointer hover:brightness-110", AGENT[a?.status ?? "none"])}
        onClick={(e) => {
          e.preventDefault();
          if (a) openAgent({ pane: a.paneId, label: space.label });
          else api("POST", "/api/herdr/focus", { space: space.id }).catch(() => {});
        }}
      >
        {a?.status === "working" ? <LoaderIcon className="size-3 animate-spin" /> : <BotIcon className="size-3" />}
        {a ? t.herdr.status[a.status] : t.herdr.noAgent}
      </button>
    </Tip>
  );
}

/** A ticket's or PR's spaces – or, on open ones without a space, a button to start one. */
export function Spaces({ item }: { item: { kind: "ticket"; issue: Issue } | { kind: "pr"; pr: PullRequest } }) {
  const t = useT();
  const { view, canStart } = useData();
  const spaces = spacesForItem(view.herdr?.spaces ?? [], item);
  if (spaces.length) return spaces.map((sp) => <SpaceChip key={sp.id} space={sp} />);
  const open = item.kind === "pr" ? item.pr.status === "active" : item.issue.statusCategory !== "done";
  if (!canStart || !open) return null;
  const id = item.kind === "pr" ? item.pr.id : item.issue.id;
  return (
    <Tip content={t.herdr.start.button}>
      <button
        type="button"
        aria-label={t.herdr.start.button}
        className={cn(chip, "cursor-pointer border-dashed text-muted-foreground opacity-50 hover:opacity-100 group-hover:opacity-100")}
        onClick={(e) => {
          e.preventDefault();
          void prepareStart(item.kind, id, (err) => agentError(t.client.agentErrors, err));
        }}
      >
        <BotIcon className="size-3" />
        <PlusIcon className="size-3" />
      </button>
    </Tip>
  );
}

/** ➤ on a comment: hand it to the agent of its ticket/PR (or start one); ✓ once it went out. */
export function SendButton({ changeId }: { changeId: string }) {
  const t = useT();
  const { herdr, sent } = useData();
  if (!herdr) return null;
  const done = sent.has(changeId);
  const label = done ? t.herdr.start.sentTitle : t.herdr.start.send;
  return (
    <Tip content={label}>
      <button
        type="button"
        aria-label={label}
        className={cn("inline-flex items-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-primary", done && "text-ok")}
        onClick={(e) => {
          e.preventDefault();
          void prepareStart("comment", changeId, (err) => agentError(t.client.agentErrors, err));
        }}
      >
        <SendHorizontalIcon className="size-3.5" />
        {done && <CheckIcon className="size-3" />}
      </button>
    </Tip>
  );
}

/** 💬 n: a PR's open threads or an issue's comments; opens them where the source can show them. */
export function ThreadsBadge({ resource }: { resource: string }) {
  const t = useT();
  const { prs, issues } = useData();
  const setUi = useUi((s) => s.set);
  const pr = prs.get(resource);
  const issue = issues.get(resource);
  let n = 0;
  let open = false;
  let title = "";
  let clickable = false;
  if (pr?.openThreads) {
    n = pr.openThreads;
    open = true;
    title = pr.threads ? t.threads.button : t.badges.openThreads;
    clickable = !!pr.threads;
  } else if (issue?.comments.length) {
    n = issue.comments.length;
    open = !issue.comments.at(-1)!.authorIsMe;
    title = open ? t.badges.commentsOpen : t.badges.comments;
    clickable = true;
  }
  if (!n) return null;
  const badge = (
    <Badge variant={open ? "warn" : "outline"} className={cn(clickable && "cursor-pointer hover:brightness-110")}>
      <MessageSquareIcon />
      {n}
    </Badge>
  );
  return (
    <Tip content={title}>
      {clickable ? (
        <button
          type="button"
          aria-label={`${title}: ${n}`}
          onClick={(e) => {
            e.preventDefault();
            setUi({ threads: resource });
          }}
        >
          {badge}
        </button>
      ) : (
        <span tabIndex={0}>{badge}</span>
      )}
    </Tip>
  );
}

/** The whole comment, formatted like in Jira, in a popover over whatever shows its start. */
export function CommentPop({ comment, issue, children }: { comment: Comment; issue: Issue; children: ReactNode }) {
  if (!comment.wiki) return <>{children}</>;
  return (
    <HoverPop trigger={<span className="cursor-help">{children}</span>}>
      <div className="mb-2 flex items-center gap-2 border-b pb-2 text-xs text-muted-foreground">
        <b className="text-foreground">{comment.author}</b> · <span className="font-mono">{issue.ref}</span> · <Ago iso={comment.at} />
        <span className="flex-1" />
        <SendButton changeId={`issue:${issue.id}:c:${comment.id}`} />
      </div>
      <div className="rich" dangerouslySetInnerHTML={{ __html: jiraToHtml(comment.wiki) }} />
    </HoverPop>
  );
}

const JOB_ICON: Record<AgentJob["status"], LucideIcon> = {
  collecting: HourglassIcon,
  queued: HourglassIcon,
  sent: LoaderIcon,
  answered: BotIcon,
  failed: CircleAlertIcon,
};

/**
 * An autopilot job on a to-do: its state; hovering shows the agent's answer – summary, the
 * presentation artifact, the whole text – with "read", the proposed replies and the chat.
 */
export function JobChip({ job }: { job: AgentJob }) {
  const t = useT();
  const setUi = useUi((s) => s.set);
  const openAgent = useUi((s) => s.openAgent);
  const done = job.status === "answered" || job.status === "failed";
  const unread = done && !job.read && !job.seen;
  const Icon = JOB_ICON[job.status];
  const open = job.suggestions?.filter((s) => !s.sent).length ?? 0;
  const markRead = (seen: boolean) => api("POST", "/api/jobs/read", { id: job.id, seen }).catch(() => {});
  return (
    <HoverPop
      trigger={
        <button
          type="button"
          aria-label={t.auto.status[job.status]}
          className={cn(
            chip,
            "relative cursor-pointer",
            job.status === "answered" && "border-ok/50 bg-ok-soft text-ok",
            job.status === "failed" && "border-bad/50 bg-bad-soft text-bad",
            !done && "border-info/50 bg-info-soft text-info",
          )}
        >
          <BotIcon className="size-3" />
          <Icon className={cn("size-3", job.status === "sent" && "animate-spin")} />
          {unread && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-primary" />}
        </button>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-2 border-b pb-2 text-xs text-muted-foreground">
        <b className="text-foreground">{t.auto.status[job.status]}</b> · <span className="font-mono">{job.ref}</span> · {t.auto.comments(job.changeIds.length)} ·{" "}
        <Ago iso={job.answeredAt ?? job.sentAt ?? job.lastAt} />
      </div>
      {job.status === "queued" && job.waiting && t.auto.waiting[job.waiting] && <p className="mb-2 text-xs text-muted-foreground">{t.auto.waiting[job.waiting]}</p>}
      {job.status === "answered" && (
        <>
          {job.summary && <p className="mb-2 font-medium">{job.summary}</p>}
          {job.artifact && (
            <p className="mb-2">
              <a href={job.artifact} target="_blank" rel="noopener" className="text-primary hover:underline" onClick={() => markRead(true)}>
                {t.auto.artifact}
              </a>
            </p>
          )}
          <div className="rich max-h-80 overflow-y-auto rounded-md bg-muted/50 p-2" dangerouslySetInnerHTML={{ __html: mdToHtml(job.reply ?? "", t.threads.suggested) }} />
        </>
      )}
      {job.status === "failed" && <p className="text-bad">{job.error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {open > 0 && (
          <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => setUi({ threads: job.resource })}>
            {t.threads.review.replace("{n}", String(open))}
          </button>
        )}
        {job.pane && (
          <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => openAgent({ pane: job.pane!, label: job.ref })}>
            {t.auto.open}
          </button>
        )}
        {done && !job.read && (
          <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-accent" onClick={() => markRead(false)}>
            {t.auto.read}
          </button>
        )}
      </div>
    </HoverPop>
  );
}
