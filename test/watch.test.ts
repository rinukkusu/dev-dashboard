import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { buildView, type State } from "../src/engine.ts";
import type { Prefs, Watch } from "../src/model.ts";
import { addWatch, setMuted } from "../src/prefs.ts";
import { createSources } from "../src/sources/index.ts";

const cfg = loadConfig({
  JIRA_PAT: "x",
  JIRA_BASE_URL: "https://jira.example.com/",
  ADO_PAT: "x",
  ADO_ORG_URL: "https://dev.azure.com/acme",
  ADO_PROJECT: "Shop",
  GITHUB_TOKEN: "x",
  GHE_TOKEN: "x",
  GHE_URL: "https://git.example.com",
});
const sources = createSources(cfg);
const prefs = (): Prefs => ({ watches: [], muted: [] });

describe("watch links", () => {
  const cases: [string, string, Watch["kind"]][] = [
    ["https://github.com/Acme/App/pull/12", "github:acme/app#12", "pr"],
    ["https://github.com/acme/app/issues/5#issuecomment-1", "github:acme/app#5", "issue"],
    ["https://github.com/acme/app/actions/runs/123456/job/789", "github:acme/app/runs/123456", "run"],
    ["https://git.example.com/team/svc/pull/3/files", "ghe:team/svc#3", "pr"],
    ["https://dev.azure.com/acme/Shop/_git/shop-api/pullrequest/412", "ado:pr:412", "pr"],
    ["https://dev.azure.com/acme/Other%20Project/_build/results?buildId=55&view=logs", "ado:build:55", "run"],
    ["https://jira.example.com/browse/abc-101", "jira:ABC-101", "issue"],
  ];
  for (const [url, id, kind] of cases) {
    test(url, () => {
      const result = addWatch(prefs(), sources, url);
      expect(result.ok && { id: result.watch.id, kind: result.watch.kind }).toEqual({ id, kind });
    });
  }

  test("ADO links keep their project, so other projects work too", () => {
    const r = addWatch(prefs(), sources, "https://dev.azure.com/acme/Other%20Project/_build/results?buildId=55");
    expect(r.ok && r.watch.locator.project).toBe("Other Project");
  });

  test("unknown hosts, other paths and garbage are rejected", () => {
    for (const url of ["https://gitlab.com/a/b/-/merge_requests/1", "https://github.com/acme/app", "not a url", "https://jira.example.com.evil.com/browse/ABC-1"]) {
      expect(addWatch(prefs(), sources, url)).toEqual({ ok: false, error: "unsupported" });
    }
  });

  test("the same thing twice", () => {
    const p = prefs();
    addWatch(p, sources, "https://github.com/acme/app/pull/1");
    expect(addWatch(p, sources, "https://github.com/ACME/app/pull/1")).toEqual({ ok: false, error: "exists" });
  });
});

test("muting hides the hint, but keeps the item", () => {
  const state: State = {
    version: 2,
    memos: {},
    changes: [],
    snapshot: {
      takenAt: new Date().toISOString(),
      errors: [],
      runs: [],
      issues: [],
      prs: [{
        id: "github:acme/app#1", source: "github", ref: "app#1", number: 1, title: "Fix", url: "u", repo: "acme/app",
        branch: "fix", targetBranch: "main", author: "Me", role: "author", status: "active", createdAt: new Date().toISOString(),
        isDraft: false, hasConflicts: true, reviewers: [], openThreads: 0, comments: [], ticketKeys: [],
      }],
    },
  };
  const p = prefs();
  expect(buildView(cfg, state, p, sources).hints).toHaveLength(1);
  setMuted(p, "github:acme/app#1", true);
  expect(buildView(cfg, state, p, sources).hints).toHaveLength(0);
  expect(buildView(cfg, state, p, sources).snapshot.prs).toHaveLength(1);
});
