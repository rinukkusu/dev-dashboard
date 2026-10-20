// Live mode: polls all sources in the background and pushes every new state to open tabs over a WebSocket.
//   bun run serve   → http://localhost:3000
import { loadConfig, type Config } from "./config.ts";
import { makeKeyExtractor } from "./correlate.ts";
import { buildView, loadState, statePath, update, type State } from "./engine.ts";
import { agentOf, HerdrError, spacesOf, startHerdr, type Herdr } from "./herdr.ts";
import { message } from "./http.ts";
import { isLang, LANGS, type Lang } from "./i18n.ts";
import { agentName, loadPrompts, prepare, type Target } from "./launch.ts";
import type { Comment } from "./model.ts";
import { addWatch, loadPrefs, markSent, pruneFinishedRuns, removeWatch, savePrefs, setMuted } from "./prefs.ts";
import { renderApp, renderHtml, renderNav } from "./render.ts";
import { findTranscript, readChat } from "./transcript.ts";
import { createSources } from "./sources/index.ts";

type SocketData = { lang: Lang };

const topic = (lang: Lang) => `dashboard:${lang}`;

/**
 * Changing requests must be JSON. A plain HTML form on some other website can't send that
 * without a CORS preflight, which we never answer – so no other site can change your watches.
 */
const isJson = (req: Request) => req.headers.get("content-type")?.startsWith("application/json") ?? false;
const badRequest = (error: string, status = 400) => Response.json({ error }, { status });

/**
 * herdr endpoints type into terminals, so on top of the JSON rule: a browser sending Origin must be
 * on this very page (the Host it asked for). Tools without Origin (curl) are local anyway.
 */
const sameOrigin = (req: Request) => {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
};

const herdrFailed = (e: unknown) => {
  if (e instanceof HerdrError && (e.code === "agent_blocked" || e.code === "agent_not_found")) return badRequest(e.code, 409);
  console.error(`herdr: ${message(e)}`);
  return badRequest("failed", 502);
};

export async function startServer(cfg: Config) {
  const sources = createSources(cfg);
  const prefs = await loadPrefs(cfg);
  // Show the last known state right away instead of an empty page until the first poll is done.
  let state: State | undefined = await loadState(statePath(cfg));
  // herdr changes every few seconds and lives outside the polled state; a change just re-renders
  const herdr: Herdr | undefined =
    cfg.herdr && startHerdr(cfg.herdr.socket, cfg.herdr.pollSeconds, makeKeyExtractor(cfg.jira?.projectKeys ?? []), () => publishViews());

  /** Cookie set by the language switch, otherwise DASHBOARD_LANG. */
  const langOf = (req: Request): Lang => {
    const value = req.headers.get("cookie")?.match(/(?:^|;\s*)lang=([^;]+)/)?.[1];
    return isLang(value) ? value : cfg.lang;
  };

  /**
   * What a start/send button points at: a ticket or PR by its id, or a comment by its change id
   * ("issue:<id>:c:<comment>" / "pr:<id>:c:<comment>"), with the ticket or PR it's on.
   */
  const findTarget = (kind: string | null, id: string): { target: Target; comment?: Comment } | undefined => {
    const s = state?.snapshot;
    if (!s) return undefined;
    const ticket = (issueId: string) => s.issues.find((i) => i.id === issueId && i.source === "jira");
    if (kind === "ticket") {
      const issue = ticket(id);
      return issue && { target: { kind: "ticket", issue } };
    }
    if (kind === "pr") {
      const pr = s.prs.find((p) => p.id === id);
      return pr && { target: { kind: "pr", pr } };
    }
    if (kind !== "comment") return undefined;
    // same ids as diff.ts gives comment changes; comment ids contain ":" themselves, so compare whole ids
    for (const pr of s.prs) {
      const comment = pr.comments.find((c) => `pr:${pr.id}:c:${c.id}` === id);
      if (comment) return { target: { kind: "pr", pr }, comment };
    }
    for (const issue of s.issues) {
      const comment = issue.comments.find((c) => `issue:${issue.id}:c:${c.id}` === id);
      if (comment) return { target: { kind: "ticket", issue }, comment };
    }
    // no longer in the snapshot: what the change log still knows about it
    const change = state!.changes.find((c) => c.id === id);
    if (!change?.resource) return undefined;
    const comment: Comment = {
      id: id.slice(id.indexOf(`${change.resource}:c:`) + change.resource.length + 3),
      author: change.actor ?? "?",
      authorIsMe: false,
      text: change.text ?? "",
      at: change.at,
    };
    const pr = s.prs.find((p) => p.id === change.resource);
    if (pr) return { target: { kind: "pr", pr }, comment };
    const issue = s.issues.find((i) => i.id === change.resource);
    return issue && { target: { kind: "ticket", issue }, comment };
  };

  const view = (s: State, lang: Lang) => buildView(cfg, s, prefs, sources, lang, herdr);
  const viewMessage = (s: State, lang: Lang) => {
    const v = view(s, lang);
    // the menu lives in the header, outside #app, but its badges change with the data too
    return JSON.stringify({ type: "view", takenAt: s.snapshot.takenAt, html: renderApp(v, true), nav: renderNav(v) });
  };
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
      // what the dashboard currently gets from herdr – for checking the setup
      "/api/herdr": () => (herdr ? Response.json({ error: herdr.error(), spaces: herdr.spaces() }) : badRequest("not-configured", 404)),
      "/api/herdr/read": async (req) => {
        if (!herdr) return badRequest("not-configured", 404);
        const pane = new URL(req.url).searchParams.get("pane") ?? "";
        const agent = herdr.spaces().flatMap((s) => s.agents).find((a) => a.paneId === pane);
        if (!agent) return badRequest("agent_not_found", 404);
        try {
          return Response.json({ text: await herdr.read(pane), status: agent.status });
        } catch (e) {
          return herdrFailed(e);
        }
      },
      // Claude's transcript of the agent as chat messages; ?since=<size> answers "unchanged" cheaply
      "/api/herdr/chat": async (req) => {
        if (!herdr || !cfg.herdr) return badRequest("not-configured", 404);
        const params = new URL(req.url).searchParams;
        const agent = herdr.spaces().flatMap((s) => s.agents).find((a) => a.paneId === params.get("pane"));
        if (!agent) return badRequest("agent_not_found", 404);
        // other agents keep their history elsewhere – they only get the terminal view
        const isClaude = !agent.kind || /claude/i.test(agent.kind);
        const path = isClaude ? await findTranscript(cfg.herdr.claudeProjects, agent.session, agent.cwd) : undefined;
        if (!path) return Response.json({ found: false, status: agent.status });
        try {
          const chat = await readChat(path);
          if (String(chat.size) === params.get("since")) return Response.json({ found: true, unchanged: true, status: agent.status });
          return Response.json({ found: true, status: agent.status, ...chat });
        } catch (e) {
          console.error(`transcript ${path}: ${message(e)}`);
          return badRequest("failed", 500);
        }
      },
      "/api/herdr/prompt": {
        POST: async (req) => {
          if (!herdr) return badRequest("not-configured", 404);
          if (!isJson(req)) return badRequest("json-required", 415);
          if (!sameOrigin(req)) return badRequest("foreign-origin", 403);
          const body = (await req.json().catch(() => ({}))) as { pane?: unknown; text?: unknown; comment?: unknown };
          if (typeof body.pane !== "string" || typeof body.text !== "string" || !body.text.trim()) return badRequest("pane-and-text-required");
          try {
            await herdr.prompt(body.pane, body.text);
            // sent from a comment's ➤: remember it, the change log shows a ✓
            if (typeof body.comment === "string") {
              markSent(prefs, body.comment);
              await savePrefs(cfg, prefs);
              publishViews();
            }
            return Response.json({ ok: true });
          } catch (e) {
            return herdrFailed(e);
          }
        },
      },
      // label and prompt for a new space (or for a comment, plus the agent that's already there)
      "/api/herdr/prepare": async (req) => {
        if (!herdr || !cfg.herdr) return badRequest("not-configured", 404);
        const params = new URL(req.url).searchParams;
        const found = findTarget(params.get("kind"), params.get("id") ?? "");
        if (!found) return badRequest("not-found", 404);
        try {
          const launch = prepare(await loadPrompts(cfg.herdr.promptsFile), found.target, found.comment);
          const keys = found.target.kind === "ticket" ? [found.target.issue.ref] : found.target.pr.ticketKeys;
          const space = spacesOf(herdr.spaces(), keys, found.target.kind === "pr" ? found.target.pr.ref : undefined).find((s) => s.agents.length);
          const agent = space && agentOf(space);
          return Response.json({
            ...launch,
            agent: agent && { pane: agent.paneId, label: space!.label },
            canStart: !!cfg.herdr.workdir,
          });
        } catch (e) {
          console.error(`prompts: ${message(e)}`);
          return badRequest("prompts-invalid", 500);
        }
      },
      "/api/herdr/start": {
        POST: async (req) => {
          if (!herdr || !cfg.herdr) return badRequest("not-configured", 404);
          if (!isJson(req)) return badRequest("json-required", 415);
          if (!sameOrigin(req)) return badRequest("foreign-origin", 403);
          if (!cfg.herdr.workdir) return badRequest("no-workdir", 400);
          const body = (await req.json().catch(() => ({}))) as { kind?: unknown; id?: unknown; label?: unknown; prompt?: unknown };
          const found = findTarget(typeof body.kind === "string" ? body.kind : null, typeof body.id === "string" ? body.id : "");
          if (!found || typeof body.label !== "string" || !body.label.trim() || typeof body.prompt !== "string") return badRequest("bad-request");
          try {
            const prompts = await loadPrompts(cfg.herdr.promptsFile);
            const { args } = prepare(prompts, found.target, found.comment);
            const ref = found.target.kind === "ticket" ? found.target.issue.ref : found.target.pr.ref;
            const taken = new Set(herdr.spaces().flatMap((s) => s.agents.map((a) => a.name ?? "")));
            const started = await herdr.start({
              label: body.label.trim(),
              cwd: cfg.herdr.workdir,
              name: agentName(ref, taken),
              kind: prompts.agent,
              args,
              prompt: body.prompt,
            });
            if (started.sent && found.comment && typeof body.id === "string") {
              markSent(prefs, body.id);
              await savePrefs(cfg, prefs);
              publishViews();
            }
            return Response.json(started);
          } catch (e) {
            return herdrFailed(e);
          }
        },
      },
      "/api/herdr/focus": {
        POST: async (req) => {
          if (!herdr) return badRequest("not-configured", 404);
          if (!isJson(req)) return badRequest("json-required", 415);
          if (!sameOrigin(req)) return badRequest("foreign-origin", 403);
          const body = (await req.json().catch(() => ({}))) as { pane?: unknown; space?: unknown };
          try {
            if (typeof body.pane === "string") await herdr.focus({ pane: body.pane });
            else if (typeof body.space === "string") await herdr.focus({ space: body.space });
            else return badRequest("pane-or-space-required");
            return Response.json({ ok: true });
          } catch (e) {
            return herdrFailed(e);
          }
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
    `Dashboard running at ${server.url} – sources: ${sources.map((s) => s.label).join(", ")}${herdr ? ` + herdr (${cfg.herdr!.socket})` : ""}; polling every ${cfg.pollSeconds} s; language ${cfg.lang}`,
  );
  return {
    server,
    poll,
    stop() {
      clearTimeout(timer);
      herdr?.stop();
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
