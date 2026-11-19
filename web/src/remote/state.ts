import type { RemoteMessage, RemoteSpace } from "@shared/view.ts";
import { useEffect, useState } from "react";
import { create } from "zustand";
import type { Connection } from "@/lib/store";

type State = {
  spaces: RemoteSpace[];
  error?: string;
  connection: Connection;
};

export const useRemote = create<State>(() => ({ spaces: [], connection: "connecting" }));

/**
 * herdr's spaces over the WebSocket: all of them on connect and after every change. Reconnects
 * with a growing pause; a closed connection with code 4001 means this device was removed.
 */
export function connectSpaces(onRevoked: () => void): () => void {
  let ws: WebSocket | undefined;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const open = () => {
    const url = new URL("/ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(url);
    useRemote.setState({ connection: "connecting" });
    ws.onopen = () => {
      retry = 0;
      useRemote.setState({ connection: "live" });
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as RemoteMessage;
      if (msg.type === "spaces") useRemote.setState({ spaces: msg.spaces, error: msg.error });
    };
    ws.onclose = (e) => {
      if (stopped) return;
      if (e.code === 4001) return onRevoked();
      useRemote.setState({ connection: "offline" });
      timer = setTimeout(open, Math.min(15_000, 1000 * 2 ** retry++));
    };
  };
  open();
  // a phone puts the page to sleep: on wake-up, reconnect right away instead of waiting out the pause
  const wake = () => {
    if (document.visibilityState === "visible" && ws?.readyState === WebSocket.CLOSED) {
      clearTimeout(timer);
      retry = 0;
      open();
    }
  };
  document.addEventListener("visibilitychange", wake);
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", wake);
    ws?.close();
  };
}

export type Tab = "chats" | "spaces";
/** the tab last looked at – where an agent's back button leads */
let lastTab: Tab = "chats";

/** "#/agent/w3:p2" → the agent's pane; "#/spaces" → the spaces; anything else → the chats. */
export function useRoute(): { pane?: string; tab: Tab } {
  const read = () => {
    const m = location.hash.match(/^#\/agent\/(.+)$/);
    if (m) return { pane: decodeURIComponent(m[1]!), tab: lastTab };
    lastTab = location.hash === "#/spaces" ? "spaces" : "chats";
    return { tab: lastTab };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const agentHref = (pane: string) => `#/agent/${encodeURIComponent(pane)}`;
export const tabHref = (tab: Tab) => (tab === "spaces" ? "#/spaces" : "#/");

/** "iPhone · Safari" – how the device shows up in the dashboard's list. */
export function deviceName(ua = navigator.userAgent): string {
  const device = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? (ua.match(/Android[^;)]*;\s*([^;)]+?)\s*(?:Build|\))/)?.[1] ?? "Android") : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : "Browser";
  const browser = /EdgA?\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return browser ? `${device} · ${browser}` : device;
}
