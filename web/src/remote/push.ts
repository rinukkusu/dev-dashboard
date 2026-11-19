// Push notifications on this device: the service worker (public/sw.js), the browser's subscription
// and telling the server about it (src/remote-push.ts sends them).
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/store";

export type PushState = "unsupported" | "denied" | "off" | "on";

/** Needs a trusted HTTPS page (or localhost) – on plain HTTP or with a certificate warning there's no service worker. */
const supported = () => typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** The service worker, and a notification tapped while the app runs opens its agent here. */
export function registerWorker() {
  if (!supported()) return;
  navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("service worker:", e));
  navigator.serviceWorker.addEventListener("message", (e) => {
    const open = (e.data as { open?: string } | undefined)?.open;
    if (open && new URL(open).origin === location.origin) location.href = open;
  });
  // looking at the app: its notification has done its job
  const clear = () => {
    if (document.visibilityState !== "visible") return;
    void navigator.serviceWorker.ready.then((reg) => reg.getNotifications()).then((all) => all.forEach((n) => n.close()), () => {});
  };
  clear();
  document.addEventListener("visibilitychange", clear);
}

/** VAPID's public key (base64url) the way pushManager.subscribe wants it */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function current(): Promise<PushState> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return "off";
  const server = await api<{ subscribed: boolean }>("GET", "/api/push").catch(() => undefined);
  return server?.subscribed ? "on" : "off";
}

export function usePush(lang: string) {
  const [state, setState] = useState<PushState>(supported() ? "off" : "unsupported");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void current().then(setState);
  }, []);
  // the notifications speak the app's language: a switch tells the server
  const on = state === "on";
  useEffect(() => {
    if (!on) return;
    void navigator.serviceWorker
      .getRegistration()
      .then((r) => r?.pushManager.getSubscription())
      .then((sub) => sub && api("POST", "/api/push", { subscription: sub.toJSON(), lang }))
      .catch(() => {});
  }, [lang, on]);

  const toggle = useCallback(async () => {
    if (state === "unsupported" || busy) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (state === "on") {
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        await api("DELETE", "/api/push", {});
        setState("off");
        return;
      }
      if ((await Notification.requestPermission()) !== "granted") {
        setState(Notification.permission === "denied" ? "denied" : "off");
        return;
      }
      const { publicKey } = await api<{ publicKey: string }>("GET", "/api/push");
      const key = keyBytes(publicKey);
      let sub = await reg.pushManager.getSubscription();
      // subscribed with another key (the server's data was reset): start over
      const old = sub?.options.applicationServerKey;
      if (sub && old && new Uint8Array(old).join() !== key.join()) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api("POST", "/api/push", { subscription: sub.toJSON(), lang });
      setState("on");
    } catch (e) {
      console.warn("push:", e);
      setState(await current());
    } finally {
      setBusy(false);
    }
  }, [state, busy, lang]);

  const test = useCallback(() => api("POST", "/api/push/test", {}), []);
  return { state, busy, toggle, test };
}
