// The remote control's service worker – only for push notifications (src/remote-push.ts): no
// caching, the app is no use without the PC anyway.
//
// There's only ever one notification: the newest news on top, the other agents listed below it.
// Several would make Android group them under Chrome's own icon, which a website can't change.
// Tapping it opens the agent (or, with several, the list); opening the app clears it (app/push.ts).
const TAG = "herdr";
/** agents listed at most – a phone's notification shows a few lines anyway */
const MAX = 6;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let m = { title: "herdr", body: "", tag: "", url: "/" };
  try {
    m = { ...m, ...e.data.json() };
  } catch {}
  e.waitUntil(
    (async () => {
      const [shown] = await self.registration.getNotifications({ tag: TAG });
      // one entry per agent (its tag): newer news about it replaces the older
      const before = (shown?.data?.items ?? []).filter((i) => i.key !== m.tag);
      const items = [{ key: m.tag, title: m.title, body: m.body, url: m.url }, ...before].slice(0, MAX);
      const [top, ...rest] = items;
      await self.registration.showNotification(top.title, {
        body: [top.body, ...rest.map((i) => `• ${i.title}`)].filter(Boolean).join("\n"),
        tag: TAG,
        // it replaces the one shown – and still buzzes
        renotify: true,
        icon: "/remote-icon-192.png",
        // the status bar's small icon: Android only takes its shape (white on transparent), else a bell
        badge: "/remote-badge.png",
        data: { items, url: rest.length ? "/" : top.url },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = open[0];
      if (client) {
        await client.focus();
        // (navigate works for pages this worker controls – the app is one from its second load on)
        return client.navigate ? client.navigate(url).catch(() => client.postMessage({ open: url })) : client.postMessage({ open: url });
      }
      return self.clients.openWindow(url);
    })(),
  );
});
