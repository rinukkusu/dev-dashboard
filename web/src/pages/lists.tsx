// The list pages: pull requests, issues, CI runs. One dense row per item.
import type { Issue, PullRequest, Run } from "@shared/model.ts";
import { CircleCheckIcon, CircleDashedIcon, CircleMinusIcon, CircleXIcon, GitPullRequestDraftIcon, LoaderCircleIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CommentPop, MuteButton, NoteButton, NoteText, ReviewerChip, Spaces, StatusPill, ThreadsBadge, TicketChip, WatchedBadge } from "@/components/bits";
import { Rows, Section } from "@/components/section";
import { SourceIcon } from "@/components/source-icon";
import { Ago } from "@/components/time";
import { Badge } from "@/components/ui/badge";
import { useData } from "@/lib/data";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Comments older than this aren't worth showing on a row anymore. */
const RECENT_COMMENT_DAYS = 7;

/** The row frame: logo, title line with badges on the right, a meta line, chips. */
function Row({ id, url, refText, title, badges, meta, chips, muted }: {
  id: string;
  url: string;
  refText: ReactNode;
  title: string;
  badges?: ReactNode;
  meta?: ReactNode;
  chips?: ReactNode;
  muted?: boolean;
}) {
  return (
    <li className={cn("group flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40", muted && "opacity-50")}>
      <SourceIcon resource={id} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <a href={url} target="_blank" rel="noopener" className="flex min-w-0 flex-1 items-baseline gap-2 hover:text-primary">
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{refText}</span>
            <span className="truncate font-medium">{title}</span>
          </a>
          <div className="flex shrink-0 items-center gap-1">
            {badges}
            <WatchedBadge id={id} />
            <NoteButton id={id} />
            <MuteButton id={id} />
          </div>
        </div>
        <NoteText id={id} />
        {(meta || chips) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {meta && <div className="min-w-0 truncate text-xs text-muted-foreground">{meta}</div>}
            {chips && <div className="flex flex-wrap items-center gap-1">{chips}</div>}
          </div>
        )}
      </div>
    </li>
  );
}

export function PrRow({ pr }: { pr: PullRequest }) {
  const t = useT();
  const { muted } = useData();
  return (
    <Row
      id={pr.id}
      url={pr.url}
      refText={pr.ref}
      title={pr.title}
      muted={muted.has(pr.id)}
      badges={
        <>
          {pr.isDraft && (
            <Badge variant="outline">
              <GitPullRequestDraftIcon /> {t.badges.draft}
            </Badge>
          )}
          {pr.hasConflicts && <Badge variant="bad">{t.badges.conflicts}</Badge>}
          {pr.checks === "failure" && (
            <Badge variant="bad">
              <CircleXIcon /> {t.badges.checksFailing}
            </Badge>
          )}
          {pr.checks === "pending" && pr.status === "active" && (
            <Badge variant="warn">
              <LoaderCircleIcon className="animate-spin" /> {t.badges.checksPending}
            </Badge>
          )}
          <ThreadsBadge resource={pr.id} />
        </>
      }
      meta={
        <>
          {pr.repo} · <code className="font-mono">{pr.branch}</code> → <code className="font-mono">{pr.targetBranch}</code> · {pr.role !== "author" && `${t.by(pr.author)}, `}
          <Ago iso={pr.createdAt} />
        </>
      }
      chips={
        <>
          {pr.ticketKeys.map((k) => (
            <TicketChip key={k} ticketKey={k} />
          ))}
          <Spaces item={{ kind: "pr", pr }} />
          {pr.reviewers.map((r) => (
            <ReviewerChip key={r.id} reviewer={r} />
          ))}
        </>
      }
    />
  );
}

/** Last comment is someone else's and recent – the only one worth showing on a row. */
export const feedback = (issue: Issue, now = Date.now()) => {
  const last = issue.comments.at(-1);
  return last && !last.authorIsMe && now - Date.parse(last.at) < RECENT_COMMENT_DAYS * 86_400_000 ? last : undefined;
};

export function IssueRow({ issue }: { issue: Issue }) {
  const t = useT();
  const { muted, lists } = useData();
  const prs = issue.source === "jira" ? (lists.links.prsByTicket.get(issue.ref) ?? []) : [];
  const last = feedback(issue);
  return (
    <>
      <Row
        id={issue.id}
        url={issue.url}
        refText={issue.ref}
        title={issue.title}
        muted={muted.has(issue.id)}
        badges={
          <>
            <StatusPill status={issue.status} category={issue.statusCategory} />
            <ThreadsBadge resource={issue.id} />
          </>
        }
        meta={
          <>
            {issue.type} · {t.updated} <Ago iso={issue.updatedAt} />
            {prs.map((p) => (
              <span key={p.id}>
                {" · "}
                <a href={p.url} target="_blank" rel="noopener" className="hover:text-primary">
                  {p.ref}
                </a>
                {p.status === "completed" && ` (${t.mergedSuffix})`}
              </span>
            ))}
          </>
        }
        chips={<Spaces item={{ kind: "ticket", issue }} />}
      />
      {last && (
        <li className="-mt-px border-t-0 px-4 pb-2.5 pl-11">
          <CommentPop comment={last} issue={issue}>
            <blockquote className="line-clamp-2 border-l-2 border-warn pl-2 text-xs text-muted-foreground">
              <b className="text-foreground">{last.author}</b> <Ago iso={last.at} />: {last.text}
            </blockquote>
          </CommentPop>
        </li>
      )}
    </>
  );
}

const RUN_ICON: Record<string, { icon: LucideIcon; className: string }> = {
  queued: { icon: CircleDashedIcon, className: "text-muted-foreground" },
  running: { icon: LoaderCircleIcon, className: "animate-spin text-info" },
  success: { icon: CircleCheckIcon, className: "text-ok" },
  failure: { icon: CircleXIcon, className: "text-bad" },
  cancelled: { icon: CircleMinusIcon, className: "text-muted-foreground" },
  skipped: { icon: CircleMinusIcon, className: "text-muted-foreground" },
  neutral: { icon: CircleMinusIcon, className: "text-muted-foreground" },
};

export const runState = (r: Run) => (r.status === "completed" ? (r.conclusion ?? "neutral") : r.status);

export function RunRow({ run }: { run: Run }) {
  const t = useT();
  const { muted } = useData();
  const state = runState(run);
  const { icon: Icon, className } = RUN_ICON[state]!;
  return (
    <Row
      id={run.id}
      url={run.url}
      refText={
        <span className="inline-flex items-center gap-1.5">
          <Icon className={cn("size-4", className)} aria-label={t.run[state]} />
          {run.name}
        </span>
      }
      title={run.title}
      muted={muted.has(run.id)}
      meta={
        <>
          <span className={cn(state === "failure" && "text-bad", state === "success" && "text-ok")}>{t.run[state]}</span> · {run.repo}
          {run.branch && (
            <>
              {" · "}
              <code className="font-mono">{run.branch}</code>
            </>
          )}{" "}
          · {run.ref} · <Ago iso={run.updatedAt} />
        </>
      }
    />
  );
}

export function PrsPage() {
  const t = useT();
  const { lists } = useData();
  const section = (id: string, title: string, list: PullRequest[], empty: string, defaultOpen = true) => (
    <Section id={id} title={title} count={list.length} empty={empty} defaultOpen={defaultOpen}>
      <Rows>
        {list.map((p) => (
          <PrRow key={p.id} pr={p} />
        ))}
      </Rows>
    </Section>
  );
  return (
    <>
      {section("reviews", t.sections.reviews, lists.reviews, t.empty.reviews)}
      {section("my-prs", t.sections.myPrs, lists.mine, t.empty.myPrs)}
      {section("involved-prs", t.sections.involved, lists.involvedPrs, t.empty.involved)}
      {lists.merged.length > 0 && section("merged", t.sections.merged, lists.merged, "", false)}
    </>
  );
}

export function IssuesPage() {
  const t = useT();
  const { lists } = useData();
  return (
    <Section id="involved-issues" title={t.sections.involved} count={lists.involvedIssues.length} empty={t.empty.involved}>
      <Rows>
        {lists.involvedIssues.map((i) => (
          <IssueRow key={i.id} issue={i} />
        ))}
      </Rows>
    </Section>
  );
}

export function RunsPage() {
  const t = useT();
  const { lists } = useData();
  return (
    <Section id="runs" title={t.sections.runs} count={lists.runs.length} empty={t.empty.runs}>
      <Rows>
        {lists.runs.map((r) => (
          <RunRow key={r.id} run={r} />
        ))}
      </Rows>
    </Section>
  );
}
