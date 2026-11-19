// The remote control for herdr: a second, small web app for the phone (web/remote.html) on its own
// port, open to the local network – the dashboard itself stays on localhost. It only knows herdr:
// the spaces with their tabs and agents, an agent's chat or terminal, writing to it and pressing
// keys at its questions. Nothing of the sources (tokens, tickets, PRs) is reachable from here.
//
// Who gets in: requests only from REMOTE_ALLOW's networks (and this machine), the API only with
// the cookie of a paired device (remote-auth.ts). Changes need JSON from this very origin.
import { networkInterfaces } from "node:os";
import { join, resolve, sep } from "node:path";
import type { ServerWebSocket } from "bun";
import type { Config } from "./config.ts";
import { HerdrError, type Herdr } from "./herdr.ts";
import { message } from "./http.ts";
import { isLang } from "./i18n.ts";
import type { Agent, Space } from "./model.ts";
import { allowedFrom, type Devices, type PushTarget } from "./remote-auth.ts";
import { loadVapid, startPush, type Send } from "./remote-push.ts";
import { autoTls } from "./remote-tls.ts";
import { fileName, filePaths, messageFiles } from "./files.ts";
import { fileHeaders, saveUpload, toLocal } from "./remote-files.ts";
import { agentChat, agentLast } from "./transcript.ts";
import type { RemoteMessage, RemoteSpace } from "./view.ts";

type RemoteConfig = NonNullable<Config["remote"]>;

export const remoteSpaces = (spaces: Space[]): RemoteSpace[] =>
  spaces.map((s) => ({
    id: s.id,
    label: s.label,
    status: s.status,
    focused: s.focused,
    tabs: s.tabs ?? [],
    agents: s.agents.map((a) => ({ pane: a.paneId, kind: a.kind, name: a.name, status: a.status, title: a.title, tab: a.tabId, focused: a.focused })),
  }));

const COOKIE = "rc";
/** keys the quick buttons send; herdr checks them too, this keeps the request small and plain */
const KEY = /^[a-z0-9+]{1,12}$/i;

const WEB_DIR = resolve(import.meta.dir, "../dist/web");
/** the only files of dist/web this server hands out besides the built assets: the service worker, the manifest and its icons */
export const PUBLIC = new Set(["/sw.js", "/remote.webmanifest", "/remote-icon.svg", "/remote-icon-192.png", "/remote-icon-512.png", "/remote-icon-maskable-512.png", "/remote-badge.png"]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

/** a file from the phone: at most this big */
export const UPLOAD_MAX = 50 * 1024 * 1024;

/** (a file's own, stricter CSP stays) */
const withHeaders = (res: Response) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
  return res;
};
/** A subscription as the browser's PushSubscription.toJSON() has it – only to an https push service. */
function pushTarget(sub: unknown, lang: unknown): PushTarget | undefined {
  const s = sub as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const ok = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!ok(s?.endpoint, 2048) || !ok(s?.keys?.p256dh, 200) || !ok(s?.keys?.auth, 100)) return undefined;
  if (!URL.canParse(s.endpoint) || new URL(s.endpoint).protocol !== "https:") return undefined;
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, ...(isLang(lang) ? { lang } : {}) };
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });
const isJson = (req: Request) => req.headers.get("content-type")?.startsWith("application/json") ?? false;
/** an upload is the file itself – a type no plain form on another site can send without asking first, like JSON */
const isFile = (req: Request) => req.headers.get("content-type") === "application/octet-stream";
const cookie = (req: Request, name: string) => req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];

/** The addresses the phone can reach this machine at: REMOTE_HOST if it's one, otherwise its own in the allowed networks. */
export function remoteHosts(remote: RemoteConfig): string[] {
  if (remote.host !== "0.0.0.0" && remote.host !== "::") return [remote.host];
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && allowedFrom(i.address, remote.allow))
    .map((i) => i!.address);
  return [...new Set(ips)];
}

/** The remote's address(es) for the pairing QR code: REMOTE_URL, or this machine's. */
export function pairUrls(remote: RemoteConfig, port: number): string[] {
  if (remote.url) return [remote.url];
  const proto = remote.tls ? "https" : "http";
  return remoteHosts(remote).map((h) => `${proto}://${h}:${port}`);
}

type Socket = ServerWebSocket<{ device: string }>;

export type Remote = {
  port: number;
  /** REMOTE_TLS=auto: where the phone gets the CA (plain HTTP), and its fingerprint to compare */
  ca?: { urls: string[]; fingerprint: string };
  /** herdr changed: tell the open phones */
  publish(): void;
  /** a revoked device's open connections end at once */
  kick(deviceId: string): void;
  stop(): void;
};

export async function startRemote(opts: {
  remote: RemoteConfig;
  herdr: Herdr;
  devices: Devices;
  claudeProjects: string;
  lang: string;
  dataDir: string;
  /** tests: instead of the push service */
  pushSend?: Send;
}): Promise<Remote> {
  const { remote, herdr, devices } = opts;
  const push = startPush({ vapid: await loadVapid(opts.dataDir), devices, read: (pane) => herdr.read(pane, 80), lang: opts.lang, send: opts.pushSend });
  // REMOTE_TLS=auto: a certificate for every address the phone may use (made anew at each start)
  const auto =
    remote.tls === "auto"
      ? await autoTls(opts.dataDir, [...remoteHosts(remote), ...(remote.url ? [new URL(remote.url).hostname] : []), "localhost", "127.0.0.1"])
      : undefined;
  const tls = auto ? { cert: auto.cert, key: auto.key } : remote.tls && remote.tls !== "auto" ? { cert: Bun.file(remote.tls.cert), key: Bun.file(remote.tls.key) } : undefined;
  const secure = !!remote.tls || !!remote.url?.startsWith("https:");
  const sockets = new Set<Socket>();
  /** wrong pairing codes per address – after a few the address waits */
  const misses = new Map<string, { n: number; since: number }>();

  const spacesMessage = () => JSON.stringify({ type: "spaces", spaces: remoteSpaces(herdr.spaces()), error: herdr.error() } satisfies RemoteMessage);
  const agentOf = (pane: unknown) => (typeof pane === "string" ? herdr.spaces().flatMap((s) => s.agents).find((a) => a.paneId === pane) : undefined);
  /** a browser sending Origin must be on this very page – or on REMOTE_URL, for a proxy in front */
  const sameOrigin = (req: Request) => {
    const origin = req.headers.get("origin");
    return !origin || origin === new URL(req.url).origin || (!!remote.url && origin === new URL(remote.url).origin);
  };
  /** the folders the phone may see files of – as the agents name them; null = any */
  const roots = remote.files ? [...remote.files.map((m) => m.host), remote.uploads.host] : null;
  const fileMaps = [...(remote.files ?? []), remote.uploads];
  /** per agent: the files its chat shows, as long as its transcript hasn't changed */
  const shown = new Map<string, { size: string; files: Set<string> }>();
  /** Only what the agent's chat shows (said or sent) can be opened from the phone – not any file of the PC. */
  const inChat = async (agent: Agent, path: string) => {
    const hit = shown.get(agent.paneId);
    const chat = await agentChat(opts.claudeProjects, agent, hit?.size);
    if (!chat.found) return false;
    if ("messages" in chat) {
      const files = new Set(chat.messages.flatMap((m) => [...messageFiles(m.text, roots).files, ...filePaths(m.text)]));
      shown.set(agent.paneId, { size: String(chat.size), files });
      return files.has(path);
    }
    return !!hit?.files.has(path);
  };
  const localFile = (path: string) => (remote.files ? toLocal(fileMaps, path) : (toLocal([remote.uploads], path) ?? (/^([A-Za-z]:[\\/]|\/)/.test(path) ? resolve(path) : undefined)));

  const herdrFailed = (e: unknown) => {
    if (e instanceof HerdrError && (e.code === "agent_blocked" || e.code === "agent_not_found" || e.code === "invalid_key")) return fail(e.code, 409);
    console.error(`remote: herdr: ${message(e)}`);
    return fail("failed", 502);
  };

  /**
   * The device's cookie. Lax, not Strict: a file opened from the installed app opens in the browser,
   * and Android counts that as coming from another app – a Strict cookie wouldn't go along. Other
   * sites still can't change anything: that takes JSON from this very origin.
   */
  const deviceCookie = (token: string, maxAge = 31536000) => `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

  const page = async (path: string): Promise<Response> => {
    const file = resolve(WEB_DIR, `.${path}`);
    if ((path.startsWith("/assets/") || PUBLIC.has(path)) && file.startsWith(WEB_DIR + sep) && (await Bun.file(file).exists())) {
      return new Response(Bun.file(file), { headers: { "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" } });
    }
    const html = Bun.file(join(WEB_DIR, "remote.html"));
    if (!(await html.exists())) return new Response("The web app isn't built yet – run `bun run build`.", { status: 503 });
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  };

  const api = async (req: Request, url: URL, address: string): Promise<Response> => {
    const lang = cookie(req, "lang");
    const langOf = isLang(lang) ? lang : opts.lang;
    const changing = req.method !== "GET";
    if (changing && !(url.pathname === "/api/upload" ? isFile(req) : isJson(req))) return fail("json-required", 415);
    if (changing && !sameOrigin(req)) return fail("foreign-origin", 403);

    if (url.pathname === "/api/pair" && req.method === "POST") {
      const miss = misses.get(address);
      if (miss && miss.n >= 5 && Date.now() - miss.since < 10 * 60_000) return fail("too-many-tries", 429);
      const body = (await req.json().catch(() => ({}))) as { code?: unknown; name?: unknown };
      const paired = typeof body.code === "string" ? await devices.redeem(body.code, typeof body.name === "string" ? body.name : "") : undefined;
      if (!paired) {
        const m = miss && Date.now() - miss.since < 10 * 60_000 ? miss : { n: 0, since: Date.now() };
        misses.set(address, { ...m, n: m.n + 1 });
        return fail("bad-code", 403);
      }
      misses.delete(address);
      console.log(`remote: paired "${paired.device.name}" from ${address}`);
      const res = Response.json({ device: { id: paired.device.id, name: paired.device.name } });
      res.headers.set("Set-Cookie", deviceCookie(paired.token));
      return res;
    }

    const device = devices.check(cookie(req, COOKIE));
    if (!device) return Response.json({ error: "not-paired", lang: langOf }, { status: 401 });

    switch (`${req.method} ${url.pathname}`) {
      case "GET /api/me": {
        const res = Response.json({ device: { id: device.id, name: device.name }, lang: langOf, files: { roots } });
        // at every start of the app: another year, and the cookie as it's made now (devices paired with a Strict one)
        res.headers.set("Set-Cookie", deviceCookie(cookie(req, COOKIE)!));
        return res;
      }
      case "POST /api/logout": {
        await devices.revoke(device.id);
        const res = Response.json({ ok: true });
        res.headers.set("Set-Cookie", deviceCookie("", 0));
        return res;
      }
      // push notifications: the key to subscribe with, and this device's subscription
      case "GET /api/push":
        return Response.json({ publicKey: push.publicKey, subscribed: !!device.push });
      case "POST /api/push": {
        const body = (await req.json().catch(() => ({}))) as { subscription?: unknown; lang?: unknown };
        const target = pushTarget(body.subscription, body.lang);
        if (!target) return fail("bad-subscription");
        await devices.setPush(device.id, target);
        return Response.json({ ok: true });
      }
      case "DELETE /api/push":
        await devices.setPush(device.id, undefined);
        return Response.json({ ok: true });
      case "POST /api/push/test": {
        if (!device.push) return fail("not-subscribed", 409);
        const sent = await push.send(device, (t) => ({ title: t.remote.push.testTitle, body: t.remote.push.testBody, tag: "test", url: "/" }));
        return sent ? Response.json({ ok: true }) : fail("push-failed", 502);
      }
      // every agent's latest message, for the list of chats (sorted there by it)
      case "GET /api/chats": {
        const agents = herdr.spaces().flatMap((s) => s.agents);
        const chats = await Promise.all(agents.map(async (a) => ({ pane: a.paneId, ...(await agentLast(opts.claudeProjects, a).catch(() => undefined)) })));
        return Response.json({ chats });
      }
      case "GET /api/spaces":
        return Response.json({ spaces: remoteSpaces(herdr.spaces()), error: herdr.error() });
      case "GET /api/chat": {
        const agent = agentOf(url.searchParams.get("pane"));
        if (!agent) return fail("agent_not_found", 404);
        try {
          return Response.json({ ...(await agentChat(opts.claudeProjects, agent, url.searchParams.get("since"))), status: agent.status });
        } catch (e) {
          console.error(`remote: ${message(e)}`);
          return fail("failed", 500);
        }
      }
      // a file the agent's chat shows: a picture it made, a document, a file sent from the phone
      case "GET /api/file": {
        const agent = agentOf(url.searchParams.get("pane"));
        const path = url.searchParams.get("path") ?? "";
        if (!agent) return fail("agent_not_found", 404);
        if (!path || path.length > 1024 || !(await inChat(agent, path))) return fail("not-in-chat", 404);
        const local = localFile(path);
        const file = local && Bun.file(local);
        if (!file || !(await file.exists())) return fail("no-file", 404);
        return new Response(file, { headers: fileHeaders(file.type.split(";")[0] ?? "", fileName(path)) });
      }
      // a file from the phone: kept in the uploads folder, the agent gets its path with the message
      case "POST /api/upload": {
        const size = Number(req.headers.get("content-length") ?? NaN);
        if (size > UPLOAD_MAX) return fail("too-big", 413);
        const data = new Uint8Array(await req.arrayBuffer());
        if (!data.length) return fail("empty");
        if (data.length > UPLOAD_MAX) return fail("too-big", 413);
        const saved = await saveUpload(remote.uploads, url.searchParams.get("name") ?? "file", data);
        console.log(`remote: "${device.name}" sent ${saved.path} (${Math.round(data.length / 1024)} KB)`);
        return Response.json(saved);
      }
      case "GET /api/read": {
        const agent = agentOf(url.searchParams.get("pane"));
        if (!agent) return fail("agent_not_found", 404);
        try {
          return Response.json({ text: await herdr.read(agent.paneId, 80), status: agent.status });
        } catch (e) {
          return herdrFailed(e);
        }
      }
      case "POST /api/prompt": {
        const body = (await req.json().catch(() => ({}))) as { pane?: unknown; text?: unknown };
        const agent = agentOf(body.pane);
        if (!agent) return fail("agent_not_found", 404);
        if (typeof body.text !== "string" || !body.text.trim()) return fail("text-required");
        try {
          await herdr.prompt(agent.paneId, body.text);
          return Response.json({ ok: true });
        } catch (e) {
          return herdrFailed(e);
        }
      }
      case "POST /api/keys": {
        const body = (await req.json().catch(() => ({}))) as { pane?: unknown; keys?: unknown };
        const agent = agentOf(body.pane);
        if (!agent) return fail("agent_not_found", 404);
        const keys = Array.isArray(body.keys) ? body.keys : [];
        if (!keys.length || keys.length > 8 || !keys.every((k) => typeof k === "string" && KEY.test(k))) return fail("bad-keys");
        try {
          await herdr.keys(agent.paneId, keys as string[]);
          return Response.json({ ok: true });
        } catch (e) {
          return herdrFailed(e);
        }
      }
    }
    return fail("not-found", 404);
  };

  const server = Bun.serve<{ device: string }>({
    hostname: remote.host,
    port: remote.port,
    tls,
    async fetch(req, server) {
      const address = server.requestIP(req)?.address;
      if (!allowedFrom(address, remote.allow)) return new Response("Forbidden", { status: 403 });
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        const device = devices.check(cookie(req, COOKIE));
        if (!device) return withHeaders(new Response("Not paired", { status: 401 }));
        if (!sameOrigin(req)) return withHeaders(new Response("Forbidden", { status: 403 }));
        if (server.upgrade(req, { data: { device: device.id } })) return;
        return new Response("WebSocket expected", { status: 400 });
      }
      try {
        return withHeaders(url.pathname.startsWith("/api/") ? await api(req, url, address!) : await page(url.pathname));
      } catch (e) {
        console.error(`remote: ${url.pathname}: ${message(e)}`);
        return withHeaders(fail("failed", 500));
      }
    },
    websocket: {
      open(ws) {
        sockets.add(ws);
        ws.send(spacesMessage());
      },
      close(ws) {
        sockets.delete(ws);
      },
      message() {}, // phones only listen
    },
  });

  // The phone can't trust the CA before it has it, so it comes over plain HTTP – the dashboard shows
  // its fingerprint to compare. Anything else there is sent on to HTTPS.
  const plain =
    auto &&
    Bun.serve({
      hostname: remote.host,
      port: remote.httpPort,
      fetch(req, plain) {
        if (!allowedFrom(plain.requestIP(req)?.address, remote.allow)) return new Response("Forbidden", { status: 403 });
        const url = new URL(req.url);
        if (url.pathname === "/ca.crt") {
          return new Response(new Uint8Array(auto.caDer), {
            headers: { "Content-Type": "application/x-x509-ca-cert", "Content-Disposition": 'attachment; filename="dev-dashboard-remote-ca.crt"', "Cache-Control": "no-store" },
          });
        }
        url.protocol = "https:";
        url.port = String(server.port);
        return Response.redirect(url.href, 302);
      },
    });

  return {
    port: server.port!,
    ca: auto && plain ? { urls: remoteHosts(remote).map((h) => `http://${h}:${plain.port}/ca.crt`), fingerprint: auto.fingerprint } : undefined,
    publish() {
      push.update(herdr.spaces());
      if (!sockets.size) return;
      const msg = spacesMessage();
      for (const ws of sockets) ws.send(msg);
    },
    kick(deviceId) {
      for (const ws of sockets) if (ws.data.device === deviceId) ws.close(4001, "revoked");
    },
    stop() {
      server.stop(true);
      if (plain) plain.stop(true);
    },
  };
}
