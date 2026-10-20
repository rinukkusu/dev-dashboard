// Live mode: polls all sources in the background and pushes every new state to open tabs over a WebSocket.
//   bun run serve   → http://localhost:3000
import { loadConfig, type Config } from "./config.ts";
import { buildView, loadState, statePath, update, type State } from "./engine.ts";
import { message } from "./http.ts";
import { isLang, LANGS, type Lang } from "./i18n.ts";
import { addWatch, loadPrefs, pruneFinishedRuns, removeWatch, savePrefs, setMuted } from "./prefs.ts";
import { renderApp, renderHtml } from "./render.ts";
import { createSources } from "./sources/index.ts";

type SocketData = { lang: Lang };

const topic = (lang: Lang) => `dashboard:${lang}`;

/**
 * Changing requests must be JSON. A plain HTML form on some other website can't send that
 * without a CORS preflight, which we never answer – so no other site can change your watches.
 */
const isJson = (req: Request) => req.headers.get("content-type")?.startsWith("application/json") ?? false;
const badRequest = (error: string, status = 400) => Response.json({ error }, { status });

export async function startServer(cfg: Config) {
  const sources = createSources(cfg);
  const prefs = await loadPrefs(cfg);
  // Show the last known state right away instead of an empty page until the first poll is done.
  let state: State | undefined = await loadState(statePath(cfg));

  /** Cookie set by the language switch, otherwise DASHBOARD_LANG. */
  const langOf = (req: Request): Lang => {
    const value = req.headers.get("cookie")?.match(/(?:^|;\s*)lang=([^;]+)/)?.[1];
    return isLang(value) ? value : cfg.lang;
  };

  const view = (s: State, lang: Lang) => buildView(cfg, s, prefs, sources, lang);
  const viewMessage = (s: State, lang: Lang) =>
    JSON.stringify({ type: "view", takenAt: s.snapshot.takenAt, html: renderApp(view(s, lang), true) });
  const publishViews = () => {
    if (state) for (const lang of LANGS) server.publish(topic(lang), viewMessage(state, lang));
  };

  const server = Bun.serve({
    hostname: cfg.host,
    port: cfg.port,
    routes: {
      "/": (req) => {
        const lang = langOf(req);
        return new Response(renderHtml(state && view(state, lang), { live: true, lang }), {
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
      "/api/watches": {
        GET: () => {
          const all = state ? [...state.snapshot.prs, ...state.snapshot.issues, ...state.snapshot.runs] : [];
          const titles = new Map(all.map((x) => [x.id, `${x.ref} ${x.title}`]));
          return Response.json(prefs.watches.map((w) => ({ id: w.id, url: w.url, title: titles.get(w.id) })));
        },
        POST: async (req) => {
          if (!isJson(req)) return badRequest("json-required", 415);
          const body = (await req.json().catch(() => ({}))) as { url?: unknown };
          const result = addWatch(prefs, sources, String(body.url ?? ""));
          if (!result.ok) return badRequest(result.error, result.error === "exists" ? 409 : 400);
          await savePrefs(cfg, prefs);
          void poll(); // fetch it right away; the page gets it with the next push
          return Response.json(result.watch, { status: 201 });
        },
        DELETE: async (req) => {
          if (!isJson(req)) return badRequest("json-required", 415);
          const id = new URL(req.url).searchParams.get("id") ?? "";
          if (!removeWatch(prefs, id)) return badRequest("not-found", 404);
          await savePrefs(cfg, prefs);
          void poll();
          return Response.json({ ok: true });
        },
      },
      "/api/mute": {
        POST: async (req) => {
          if (!isJson(req)) return badRequest("json-required", 415);
          const body = (await req.json().catch(() => ({}))) as { id?: unknown; muted?: unknown };
          if (typeof body.id !== "string" || !body.id) return badRequest("id-required");
          setMuted(prefs, body.id, body.muted !== false);
          await savePrefs(cfg, prefs);
          publishViews(); // no need to poll, it's only how things are shown
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
        state = (await update(cfg, sources, prefs)).state;
        if (pruneFinishedRuns(prefs, state.snapshot, cfg.runsKeepHours)) await savePrefs(cfg, prefs);
      } catch (e) {
        console.error(`Poll failed: ${message(e)}`);
      }
      publishViews();
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

  console.log(
    `Dashboard running at ${server.url} – sources: ${sources.map((s) => s.label).join(", ")}; polling every ${cfg.pollSeconds} s; language ${cfg.lang}`,
  );
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
