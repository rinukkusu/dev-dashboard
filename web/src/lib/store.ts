import { create } from "zustand";
import { isLang, type Lang } from "@shared/i18n.ts";
import type { ServerMessage, ViewData } from "@shared/view.ts";

export type Connection = "connecting" | "live" | "offline";

type State = {
  view?: ViewData;
  connection: Connection;
  /** a poll is running on the server */
  polling: boolean;
  /** chosen in this browser (cookie, shared with the old page); otherwise DASHBOARD_LANG */
  lang?: Lang;
  setLang(lang: Lang): void;
};

const cookieLang = () => {
  const value = document.cookie.match(/(?:^|;\s*)lang=([^;]+)/)?.[1];
  return isLang(value) ? value : undefined;
};

export const useStore = create<State>((set) => ({
  connection: "connecting",
  polling: false,
  lang: cookieLang(),
  setLang(lang) {
    document.cookie = `lang=${lang}; path=/; max-age=31536000; SameSite=Lax`;
    document.documentElement.lang = lang;
    set({ lang });
  },
}));

/** The language to show: the browser's choice, otherwise the server's default. */
export const useLang = (): Lang => useStore((s) => s.lang ?? s.view?.defaultLang ?? "en");

/**
 * Keeps a WebSocket to /ws?v=2 open: the server sends the whole view on connect and after every
 * change. Reconnects with a growing pause (1 s … 30 s) when the server is gone.
 */
export function connect(): () => void {
  let ws: WebSocket | undefined;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const open = () => {
    const url = new URL("/ws?v=2", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(url);
    useStore.setState({ connection: "connecting" });
    ws.onopen = () => {
      retry = 0;
      useStore.setState({ connection: "live" });
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.type === "view") useStore.setState({ view: msg.view, polling: false });
      else if (msg.type === "polling") useStore.setState({ polling: true });
    };
    ws.onclose = () => {
      if (stopped) return;
      useStore.setState({ connection: "offline", polling: false });
      timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ws?.close();
  };
}

/** JSON request to the dashboard server; rejects with the server's error body. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw json;
  return json as T;
}
