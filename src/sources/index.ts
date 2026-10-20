import type { Config } from "../config.ts";
import { createAdoSource } from "./ado.ts";
import { createGithubSource } from "./github.ts";
import { createJiraSource } from "./jira.ts";
import type { Source } from "./types.ts";

/** Every source whose token is configured. */
export function createSources(cfg: Config): Source[] {
  return [
    cfg.ado && createAdoSource(cfg.ado),
    cfg.github && createGithubSource(cfg.github),
    cfg.ghe && createGithubSource(cfg.ghe),
    cfg.jira && createJiraSource(cfg.jira),
  ].filter((s): s is Source => !!s);
}

export type { Source } from "./types.ts";
