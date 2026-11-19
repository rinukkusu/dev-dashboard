import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import type { Herdr } from "../src/herdr.ts";
import { HerdrError } from "../src/herdr.ts";
import type { Space } from "../src/model.ts";
import { allowedFrom, loadDevices, PAIR_TTL_MS } from "../src/remote-auth.ts";
import { PUBLIC, pairUrls, startRemote } from "../src/remote.ts";
import { questionOf } from "../src/question.ts";
import { agentEvents, loadVapid, questionLine } from "../src/remote-push.ts";
import { autoTls } from "../src/remote-tls.ts";
import forge from "node-forge";

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
    httpPort: 10000,
    files: null,
    uploads: { host: expect.stringMatching(/out[\\/]uploads$/), local: expect.stringMatching(/out[\\/]uploads$/) },
  });
  // in Docker: the folders as the agents name them, and where they're mounted
  const docker = loadConfig({
    ...base,
    HERDR_SOCKET: "/s",
    REMOTE_PORT: "9999",
    REMOTE_ALLOW: "192.168.0.0/24",
    REMOTE_FILES: String.raw`C:\Users\me\AppData\Local\Temp\claude=/host/claude-tmp, D:\Reports\=/host/reports/`,
    REMOTE_UPLOADS: String.raw`C:\Users\me\dev-dashboard-uploads=/uploads`,
  }).remote;
  expect(docker?.files).toEqual([
    { host: String.raw`C:\Users\me\AppData\Local\Temp\claude`, local: "/host/claude-tmp" },
    { host: String.raw`D:\Reports`, local: "/host/reports" },
  ]);
  expect(docker?.uploads).toEqual({ host: String.raw`C:\Users\me\dev-dashboard-uploads`, local: "/uploads" });
  const auto = loadConfig({ ...base, HERDR_SOCKET: "/s", REMOTE_PORT: "9999", REMOTE_ALLOW: "192.168.0.0/24", REMOTE_TLS: "auto" }).remote;
  expect(auto?.tls).toBe("auto");
  expect(() => loadConfig({ ...base, HERDR_SOCKET: "/s", REMOTE_PORT: "9999", REMOTE_ALLOW: "192.168.0.0/24", REMOTE_TLS: "auto", REMOTE_TLS_CERT: "c", REMOTE_TLS_KEY: "k" })).toThrow(/auto/);
});

test("autoTls: one CA, kept; server certificates from it for the addresses", async () => {
  const tlsDir = join(dir, "tls");
  const first = await autoTls(tlsDir, ["192.168.0.23", "localhost"]);
  const again = await autoTls(tlsDir, ["192.168.0.42"]);
  expect(again.fingerprint).toBe(first.fingerprint);
  expect(first.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  // the server certificate checks out against the CA, for the address it's for
  const ca = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(again.caDer).toString("binary"))));
  const server = forge.pki.certificateFromPem(again.cert);
  expect(ca.verify(server)).toBe(true);
  const alt = server.getExtension("subjectAltName") as { altNames: { ip?: string }[] };
  expect(alt.altNames.map((n) => n.ip).filter(Boolean)).toEqual(["192.168.0.42"]);
  expect((ca.getExtension("basicConstraints") as { cA: boolean }).cA).toBe(true);
  // the CA's key stays on this machine: the phone gets the certificate only
  expect(Buffer.from(again.caDer).toString("binary")).not.toContain("PRIVATE");
});

test("REMOTE_TLS=auto: HTTPS with the made certificate, the CA over plain HTTP, the rest sent on", async () => {
  const tlsDir = join(dir, "tls-server");
  const r = await startRemote({ remote: { host: "127.0.0.1", port: 0, allow: [], tls: "auto", httpPort: 0, files: null, uploads: { host: dir, local: dir } }, herdr, devices, claudeProjects: dir, lang: "en", dataDir: tlsDir });
  try {
    expect(r.ca?.urls).toEqual([expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/ca\.crt$/)]);
    const caRes = await fetch(r.ca!.urls[0]!);
    expect(caRes.headers.get("content-type")).toBe("application/x-x509-ca-cert");
    const der = new Uint8Array(await caRes.arrayBuffer());
    const caPem = forge.pki.certificateToPem(forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(der).toString("binary")))));
    // trusting only that CA, HTTPS works
    const me = await fetch(`https://127.0.0.1:${r.port}/api/me`, { tls: { ca: caPem } });
    expect(me.status).toBe(401);
    // without it, it doesn't
    await expect(fetch(`https://127.0.0.1:${r.port}/api/me`)).rejects.toThrow();
    const redirect = await fetch(r.ca!.urls[0]!.replace("/ca.crt", "/pair"), { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`https://127.0.0.1:${r.port}/pair`);
  } finally {
    r.stop();
  }
});

test("questionOf: the question box from the rule above it on, and a key per choice", () => {
  const screen = `● PR 28979 für 4.0 ist offen. Jetzt prüfe ich noch das Base-Image.

  Ran 1 shell command
────────────────────────────────────────
 ☐ nginx base

│ Alle laufen auf base/nginx:1.28.0. Wie sollen wir das fixen?

❯ 1. kms-baseimages zuerst (Recommended)
     PR in kms-baseimages, danach die Projekte.
  2. JP direkt auf offizielles nginx
  3. Beides
  4. Vorerst nichts
  5. Type something.
────────────────────────────────────────
  6. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel



`;
  const q = questionOf(screen);
  expect(q.choices).toEqual([1, 2, 3, 4, 5, 6]);
  expect(q.text.split("\n")[0]).toBe(" ☐ nginx base");
  expect(q.text).toContain("Wie sollen wir das fixen?");
  expect(q.text).not.toContain("Ran 1 shell command");
  expect(q.text).not.toContain("────");
  expect(q.text.endsWith("Esc to cancel")).toBe(true);
  // no rule, no numbers: the bottom of the screen and the usual three
  expect(questionOf("a\nb\nPress enter to continue\n\n")).toEqual({ text: "a\nb\nPress enter to continue", choices: [1, 2, 3] });
});

test("installable: the manifest's icons include PNGs of 192 and 512 px and a maskable one, all handed out", async () => {
  type Icon = { src: string; sizes: string; type: string; purpose: string };
  const manifest = (await Bun.file(join(import.meta.dir, "../web/public/remote.webmanifest")).json()) as { id: string; display: string; icons: Icon[] };
  expect(manifest).toMatchObject({ id: "/", display: "standalone" });
  const png = manifest.icons.filter((i) => i.type === "image/png");
  expect(png.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  expect(PUBLIC.has("/remote.webmanifest")).toBe(true);
  // the service worker and the notifications' status bar icon
  for (const f of ["/sw.js", "/remote-badge.png"]) {
    expect(PUBLIC.has(f)).toBe(true);
    expect(await Bun.file(join(import.meta.dir, "../web/public", f)).exists()).toBe(true);
  }
  for (const i of manifest.icons) {
    expect(PUBLIC.has(i.src)).toBe(true);
    expect(await Bun.file(join(import.meta.dir, "../web/public", i.src)).exists()).toBe(true);
  }
});

test("pairUrls: REMOTE_URL wins, a fixed host is used as it is", () => {
  const remote = { host: "192.168.0.5", port: 9999, allow: ["192.168.0.0/24"], httpPort: 10000, files: null, uploads: { host: "/u", local: "/u" } };
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
/** what went to the push service; an endpoint with "gone" in it answers like an uninstalled app */
const pushed: { endpoint: string; msg: { title: string; body: string; tag: string; url: string } }[] = [];
const pushSend = async (target: { endpoint: string }, payload: string) => {
  if (target.endpoint.includes("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
  pushed.push({ endpoint: target.endpoint, msg: JSON.parse(payload) });
};
/** the agents' folders as they name them (Windows) and where this server has them */
const shared = { host: String.raw`C:\Users\me\Temp\claude`, local: join(dir, "shared") };
const uploads = { host: String.raw`C:\Users\me\uploads`, local: join(dir, "uploads") };
const remote = await startRemote({ remote: { host: "127.0.0.1", port: 0, allow: [], httpPort: 0, files: [shared], uploads }, herdr, devices, claudeProjects: dir, lang: "de", dataDir: dir, pushSend });
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
  // Lax: a file opened from the installed app opens in the browser, which counts as another app
  expect(setCookie).toContain("SameSite=Lax");
  expect(paired.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  const cookie = setCookie.split(";")[0]!;

  const me = await fetch(`${base}/api/me`, { headers: { cookie } });
  expect((await me.json()).device.name).toBe("Pixel · Chrome");
  // every start renews it – as it's made now (a device paired with a Strict cookie gets a Lax one)
  expect(me.headers.get("set-cookie")).toStartWith(`${cookie}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);

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

test("push: an agent that starts waiting or finishes, once – not the first look, not herdr flickering", () => {
  const events = agentEvents();
  const at = (status: Space["agents"][number]["status"], extra: Space["agents"] = []): Space[] => [
    { ...spaces[0]!, agents: [{ paneId: "w2:p1", status }, ...extra] },
  ];
  const seen = (s: Space[], now: number) => events(s, now).map((e) => `${e.agent.paneId} ${e.status}`);
  expect(seen(at("blocked"), 0)).toEqual([]); // the baseline
  expect(seen(at("working"), 1000)).toEqual([]);
  expect(seen(at("done"), 2000)).toEqual(["w2:p1 done"]);
  expect(seen(at("done"), 3000)).toEqual([]);
  expect(seen(at("working"), 4000)).toEqual([]);
  expect(seen(at("done"), 5000)).toEqual([]); // done again 3 s later: flicker
  expect(seen(at("blocked"), 6000)).toEqual(["w2:p1 blocked"]);
  // new agents: one that asks right away counts, one that's already done doesn't
  expect(seen(at("blocked", [{ paneId: "w3:p1", status: "blocked" }, { paneId: "w4:p1", status: "done" }]), 7000)).toEqual(["w3:p1 blocked"]);
  expect(seen(at("working"), 60_000)).toEqual([]);
  expect(seen(at("done"), 61_000)).toEqual(["w2:p1 done"]);
});

test("push: the question's header and text for the notification; VAPID keys made once", async () => {
  const screen = `● Plan steht.
────────────────
 ☐ nginx base

│ Wie sollen wir das fixen?

❯ 1. So
  2. Anders
`;
  expect(questionLine(screen)).toBe("nginx base – Wie sollen wir das fixen?");
  const vapidDir = await mkdtemp(join(tmpdir(), "vapid-"));
  const first = await loadVapid(vapidDir);
  expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  expect(await loadVapid(vapidDir)).toEqual(first);
  await rm(vapidDir, { recursive: true, force: true });
});

test("server: push notifications – subscribe, test, an agent that waits, a subscription that's gone", async () => {
  const { code } = devices.newCode();
  const cookie = ((await post("/api/pair", { code, name: "Pixel · Chrome" })).headers.get("set-cookie") ?? "").split(";")[0]!;
  const get = async () => (await (await fetch(`${base}/api/push`, { headers: { cookie } })).json()) as { publicKey: string; subscribed: boolean };
  const del = () => fetch(`${base}/api/push`, { method: "DELETE", headers: { cookie, "Content-Type": "application/json" }, body: "{}" });
  const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: "BPk", auth: "x1" } });

  expect((await fetch(`${base}/api/push`)).status).toBe(401);
  expect(await get()).toEqual({ publicKey: expect.stringMatching(/^[A-Za-z0-9_-]{80,}$/), subscribed: false });
  expect((await post("/api/push/test", {}, { cookie })).status).toBe(409);
  // only an https push service
  expect((await post("/api/push", { subscription: sub("http://push.example/1") }, { cookie })).status).toBe(400);
  expect((await post("/api/push", { subscription: { endpoint: "https://push.example/1" } }, { cookie })).status).toBe(400);
  expect((await post("/api/push", { subscription: sub("https://push.example/1"), lang: "en" }, { cookie })).status).toBe(200);
  expect((await get()).subscribed).toBe(true);

  expect((await post("/api/push/test", {}, { cookie })).status).toBe(200);
  expect(pushed.at(-1)).toEqual({ endpoint: "https://push.example/1", msg: { title: "herdr", body: "Notifications work.", tag: "test", url: "/" } });

  // the agent starts waiting: a notification in the device's language, with the question
  spaces[0]!.agents[0]!.status = "idle";
  remote.publish();
  spaces[0]!.agents[0]!.status = "blocked";
  remote.publish();
  await Bun.sleep(50);
  expect(pushed.at(-1)?.msg).toEqual({ title: "DEMA-20 - Form. Versand is waiting for you", body: "Allow this? 1. Yes 2. No", tag: "w2:p1", url: "/#/agent/w2%3Ap1" });
  const count = pushed.length;
  remote.publish();
  await Bun.sleep(50);
  expect(pushed.length).toBe(count); // nothing new

  // the phone dropped the subscription: the push service says so, the server forgets it
  await post("/api/push", { subscription: sub("https://push.example/gone") }, { cookie });
  spaces[0]!.agents[0]!.status = "done";
  remote.publish();
  await Bun.sleep(50);
  expect((await get()).subscribed).toBe(false);

  await post("/api/push", { subscription: sub("https://push.example/2") }, { cookie });
  expect((await del()).status).toBe(200);
  expect((await get()).subscribed).toBe(false);
  spaces[0]!.agents[0]!.status = "blocked";
});

test("server: the chats – every agent with when its conversation last moved and the last thing said", async () => {
  const { code } = devices.newCode();
  const cookie = ((await post("/api/pair", { code, name: "Pixel · Chrome" })).headers.get("set-cookie") ?? "").split(";")[0]!;
  const line = (o: object) => JSON.stringify(o) + "\n";
  await Bun.write(
    join(dir, "C--secret-path", "s1.jsonl"),
    line({ type: "user", timestamp: "2026-11-19T07:00:00.000Z", message: { content: "Mach mal die Pipelines grün" } }) +
      line({ type: "assistant", timestamp: "2026-11-19T07:01:00.000Z", message: { content: [{ type: "text", text: "## **Plan** steht\n\nZuerst `nginx`." }] } }) +
      line({ type: "assistant", timestamp: "2026-11-19T07:02:00.000Z", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "trivy image x" } }] } }),
  );
  const res = await fetch(`${base}/api/chats`, { headers: { cookie } });
  expect(await res.json()).toEqual({ chats: [{ pane: "w2:p1", at: "2026-11-19T07:02:00.000Z", role: "assistant", text: "Plan steht" }] });
  expect((await fetch(`${base}/api/chats`)).status).toBe(401);
});

test("server: files – the phone sends one, and opens only what the agent's chat shows", async () => {
  const { code } = devices.newCode();
  const cookie = ((await post("/api/pair", { code, name: "Pixel · Chrome" })).headers.get("set-cookie") ?? "").split(";")[0]!;
  const me = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as { files: { roots: string[] } };
  expect(me.files.roots).toEqual([shared.host, uploads.host]);

  // from the phone: the file itself, kept in the uploads folder under a safe name
  const upload = (body: BodyInit, type = "application/octet-stream", name = "Foto vom Fehler (1).JPG") =>
    fetch(`${base}/api/upload?name=${encodeURIComponent(name)}`, { method: "POST", headers: { cookie, "Content-Type": type }, body });
  const sent = await upload(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
  expect(sent.status).toBe(200);
  const { path } = (await sent.json()) as { path: string };
  expect(path).toMatch(/^C:\\Users\\me\\uploads\\\d{4}-\d\d-\d\d\\\d{6}-[0-9a-f]{4}-Foto_vom_Fehler_1_\.JPG$/);
  const day = path.split("\\").at(-2)!;
  const name = path.split("\\").at(-1)!;
  expect(await Bun.file(join(uploads.local, day, name)).bytes()).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]));
  expect((await upload("x", "text/plain")).status).toBe(415); // what a form on another site could send
  expect((await upload(new Uint8Array())).status).toBe(400);
  expect((await fetch(`${base}/api/upload?name=x`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "x" })).status).toBe(401);

  // to the phone: what the chat names – the picture sent, a screenshot the agent made
  await Bun.write(join(shared.local, "s1", "scratchpad", "shot.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  await Bun.write(join(shared.local, "s1", "scratchpad", "page.html"), "<script>alert(1)</script>");
  await Bun.write(join(shared.local, "s1", "scratchpad", "secret.png"), "not named in the chat");
  const line = (o: object) => JSON.stringify(o) + "\n";
  const at = (rest: string) => shared.host + rest;
  await Bun.write(
    join(dir, "C--secret-path", "s1.jsonl"),
    line({ type: "user", message: { content: `Was ist da kaputt?\n\n📎 ${path}` } }) +
      line({
        type: "assistant",
        message: {
          content: [{ type: "text", text: `Siehe \`${at(String.raw`\s1\scratchpad\shot.png`)}\` und ${at(String.raw`\s1\scratchpad\page.html`)} – nicht ${at(String.raw`\..\escape.png`)}.` }],
        },
      }),
  );
  const file = (p: string) => fetch(`${base}/api/file?pane=w2:p1&path=${encodeURIComponent(p)}`, { headers: { cookie } });
  const shot = await file(at(String.raw`\s1\scratchpad\shot.png`));
  expect(shot.status).toBe(200);
  expect(shot.headers.get("content-type")).toBe("image/png");
  expect(shot.headers.get("content-disposition")).toStartWith("inline");
  expect(shot.headers.get("content-security-policy")).toContain("sandbox");
  expect((await file(path)).status).toBe(200);
  // a page the agent made: shown, but nothing in it runs as the remote's page
  const page = await file(at(String.raw`\s1\scratchpad\page.html`));
  expect(page.headers.get("content-security-policy")).toContain("sandbox");
  expect(page.headers.get("content-security-policy")).not.toContain("script-src");
  // not named in the chat, out of the folders, someone else's agent, no pairing
  expect((await file(at(String.raw`\s1\scratchpad\secret.png`))).status).toBe(404);
  expect((await file(at(String.raw`\..\escape.png`))).status).toBe(404);
  expect((await fetch(`${base}/api/file?pane=w9:p9&path=${encodeURIComponent(path)}`, { headers: { cookie } })).status).toBe(404);
  expect((await fetch(`${base}/api/file?pane=w2:p1&path=${encodeURIComponent(path)}`)).status).toBe(401);
});

test("server: too many wrong codes and the address has to wait", async () => {
  for (let i = 0; i < 5; i++) await post("/api/pair", { code: `wrong-${i}`, name: "x" });
  const { code } = devices.newCode();
  expect((await post("/api/pair", { code, name: "x" })).status).toBe(429);
});
