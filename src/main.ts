// Static mode: one run → out/dashboard.html (for cron). The live server is src/server.ts.
import { join } from "node:path";
import { loadConfig, type Config } from "./config.ts";
import { buildView, update } from "./engine.ts";
import { message } from "./http.ts";
import { loadPrefs } from "./prefs.ts";
import { renderHtml } from "./render.ts";
import { createSources } from "./sources/index.ts";
import { writeAtomic } from "./store.ts";

export async function runOnce(cfg: Config) {
  const sources = createSources(cfg);
  // Watches and mutes are managed in the live server; static mode just respects them.
  const prefs = await loadPrefs(cfg);
  const result = await update(cfg, sources, prefs);
  const html = renderHtml(buildView(cfg, result.state, prefs, sources), { live: false, lang: cfg.lang });
  await writeAtomic(join(cfg.outDir, "dashboard.html"), html);
  return result;
}

if (import.meta.main) {
  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch (e) {
    console.error(message(e));
    process.exit(1);
  }

  if (process.argv.includes("--loop")) {
    // Alternative to cron: keep running and refresh every LOOP_MINUTES.
    for (;;) {
      await runOnce(cfg).catch((e) => console.error(message(e)));
      await Bun.sleep(cfg.loopMinutes * 60_000);
    }
  } else {
    await runOnce(cfg);
  }
}
