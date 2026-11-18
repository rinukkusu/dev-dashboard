// Live server against the mock, polling fast so you can watch updates arrive (and hear the sound).
//   bun run dev   → http://localhost:3000
// To try "+ Watch", paste <mock>/gh/acme/tools/actions/runs/600 (a deploy that finishes a bit later).
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { startFakeHerdr } from "./herdr.ts";
import { mockEnv, startMock } from "./server.ts";

const mock = startMock(0);

// resolve(): Bun on Windows fails recursive rm on "./dir" with ENOENT, which force: true hides.
await rm(resolve("./out-demo"), { recursive: true, force: true });

// MOCK_HERDR=1: a pretend herdr with a few agents and their chats (mock/herdr.ts)
const fakeHerdr = Bun.env.MOCK_HERDR && !Bun.env.HERDR_SOCKET ? await startFakeHerdr(resolve("./out-demo/claude-projects")) : undefined;

const cfg = loadConfig({
  ...mockEnv(mock.url.origin),
  OUT_DIR: "./out-demo",
  DASHBOARD_LANG: Bun.env.DASHBOARD_LANG,
  HOST: Bun.env.HOST ?? "127.0.0.1",
  PORT: Bun.env.PORT ?? "3000",
  POLL_SECONDS: Bun.env.POLL_SECONDS ?? "15",
  // to try herdr against the mock data
  HERDR_SOCKET: fakeHerdr?.address ?? Bun.env.HERDR_SOCKET,
  HERDR_WORKDIR: Bun.env.HERDR_WORKDIR,
  PROMPTS_FILE: Bun.env.PROMPTS_FILE,
  CLAUDE_PROJECTS_DIR: fakeHerdr ? resolve("./out-demo/claude-projects") : Bun.env.CLAUDE_PROJECTS_DIR,
  // the remote control; with the pretend herdr (`bun run dev:remote`) on 127.0.0.1:9999 unless set
  REMOTE_PORT: Bun.env.REMOTE_PORT ?? (fakeHerdr ? "9999" : undefined),
  REMOTE_HOST: Bun.env.REMOTE_HOST ?? (fakeHerdr ? "127.0.0.1" : undefined),
  REMOTE_ALLOW: Bun.env.REMOTE_ALLOW ?? (fakeHerdr ? "127.0.0.1/32" : undefined),
  REMOTE_URL: Bun.env.REMOTE_URL,
  REMOTE_TLS: Bun.env.REMOTE_TLS,
  REMOTE_HTTP_PORT: Bun.env.REMOTE_HTTP_PORT,
  REMOTE_TLS_CERT: Bun.env.REMOTE_TLS_CERT,
  REMOTE_TLS_KEY: Bun.env.REMOTE_TLS_KEY,
});
await startServer(cfg);
console.log(`Mock at ${mock.url} – try watching ${mock.url.origin}/gh/acme/tools/actions/runs/600`);
