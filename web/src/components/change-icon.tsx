import type { Change } from "@shared/model.ts";
import {
  ArrowRightIcon,
  CircleMinusIcon,
  CirclePlayIcon,
  CirclePlusIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  HourglassIcon,
  ListChecksIcon,
  ListXIcon,
  type LucideIcon,
  MessageSquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Undo2Icon,
  UserRoundPlusIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** What kind of change it is (the shape) and how it went (the colour) – readable without the text. */
export function changeLook(c: Change, done?: boolean): { Icon: LucideIcon; tone: string; dot?: string } {
  const ok = { tone: "text-ok" };
  const bad = { tone: "text-bad" };
  const warn = { tone: "text-warn" };
  const info = { tone: "text-info" };
  const grey = { tone: "text-muted-foreground" };
  switch (c.kind) {
    case "pr-review-request":
      return { Icon: UserRoundPlusIcon, ...info };
    case "pr-vote":
      switch (c.vote) {
        case "approved":
          return { Icon: ThumbsUpIcon, ...ok };
        case "approvedWithSuggestions":
          return { Icon: ThumbsUpIcon, ...ok, dot: "bg-warn" };
        case "waiting":
          return { Icon: HourglassIcon, ...warn };
        case "rejected":
          return { Icon: ThumbsDownIcon, ...bad };
        default:
          return { Icon: Undo2Icon, ...grey };
      }
    case "pr-comment":
    case "issue-comment":
      return { Icon: MessageSquareIcon, ...info };
    case "pr-merged":
      return { Icon: GitMergeIcon, tone: "text-violet-500" };
    case "pr-gone":
      return { Icon: GitPullRequestClosedIcon, ...grey };
    case "pr-checks":
      return c.checks === "failure" ? { Icon: ListXIcon, ...bad } : { Icon: ListChecksIcon, ...ok };
    case "issue-status":
      return { Icon: ArrowRightIcon, ...(done ? ok : grey) };
    case "issue-added":
      return { Icon: CirclePlusIcon, ...grey };
    case "issue-removed":
      return { Icon: CircleMinusIcon, ...grey };
    case "run-finished":
      return { Icon: CirclePlayIcon, ...(c.conclusion === "success" ? ok : c.conclusion === "failure" ? bad : grey) };
  }
}

/** The change's icon; `badge` adds a mark in the bottom right corner (the source). */
export function ChangeIcon({ change, done, badge, className }: { change: Change; done?: boolean; badge?: React.ReactNode; className?: string }) {
  const { Icon, tone, dot } = changeLook(change, done);
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)}>
      <Icon className={cn("size-3.5", tone)} aria-hidden />
      {dot && <span className={cn("absolute top-0 right-0 size-1.5 rounded-full ring-1 ring-background", dot)} />}
      {badge && <span className="absolute -right-1.5 -bottom-1.5 flex rounded-full bg-card p-[1.5px]">{badge}</span>}
    </span>
  );
}
