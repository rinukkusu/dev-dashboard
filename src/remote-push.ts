// Push notifications for the remote control: when an agent starts waiting for an answer or is
// done, every paired device that asked for them gets one – with the app closed too (Web Push: the
// browser's vendor delivers it, encrypted end to end). The VAPID keys that sign them are made once
// and kept in OUT_DIR; a new pair would make every phone subscribe again.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import webpush from "web-push";
import { message } from "./http.ts";
import { dict, isLang } from "./i18n.ts";
import type { Agent, AgentStatus, Space } from "./model.ts";
import { questionOf } from "./question.ts";
import type { Device, Devices, PushTarget } from "./remote-auth.ts";
import { readJson, writeAtomic } from "./store.ts";

export type Vapid = { publicKey: string; privateKey: string };

/** VAPID wants a contact; the push services only use it to reach whoever runs the server. */
const SUBJECT = "https://github.com/rinukkusu/dev-dashboard";
/** The same agent in the same state again within this long is herdr flickering, not news. */
const QUIET_MS = 20_000;

export async function loadVapid(dataDir: string): Promise<Vapid> {
  const path = join(dataDir, "remote-vapid.json");
  const kept = await readJson<Vapid>(path);
  if (kept?.publicKey && kept.privateKey) return kept;
  const made = webpush.generateVAPIDKeys();
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, JSON.stringify(made));
  return made;
}

/** What the service worker (web/public/sw.js) shows. */
export type PushMessage = { title: string; body: string; tag: string; url: string };

export type Event = { agent: Agent; space: Space; status: "blocked" | "done" };

/**
 * Agents that just started waiting or just finished, from one herdr state to the next. The first
 * state only sets the baseline; an agent that turns up already waiting counts, one that's done doesn't.
 */
export function agentEvents(): (spaces: Space[], now?: number) => Event[] {
  let last: Map<string, AgentStatus> | undefined;
  const told = new Map<string, number>();
  return (spaces, now = Date.now()) => {
    const out: Event[] = [];
    const seen = new Map<string, AgentStatus>();
    for (const space of spaces) {
      for (const agent of space.agents) {
        seen.set(agent.paneId, agent.status);
        if (!last) continue;
        const before = last.get(agent.paneId);
        if (agent.status === before || (agent.status !== "blocked" && agent.status !== "done")) continue;
        if (before === undefined && agent.status === "done") continue;
        const key = `${agent.paneId}:${agent.status}`;
        if (now - (told.get(key) ?? -Infinity) < QUIET_MS) continue;
        told.set(key, now);
        out.push({ agent, space, status: agent.status });
      }
    }
    last = seen;
    return out;
  };
}

/** The question's first lines, without the box's decoration – enough to know whether to get up. */
export function questionLine(screen: string): string | undefined {
  const lines = questionOf(screen)
    .text.split("\n")
    .map((l) => l.replace(/^[\s│☐❯›>]+/, "").trim())
    .filter(Boolean);
  // the header ("nginx base") and the question itself
  const text = lines.slice(0, 2).join(" – ");
  return text ? (text.length > 180 ? `${text.slice(0, 179)}…` : text) : undefined;
}

export type Pusher = {
  publicKey: string;
  /** herdr changed: tell the subscribed devices what's new */
  update(spaces: Space[]): void;
  /** one message to one device; false = the push service didn't take it */
  send(device: Device, msg: (t: ReturnType<typeof dict>) => PushMessage): Promise<boolean>;
};

export type Send = (target: PushTarget, payload: string) => Promise<void>;

export function startPush(opts: {
  vapid: Vapid;
  devices: Devices;
  /** the agent's screen, for the question */
  read: (paneId: string) => Promise<string>;
  lang: string;
  /** for tests; the real one goes to the push service */
  send?: Send;
}): Pusher {
  const { vapid, devices } = opts;
  const send: Send =
    opts.send ??
    (async (target, payload) => {
      await webpush.sendNotification(target, payload, {
        vapidDetails: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        TTL: 60 * 60, // an hour later it's no news any more
        urgency: "high",
      });
    });
  const events = agentEvents();

  const deliver = async (device: Device, msg: (t: ReturnType<typeof dict>) => PushMessage): Promise<boolean> => {
    const target = device.push;
    if (!target) return false;
    try {
      await send(target, JSON.stringify(msg(dict(isLang(target.lang) ? target.lang : isLang(opts.lang) ? opts.lang : "en"))));
      return true;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // the subscription is gone (app uninstalled, permission taken back): forget it
      if (status === 404 || status === 410) {
        console.log(`remote: push subscription of "${device.name}" is gone, dropped`);
        await devices.setPush(device.id, undefined).catch(() => {});
      } else console.error(`remote: push to "${device.name}": ${status ?? ""} ${message(e)}`);
      return false;
    }
  };

  const notify = async ({ agent, space, status }: Event) => {
    const targets = devices.list().filter((d) => d.push);
    if (!targets.length) return;
    const who = agent.name || agent.title || space.label;
    const asked = status === "blocked" ? await opts.read(agent.paneId).then(questionLine, () => undefined) : undefined;
    const msg = (t: ReturnType<typeof dict>): PushMessage => ({
      title: status === "blocked" ? t.remote.push.waits(who) : t.remote.push.done(who),
      body: status === "blocked" ? (asked ?? t.remote.push.asks) : space.label,
      // one notification per agent: a newer one replaces it
      tag: agent.paneId,
      url: `/#/agent/${encodeURIComponent(agent.paneId)}`,
    });
    await Promise.all(targets.map((d) => deliver(d, msg)));
  };

  return {
    publicKey: vapid.publicKey,
    update(spaces) {
      for (const e of events(spaces)) void notify(e).catch((err) => console.error(`remote: push: ${message(err)}`));
    },
    send: deliver,
  };
}
