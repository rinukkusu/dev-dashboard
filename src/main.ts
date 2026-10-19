import { rename } from "node:fs/promises";
import { join } from "node:path";
import { createAdoClient } from "./ado.ts";
import { loadConfig, type Config } from "./config.ts";
import { link, makeKeyExtractor } from "./correlate.ts";
import { diff, mergeLog } from "./diff.ts";
import { createJiraClient } from "./jira.ts";
import type { Change, Snapshot } from "./model.ts";
import { renderHtml } from "./render.ts";
import { evaluate } from "./rules.ts";

type State = { snapshot: Snapshot; changes: Change[] };

async function loadState(path: string): Promise<State | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    return (await file.json()) as State;
  } catch {
    return undefined; // corrupt state → behave like a first run
  }
}

/** Write to a temp file and rename, so the browser never reloads a half-written page. */
async function writeAtomic(path: string, content: string) {
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, content);
  await rename(tmp, path);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runOnce(cfg: Config) {
  const statePath = join(cfg.outDir, "state.json");
  const htmlPath = join(cfg.outDir, "dashboard.html");
  const state = await loadState(statePath);
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

  const links = link(prs, issues);
  const hints = evaluate(snapshot, {
    ...links,
    postMergeStatuses: cfg.jira?.postMergeStatuses ?? [],
    now: Date.now(),
  });

  await writeAtomic(
    htmlPath,
    renderHtml({
      snapshot,
      changes,
      hints,
      links,
      refreshSeconds: cfg.refreshSeconds,
      sources: { jira: !!cfg.jira, ado: !!cfg.ado },
    }),
  );
  await writeAtomic(statePath, JSON.stringify({ snapshot, changes } satisfies State));

  const stamp = new Date().toLocaleTimeString("de-AT");
  console.log(
    `[${stamp}] ${prs.length} PRs, ${issues.length} Tickets, ${fresh.length} neue Änderungen, ${hints.length} Hinweise → ${htmlPath}`,
  );
  for (const e of errors) console.error(`[${stamp}] Fehler: ${e}`);
  return { snapshot, changes, hints, fresh };
}

if (import.meta.main) {
  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch (e) {
    console.error(message(e));
    process.exit(1);
  }

  if (process.argv.includes("--loop")) {
    // Alternative to cron: keep running and refresh every LOOP_MINUTES.
    for (;;) {
      await runOnce(cfg).catch((e) => console.error(message(e)));
      await Bun.sleep(cfg.loopMinutes * 60_000);
    }
  } else {
    await runOnce(cfg);
  }
}
