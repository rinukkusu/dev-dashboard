// Live mode: polls Jira/ADO in the background and pushes every new state to open tabs over a WebSocket.
//   bun run serve   → http://localhost:3000
import { loadConfig, type Config } from "./config.ts";
import { buildView, loadState, message, statePath, update, type State } from "./engine.ts";
import { isLang, LANGS, type Lang } from "./i18n.ts";
import { renderApp, renderHtml } from "./render.ts";

type SocketData = { lang: Lang };

const topic = (lang: Lang) => `dashboard:${lang}`;

export async function startServer(cfg: Config) {
  // Show the last known state right away instead of an empty page until the first poll is done.
  let state: State | undefined = await loadState(statePath(cfg));

  /** Cookie set by the language switch, otherwise DASHBOARD_LANG. */
  const langOf = (req: Request): Lang => {
    const value = req.headers.get("cookie")?.match(/(?:^|;\s*)lang=([^;]+)/)?.[1];
    return isLang(value) ? value : cfg.lang;
  };

  const viewMessage = (s: State, lang: Lang) =>
    JSON.stringify({ type: "view", takenAt: s.snapshot.takenAt, html: renderApp(buildView(cfg, s, lang)) });

  const server = Bun.serve({
    hostname: cfg.host,
    port: cfg.port,
    routes: {
      "/": (req) => {
        const lang = langOf(req);
        return new Response(renderHtml(state && buildView(cfg, state, lang), { live: true, lang }), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      },
      "/api/state": () => (state ? Response.json(state) : new Response(null, { status: 204 })),
      "/api/refresh": {
        POST: async () => {
          await poll();
          return Response.json({ ok: true });
        },
      },
      "/healthz": () => new Response("ok"),
    },
    fetch(req, server) {
      if (new URL(req.url).pathname === "/ws" && server.upgrade(req, { data: { lang: langOf(req) } })) return;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      data: {} as SocketData,
      open(ws) {
        ws.subscribe(topic(ws.data.lang));
        if (state) ws.send(viewMessage(state, ws.data.lang));
      },
      message() {}, // clients only listen
    },
  });

  // One poll at a time; a refresh click during a running poll just waits for it.
  let running: Promise<void> | undefined;
  function poll(): Promise<void> {
    running ??= (async () => {
      for (const lang of LANGS) server.publish(topic(lang), JSON.stringify({ type: "polling" }));
      try {
        state = (await update(cfg)).state;
      } catch (e) {
        console.error(`Poll failed: ${message(e)}`);
      }
      if (state) for (const lang of LANGS) server.publish(topic(lang), viewMessage(state, lang));
    })().finally(() => (running = undefined));
    return running;
  }

  // setTimeout chain instead of setInterval, so slow polls never overlap.
  let timer: Timer | undefined;
  const loop = async () => {
    await poll();
    timer = setTimeout(loop, cfg.pollSeconds * 1000);
  };
  void loop();

  console.log(`Dashboard running at ${server.url} (polling every ${cfg.pollSeconds} s, language ${cfg.lang})`);
  return {
    server,
    poll,
    stop() {
      clearTimeout(timer);
      server.stop(true);
    },
  };
}

if (import.meta.main) {
  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch (e) {
    console.error(message(e));
    process.exit(1);
  }
  const app = await startServer(cfg);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      app.stop();
      process.exit(0);
    });
  }
}
