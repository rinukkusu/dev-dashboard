import { expect, test } from "bun:test";
import { join } from "node:path";

// The service worker as the phone runs it, against a stand-in for its global scope.
type Shown = { title: string; options: { body: string; tag: string; data: { items: { key: string }[]; url: string } } };
async function worker() {
  const listeners = new Map<string, (e: unknown) => void>();
  let shown: Shown | undefined;
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    skipWaiting() {},
    clients: { claim: async () => {} },
    registration: {
      getNotifications: async () => (shown ? [{ data: shown.options.data }] : []),
      showNotification: async (title: string, options: Shown["options"]) => void (shown = { title, options }),
    },
  };
  new Function("self", await Bun.file(join(import.meta.dir, "../web/public/sw.js")).text())(self);
  const push = async (msg: object) => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get("push")!({ data: { json: () => msg }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    return shown!;
  };
  return { push, dismiss: () => (shown = undefined) };
}

test("one notification: the newest on top, the other agents listed, an agent's newer news replaces its older", async () => {
  const sw = await worker();
  let n = await sw.push({ title: "Pipelines wartet auf dich", body: "nginx base – Wie fixen?", tag: "w2:p1", url: "/#/agent/w2%3Ap1" });
  expect(n).toMatchObject({ title: "Pipelines wartet auf dich", options: { body: "nginx base – Wie fixen?", tag: "herdr", data: { url: "/#/agent/w2%3Ap1" } } });

  n = await sw.push({ title: "Review ist fertig", body: "CT-1978", tag: "w3:p1", url: "/#/agent/w3%3Ap1" });
  expect(n.title).toBe("Review ist fertig");
  expect(n.options.body).toBe("CT-1978\n• Pipelines wartet auf dich");
  expect(n.options.data.url).toBe("/"); // several: the list

  // the first agent again: on top, once
  n = await sw.push({ title: "Pipelines ist fertig", body: "DEMA-20", tag: "w2:p1", url: "/#/agent/w2%3Ap1" });
  expect(n.options.body).toBe("DEMA-20\n• Review ist fertig");
  expect(n.options.data.items.map((i) => i.key)).toEqual(["w2:p1", "w3:p1"]);

  // swiped away (or opened): the next one starts on its own
  sw.dismiss();
  n = await sw.push({ title: "Pipelines wartet auf dich", body: "", tag: "w2:p1", url: "/#/agent/w2%3Ap1" });
  expect(n.options.body).toBe("");
  expect(n.options.data.url).toBe("/#/agent/w2%3Ap1");
});
