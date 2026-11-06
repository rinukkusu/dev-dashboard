import type { Comment, Issue, PullRequest } from "@shared/model.ts";
import type { ViewData } from "@shared/view.ts";
import { createContext, useContext } from "react";
import type { Lists } from "./derive.ts";

/** The view plus what every part of the page looks things up in. Built once per update, in App. */
export type Data = {
  view: ViewData;
  lists: Lists;
  muted: Set<string>;
  watched: Set<string>;
  /** change ids of comments handed to an agent */
  sent: Set<string>;
  prs: Map<string, PullRequest>;
  issues: Map<string, Issue>;
  /** change id of an issue comment → the comment, for its popover */
  comments: Map<string, { comment: Comment; issue: Issue }>;
  /** herdr is set up: agents can be talked to */
  herdr: boolean;
  /** HERDR_WORKDIR is set: spaces can be started */
  canStart: boolean;
};

export function buildData(view: ViewData, lists: Lists): Data {
  const s = view.snapshot;
  return {
    view,
    lists,
    muted: new Set(view.muted),
    watched: new Set(view.watched),
    sent: new Set(view.sent),
    prs: new Map(s.prs.map((p) => [p.id, p])),
    issues: new Map(s.issues.map((i) => [i.id, i])),
    // same id as diff.ts gives an issue comment's change
    comments: new Map(s.issues.flatMap((issue) => issue.comments.map((comment) => [`issue:${issue.id}:c:${comment.id}`, { comment, issue }] as const))),
    herdr: !!view.herdr,
    canStart: !!view.herdr?.canStart,
  };
}

export const DataContext = createContext<Data | undefined>(undefined);

export function useData(): Data {
  const d = useContext(DataContext);
  if (!d) throw new Error("useData outside of <DataContext>");
  return d;
}
