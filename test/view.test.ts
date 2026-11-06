import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockEnv, startMock } from "../mock/server.ts";
import { loadConfig } from "../src/config.ts";
import { dict, hintText } from "../src/i18n.ts";
import { startServer } from "../src/server.ts";
import type { ServerMessage, ViewData } from "../src/view.ts";

const dir = await mkdtemp(join(tmpdir(), "view-"));
const mock = startMock(0);
const cfg = loadConfig({ ...mockEnv(mock.url.origin), OUT_DIR: dir, HOST: "127.0.0.1", PORT: "0", POLL_SECONDS: "3600" });
const app = await startServer(cfg);
await app.poll();
const base = app.server.url.origin;

afterAll(async () => {
  app.stop();
  mock.stop(true);
  await rm(dir, { recursive: true, force: true });
});

test("GET /api/view: the view as JSON, no text in any language", async () => {
  const res = await fetch(`${base}/api/view`);
  expect(res.status).toBe(200);
  const v = (await res.json()) as ViewData;
  expect(v.snapshot.prs.length).toBeGreaterThan(0);
  expect(v.sources).toContain("jira");
  expect(Array.isArray(v.muted)).toBe(true);
  expect(v.hints.length).toBeGreaterThan(0);
  for (const h of v.hints) {
    expect(h).not.toHaveProperty("text");
    // every message can be put into words, in both languages
    expect(hintText(dict("en"), h.msg)).not.toBe("");
    expect(hintText(dict("de"), h.msg)).not.toBe(hintText(dict("en"), h.msg));
  }
});

test("/ws?v=2 sends the view as JSON on connect", async () => {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?v=2`);
  const msg = await new Promise<ServerMessage>((resolve, reject) => {
    ws.onmessage = (e) => resolve(JSON.parse(String(e.data)));
    ws.onerror = reject;
  });
  ws.close();
  expect(msg.type).toBe("view");
  if (msg.type === "view") expect(msg.view.defaultLang).toBe(cfg.lang);
});

test("/ws without v=2 still gets the old page's HTML", async () => {
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws`);
  const msg = await new Promise<{ type: string; html?: string }>((resolve, reject) => {
    ws.onmessage = (e) => resolve(JSON.parse(String(e.data)));
    ws.onerror = reject;
  });
  ws.close();
  expect(msg.type).toBe("view");
  expect(msg.html).toContain("<aside");
});
