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
import type { Space } from "./model.ts";
import { allowedFrom, type Devices } from "./remote-auth.ts";
import { agentChat } from "./transcript.ts";
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
/** the only files of dist/web this server hands out besides the built assets */
const PUBLIC = new Set(["/remote.webmanifest", "/remote-icon.svg"]);

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const withHeaders = (res: Response) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
};
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const isJson = (req: Request) => req.headers.get("content-type")?.startsWith("application/json") ?? false;
const cookie = (req: Request, name: string) => req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];

/** The remote's address(es) for the pairing QR code: REMOTE_URL, or this machine's in the allowed networks. */
export function pairUrls(remote: RemoteConfig, port: number): string[] {
  if (remote.url) return [remote.url];
  const proto = remote.tls ? "https" : "http";
  if (remote.host !== "0.0.0.0" && remote.host !== "::") return [`${proto}://${remote.host}:${port}`];
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && allowedFrom(i.address, remote.allow))
    .map((i) => i!.address);
  return [...new Set(ips)].map((ip) => `${proto}://${ip}:${port}`);
}

type Socket = ServerWebSocket<{ device: string }>;

export type Remote = {
  port: number;
  /** herdr changed: tell the open phones */
  publish(): void;
  /** a revoked device's open connections end at once */
  kick(deviceId: string): void;
  stop(): void;
};

export function startRemote(opts: { remote: RemoteConfig; herdr: Herdr; devices: Devices; claudeProjects: string; lang: string }): Remote {
  const { remote, herdr, devices } = opts;
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
  const herdrFailed = (e: unknown) => {
    if (e instanceof HerdrError && (e.code === "agent_blocked" || e.code === "agent_not_found" || e.code === "invalid_key")) return fail(e.code, 409);
    console.error(`remote: herdr: ${message(e)}`);
    return fail("failed", 502);
  };

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
    if (changing && !isJson(req)) return fail("json-required", 415);
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
      res.headers.set("Set-Cookie", `${COOKIE}=${paired.token}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`);
      return res;
    }

    const device = devices.check(cookie(req, COOKIE));
    if (!device) return Response.json({ error: "not-paired", lang: langOf }, { status: 401 });

    switch (`${req.method} ${url.pathname}`) {
      case "GET /api/me":
        return Response.json({ device: { id: device.id, name: device.name }, lang: langOf });
      case "POST /api/logout": {
        await devices.revoke(device.id);
        const res = Response.json({ ok: true });
        res.headers.set("Set-Cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`);
        return res;
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
    tls: remote.tls && { cert: Bun.file(remote.tls.cert), key: Bun.file(remote.tls.key) },
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

  return {
    port: server.port!,
    publish() {
      if (!sockets.size) return;
      const msg = spacesMessage();
      for (const ws of sockets) ws.send(msg);
    },
    kick(deviceId) {
      for (const ws of sockets) if (ws.data.device === deviceId) ws.close(4001, "revoked");
    },
    stop() {
      server.stop(true);
    },
  };
}
