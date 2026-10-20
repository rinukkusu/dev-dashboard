// Live server against the mock, polling fast so you can watch updates arrive (and hear the sound).
//   bun run dev   → http://localhost:3000
// To try "+ Watch", paste <mock>/gh/acme/tools/actions/runs/600 (a deploy that finishes a bit later).
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { mockEnv, startMock } from "./server.ts";

const mock = startMock(0);

const cfg = loadConfig({
  ...mockEnv(mock.url.origin),
  OUT_DIR: "./out-demo",
  DASHBOARD_LANG: Bun.env.DASHBOARD_LANG,
  HOST: Bun.env.HOST ?? "127.0.0.1",
  PORT: Bun.env.PORT ?? "3000",
  POLL_SECONDS: Bun.env.POLL_SECONDS ?? "15",
});

// resolve(): Bun on Windows fails recursive rm on "./dir" with ENOENT, which force: true hides.
await rm(resolve(cfg.outDir), { recursive: true, force: true });
await startServer(cfg);
console.log(`Mock at ${mock.url} – try watching ${mock.url.origin}/gh/acme/tools/actions/runs/600`);
