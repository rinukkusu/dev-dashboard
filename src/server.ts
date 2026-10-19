// Live mode: polls Jira/ADO in the background and pushes every new state to open tabs over a WebSocket.
//   bun run serve   → http://localhost:3000
import { loadConfig, type Config } from "./config.ts";
import { buildView, loadState, message, statePath, update } from "./engine.ts";
import { renderApp, renderHtml, type View } from "./render.ts";

const TOPIC = "dashboard";

export async function startServer(cfg: Config) {
  // Show the last known state right away instead of an empty page until the first poll is done.
  const stored = await loadState(statePath(cfg));
  let view: View | undefined = stored ? buildView(cfg, stored) : undefined;

  const viewMessage = (v: View) =>
    JSON.stringify({ type: "view", takenAt: v.snapshot.takenAt, html: renderApp(v) });

  const server = Bun.serve({
    hostname: cfg.host,
    port: cfg.port,
    routes: {
      "/": () =>
        new Response(renderHtml(view, { live: true }), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        }),
      "/api/state": () => (view ? Response.json(view) : new Response(null, { status: 204 })),
      "/api/refresh": {
        POST: async () => {
          await poll();
          return Response.json({ ok: true });
        },
      },
      "/healthz": () => new Response("ok"),
    },
    fetch(req, server) {
      if (new URL(req.url).pathname === "/ws" && server.upgrade(req, { data: undefined })) return;
      return new Response("Nicht gefunden", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.subscribe(TOPIC);
        if (view) ws.send(viewMessage(view));
      },
      message() {}, // clients only listen
    },
  });

  // One poll at a time; a refresh click during a running poll just waits for it.
  let running: Promise<void> | undefined;
  function poll(): Promise<void> {
    running ??= (async () => {
      server.publish(TOPIC, JSON.stringify({ type: "polling" }));
      try {
        view = (await update(cfg)).view;
      } catch (e) {
        console.error(`Abruf fehlgeschlagen: ${message(e)}`);
      }
      if (view) server.publish(TOPIC, viewMessage(view));
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

  console.log(`Dashboard läuft auf ${server.url} (Abruf alle ${cfg.pollSeconds} s)`);
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
