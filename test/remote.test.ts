import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import type { Herdr } from "../src/herdr.ts";
import { HerdrError } from "../src/herdr.ts";
import type { Space } from "../src/model.ts";
import { allowedFrom, loadDevices, PAIR_TTL_MS } from "../src/remote-auth.ts";
import { pairUrls, startRemote } from "../src/remote.ts";

const dir = await mkdtemp(join(tmpdir(), "remote-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("allowedFrom: this machine always, others only from the listed ranges", () => {
  const allow = ["192.168.0.0/24", "10.1.2.3"];
  expect(allowedFrom("127.0.0.1", [])).toBe(true);
  expect(allowedFrom("::1", [])).toBe(true);
  expect(allowedFrom("::ffff:127.0.0.1", [])).toBe(true);
  expect(allowedFrom("192.168.0.42", allow)).toBe(true);
  expect(allowedFrom("::ffff:192.168.0.42", allow)).toBe(true);
  expect(allowedFrom("192.168.1.42", allow)).toBe(false);
  expect(allowedFrom("10.1.2.3", allow)).toBe(true);
  expect(allowedFrom("10.1.2.4", allow)).toBe(false);
  expect(allowedFrom("fe80::1", allow)).toBe(false);
  expect(allowedFrom(undefined, allow)).toBe(false);
  expect(allowedFrom("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
});

test("config: the remote control needs herdr and the networks it may be used from", () => {
  const base = { GITHUB_TOKEN: "x" };
  expect(loadConfig(base).remote).toBeUndefined();
  expect(() => loadConfig({ ...base, REMOTE_PORT: "9999", REMOTE_ALLOW: "192.168.0.0/24" })).toThrow(/HERDR_SOCKET/);
  expect(() => loadConfig({ ...base, HERDR_SOCKET: "/s", REMOTE_PORT: "9999" })).toThrow(/REMOTE_ALLOW/);
  expect(() => loadConfig({ ...base, HERDR_SOCKET: "/s", REMOTE_PORT: "9999", REMOTE_ALLOW: "my-wifi" })).toThrow(/my-wifi/);
  expect(() => loadConfig({ ...base, HERDR_SOCKET: "/s", REMOTE_PORT: "9999", REMOTE_ALLOW: "192.168.0.0/24", REMOTE_TLS_CERT: "c.pem" })).toThrow(/go together/);
  expect(loadConfig({ ...base, HERDR_SOCKET: "/s", REMOTE_PORT: "9999", REMOTE_ALLOW: "192.168.0.0/24, 10.0.0.0/8" }).remote).toEqual({
    host: "0.0.0.0",
    port: 9999,
    allow: ["192.168.0.0/24", "10.0.0.0/8"],
    url: undefined,
    tls: undefined,
  });
});

test("pairUrls: REMOTE_URL wins, a fixed host is used as it is", () => {
  const remote = { host: "192.168.0.5", port: 9999, allow: ["192.168.0.0/24"] };
  expect(pairUrls(remote, 9999)).toEqual(["http://192.168.0.5:9999"]);
  expect(pairUrls({ ...remote, url: "https://pc.tail1234.ts.net" }, 9999)).toEqual(["https://pc.tail1234.ts.net"]);
});

test("devices: a code pairs one device, once, and only in time; only the token's hash is stored", async () => {
  const path = join(dir, "devices.json");
  const devices = await loadDevices(path);
  const { code } = devices.newCode(1000);
  expect(await devices.redeem("wrong", "x", 1000)).toBeUndefined();
  const paired = await devices.redeem(code, "iPhone · Safari", 2000);
  expect(paired?.device.name).toBe("iPhone · Safari");
  expect(await devices.redeem(code, "again", 2000)).toBeUndefined(); // used up
  expect(devices.check(paired!.token)?.id).toBe(paired!.device.id);
  expect(devices.check("someone-elses")).toBeUndefined();
  const stored = await readFile(path, "utf8");
  expect(stored).not.toContain(paired!.token);
  // (at the pairing's time: a later one would write lastSeen, racing the first instance's writes)
  expect((await loadDevices(path)).check(paired!.token, 2000)?.id).toBe(paired!.device.id);

  const late = devices.newCode(5000);
  expect(await devices.redeem(late.code, "late", 5000 + PAIR_TTL_MS)).toBeUndefined();
  // a new code replaces the one before
  const first = devices.newCode(5000);
  devices.newCode(5000);
  expect(await devices.redeem(first.code, "old", 5000)).toBeUndefined();

  expect(await devices.revoke(paired!.device.id)).toBe(true);
  expect(devices.check(paired!.token)).toBeUndefined();
});

// --- the server, against a herdr stand-in ---

const spaces: Space[] = [
  {
    id: "w2",
    number: 2,
    label: "DEMA-20 - Form. Versand",
    status: "blocked",
    ticketKeys: ["DEMA-20"],
    focused: true,
    tabs: [{ id: "w2:t1", label: "1" }],
    agents: [{ paneId: "w2:p1", kind: "claude", status: "blocked", cwd: "C:\\secret\\path", tabId: "w2:t1", session: { kind: "id", value: "s1" } }],
  },
];
const prompts: { pane: string; text: string }[] = [];
const keys: { pane: string; keys: string[] }[] = [];
const herdr: Herdr = {
  spaces: () => spaces,
  error: () => undefined,
  refresh: async () => {},
  read: async () => "Allow this? 1. Yes 2. No",
  prompt: async (pane, text) => {
    if (spaces[0]!.agents[0]!.status === "blocked") throw new HerdrError("agent_blocked", "blocked");
    prompts.push({ pane, text });
  },
  keys: async (pane, k) => void keys.push({ pane, keys: k }),
  start: async () => ({ pane: "", sent: false }),
  focus: async () => {},
  stop() {},
};
const devices = await loadDevices(join(dir, "server-devices.json"));
const remote = startRemote({ remote: { host: "127.0.0.1", port: 0, allow: [] }, herdr, devices, claudeProjects: dir, lang: "de" });
afterAll(() => remote.stop());
const base = `http://127.0.0.1:${remote.port}`;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("server: nothing of herdr without pairing", async () => {
  const me = await fetch(`${base}/api/me`);
  expect(me.status).toBe(401);
  expect(await me.json()).toEqual({ error: "not-paired", lang: "de" });
  expect((await fetch(`${base}/api/spaces`)).status).toBe(401);
  expect((await post("/api/prompt", { pane: "w2:p1", text: "hi" })).status).toBe(401);
  expect((await fetch(`${base}/ws`, { headers: { Upgrade: "websocket", Connection: "Upgrade" } })).status).toBe(401);
  expect((await post("/api/pair", { code: "nope", name: "x" })).status).toBe(403);
});

test("server: a paired device sees the spaces without paths, writes and presses keys", async () => {
  const { code } = devices.newCode();
  const paired = await post("/api/pair", { code, name: "Pixel · Chrome" });
  expect(paired.status).toBe(200);
  const setCookie = paired.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Strict");
  expect(paired.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const cookie = setCookie.split(";")[0]!;

  const me = await fetch(`${base}/api/me`, { headers: { cookie } });
  expect((await me.json()).device.name).toBe("Pixel · Chrome");

  const list = (await (await fetch(`${base}/api/spaces`, { headers: { cookie } })).json()) as { spaces: unknown[] };
  expect(JSON.stringify(list)).not.toContain("secret");
  expect(list.spaces).toEqual([
    expect.objectContaining({ id: "w2", label: "DEMA-20 - Form. Versand", agents: [expect.objectContaining({ pane: "w2:p1", status: "blocked", tab: "w2:t1" })] }),
  ]);

  // waiting at a question: a prompt doesn't get through, keys do
  expect((await post("/api/prompt", { pane: "w2:p1", text: "go on" }, { cookie })).status).toBe(409);
  expect((await post("/api/keys", { pane: "w2:p1", keys: ["1"] }, { cookie })).status).toBe(200);
  expect(keys).toEqual([{ pane: "w2:p1", keys: ["1"] }]);
  expect((await post("/api/keys", { pane: "w2:p1", keys: ["rm -rf /"] }, { cookie })).status).toBe(400);
  expect((await post("/api/keys", { pane: "w9:p9", keys: ["1"] }, { cookie })).status).toBe(404);

  spaces[0]!.agents[0]!.status = "idle";
  expect((await post("/api/prompt", { pane: "w2:p1", text: "go on" }, { cookie })).status).toBe(200);
  expect(prompts).toEqual([{ pane: "w2:p1", text: "go on" }]);
  expect(await (await fetch(`${base}/api/read?pane=w2:p1`, { headers: { cookie } })).json()).toEqual({ text: "Allow this? 1. Yes 2. No", status: "idle" });

  // other websites can't make the phone's browser send anything
  expect((await post("/api/prompt", { pane: "w2:p1", text: "x" }, { cookie, origin: "https://evil.example" })).status).toBe(403);
  const form = await fetch(`${base}/api/prompt`, { method: "POST", headers: { cookie, "Content-Type": "text/plain" }, body: "{}" });
  expect(form.status).toBe(415);

  // unpairing ends it
  expect((await post("/api/logout", {}, { cookie })).status).toBe(200);
  expect((await fetch(`${base}/api/spaces`, { headers: { cookie } })).status).toBe(401);
});

test("server: too many wrong codes and the address has to wait", async () => {
  for (let i = 0; i < 5; i++) await post("/api/pair", { code: `wrong-${i}`, name: "x" });
  const { code } = devices.newCode();
  expect((await post("/api/pair", { code, name: "x" })).status).toBe(429);
});
