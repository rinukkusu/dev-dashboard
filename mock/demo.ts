// Runs the dashboard twice against the mock: first run = baseline, second run = changes.
//   bun run demo   → out-demo/dashboard.html
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { runOnce } from "../src/main.ts";
import { startMock } from "./server.ts";

const server = startMock(0); // random free port
const base = server.url.origin;

const cfg = loadConfig({
  JIRA_BASE_URL: `${base}/jira`,
  JIRA_PAT: "demo",
  JIRA_PROJECT_KEYS: "ABC",
  ADO_ORG_URL: `${base}/ado`,
  ADO_PROJECT: "Shop",
  ADO_PAT: "demo",
  OUT_DIR: "./out-demo",
  DASHBOARD_LANG: Bun.env.DASHBOARD_LANG,
});

// resolve(): Bun on Windows fails recursive rm on "./dir" with ENOENT, which force: true hides.
await rm(resolve(cfg.outDir), { recursive: true, force: true });
await runOnce(cfg);
await runOnce(cfg);
server.stop(true);
console.log(`Done – open ${cfg.outDir}/dashboard.html`);
