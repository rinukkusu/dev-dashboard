import type { BoardColumn, Issue, StatusCategory } from "./model.ts";

export type KanbanColumn = { name: string; issues: Issue[] };

const CATEGORY_RANK: Record<StatusCategory, number> = { new: 0, indeterminate: 1, done: 2 };
const UNLISTED = 1e9;

/**
 * Sorts the sprint tickets into kanban columns.
 *
 * With the Jira board's column config: exactly its columns in its order, empty ones too (like in
 * Jira). Statuses the board doesn't map get their own column – "to do"-like ones in front, the
 * rest at the end.
 *
 * Without a board config: one column per status, ordered by JIRA_STATUS_ORDER, then by status
 * category (to do → in progress → done), then by name.
 */
export function kanban(tickets: Issue[], board: BoardColumn[] | undefined, statusOrder: string[]): KanbanColumn[] {
  const columns = (board ?? []).map((c) => ({ name: c.name, ids: new Set(c.statusIds), issues: [] as Issue[] }));
  const loose = new Map<string, { name: string; category: StatusCategory; issues: Issue[] }>();

  for (const issue of tickets) {
    const column = issue.statusId ? columns.find((c) => c.ids.has(issue.statusId!)) : undefined;
    if (column) {
      column.issues.push(issue);
      continue;
    }
    const key = issue.status.toLowerCase();
    if (!loose.has(key)) loose.set(key, { name: issue.status, category: issue.statusCategory, issues: [] });
    loose.get(key)!.issues.push(issue);
  }

  const position = (name: string) => {
    const i = statusOrder.indexOf(name.toLowerCase());
    return i === -1 ? UNLISTED : i;
  };
  const sorted = [...loose.values()].sort(
    (a, b) =>
      position(a.name) - position(b.name) ||
      CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category] ||
      a.name.localeCompare(b.name),
  );
  const strip = ({ name, issues }: { name: string; issues: Issue[] }): KanbanColumn => ({ name, issues });

  if (!columns.length) return sorted.map(strip);
  return [
    ...sorted.filter((c) => c.category === "new").map(strip),
    ...columns.map(strip),
    ...sorted.filter((c) => c.category !== "new").map(strip),
  ];
}
