import { rename } from "node:fs/promises";
import { join } from "node:path";
import { createAdoClient } from "./ado.ts";
import type { Config } from "./config.ts";
import { link, makeKeyExtractor } from "./correlate.ts";
import { diff, mergeLog } from "./diff.ts";
import { createJiraClient } from "./jira.ts";
import type { Change, Snapshot } from "./model.ts";
import { dict, type Lang } from "./i18n.ts";
import type { View } from "./render.ts";
import { evaluate } from "./rules.ts";

export type State = { snapshot: Snapshot; changes: Change[] };

export const statePath = (cfg: Config) => join(cfg.outDir, "state.json");

export async function loadState(path: string): Promise<State | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    return (await file.json()) as State;
  } catch {
    return undefined; // corrupt state → behave like a first run
  }
}

/** Write to a temp file and rename, so nobody ever reads a half-written file. */
export async function writeAtomic(path: string, content: string) {
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, content);
  await rename(tmp, path);
}

export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Everything the page needs, derived from a stored state, in one language. */
export function buildView(cfg: Config, { snapshot, changes }: State, lang: Lang = cfg.lang): View {
  const links = link(snapshot.prs, snapshot.issues);
  const hints = evaluate(snapshot, {
    ...links,
    postMergeStatuses: cfg.jira?.postMergeStatuses ?? [],
    now: Date.now(),
    t: dict(lang),
  });
  return {
    lang,
    snapshot,
    changes,
    hints,
    links,
    refreshSeconds: cfg.refreshSeconds,
    sources: { jira: !!cfg.jira, ado: !!cfg.ado },
  };
}

/** One poll: fetch both sources, diff against the stored state, persist it. */
export async function update(cfg: Config): Promise<{ state: State; fresh: Change[] }> {
  const path = statePath(cfg);
  const state = await loadState(path);
  const prev = state?.snapshot;

  const errors: string[] = [];
  const extractKeys = makeKeyExtractor(cfg.jira?.projectKeys ?? []);

  // If a source fails we keep its previous data: the page stays useful and the
  // next successful run doesn't report everything as "new".
  let prs = prev?.prs ?? [];
  if (cfg.ado) {
    try {
      prs = await createAdoClient(cfg.ado).fetchPullRequests(extractKeys);
    } catch (e) {
      errors.push(`Azure DevOps: ${message(e)}`);
    }
  }

  let issues = prev?.issues ?? [];
  if (cfg.jira) {
    try {
      issues = await createJiraClient(cfg.jira).fetchIssues(prs.flatMap((p) => p.ticketKeys));
    } catch (e) {
      errors.push(`Jira: ${message(e)}`);
    }
  }

  const snapshot: Snapshot = { takenAt: new Date().toISOString(), prs, issues, errors };
  const fresh = prev ? diff(prev, snapshot) : []; // first run = baseline, no flood of "changes"
  const changes = mergeLog(state?.changes ?? [], fresh, cfg.changesKeepHours);
  await writeAtomic(path, JSON.stringify({ snapshot, changes } satisfies State));

  const stamp = new Date().toLocaleTimeString("en-GB");
  console.log(`[${stamp}] ${prs.length} PRs, ${issues.length} issues, ${fresh.length} new changes`);
  for (const e of errors) console.error(`[${stamp}] Error: ${e}`);
  return { state: { snapshot, changes }, fresh };
}
