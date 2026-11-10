import type { HintReason } from "@shared/model.ts";
import {
  BotIcon, CircleXIcon, EyeIcon, FlaskConicalIcon, GitMergeIcon, HandIcon, HourglassIcon, MessageSquareQuoteIcon,
  MessagesSquareIcon, MoveRightIcon, RocketIcon, ShieldXIcon, type LucideIcon,
} from "lucide-react";

export const REASON_ICON: Record<HintReason, LucideIcon> = {
  rejected: ShieldXIcon,
  waiting: HourglassIcon,
  threads: MessagesSquareIcon,
  conflicts: GitMergeIcon,
  checks: FlaskConicalIcon,
  ready: RocketIcon,
  review: EyeIcon,
  "move-ticket": MoveRightIcon,
  feedback: MessageSquareQuoteIcon,
  "run-failed": CircleXIcon,
  "agent-blocked": HandIcon,
  "agent-done": BotIcon,
  "agent-reply": BotIcon,
};

/** Reasons that block a merge or a release: shown in red rather than amber. */
export const SEVERE = new Set<HintReason>(["rejected", "conflicts", "checks", "run-failed"]);
