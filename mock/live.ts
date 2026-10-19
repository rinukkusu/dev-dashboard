// Live server against the mock, polling fast so you can watch updates arrive (and hear the sound).
//   bun run dev   → http://localhost:3000
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { startMock } from "./server.ts";

const mock = startMock(0);
const base = mock.url.origin;

const cfg = loadConfig({
  JIRA_BASE_URL: `${base}/jira`,
  JIRA_PAT: "demo",
  JIRA_PROJECT_KEYS: "ABC",
  ADO_ORG_URL: `${base}/ado`,
  ADO_PROJECT: "Shop",
  ADO_PAT: "demo",
  OUT_DIR: "./out-demo",
  PORT: Bun.env.PORT ?? "3000",
  POLL_SECONDS: Bun.env.POLL_SECONDS ?? "15",
});

// resolve(): Bun on Windows fails recursive rm on "./dir" with ENOENT, which force: true hides.
await rm(resolve(cfg.outDir), { recursive: true, force: true });
await startServer(cfg);
