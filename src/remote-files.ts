// Files between the phone and the agents. The agents run on the PC and name files by their paths
// there; in Docker this server sees those folders only where they're mounted – a "folder map" says
// where (REMOTE_FILES, REMOTE_UPLOADS: "C:\Users\me=/host/home"). Without Docker the paths are the same.
import { mkdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/** a folder as the agents name it (host) and where this server finds it (local) */
export type FolderMap = { host: string; local: string };

/** "C:\Users\me=/host/home", or just a path when both are the same */
export function parseFolderMap(s: string): FolderMap {
  const at = s.indexOf("=");
  const host = (at < 0 ? s : s.slice(0, at)).trim().replace(/[\\/]+$/, "");
  const local = (at < 0 ? s : s.slice(at + 1)).trim().replace(/[\\/]+$/, "");
  if (!host || !local) throw new Error(`"${s}" isn't a folder or "host folder=local folder"`);
  return { host, local };
}

const isWin = (p: string) => /^[A-Za-z]:[\\/]/.test(p);

/**
 * Where this server finds a file the agents name: in the most specific folder that holds it, and
 * never above that folder ("..", odd segments). undefined = not in any of them.
 */
export function toLocal(maps: FolderMap[], hostPath: string): string | undefined {
  const win = isWin(hostPath);
  const key = (p: string) => (win ? p.replace(/\//g, "\\").toLowerCase() : p);
  const candidates = maps
    .filter((m) => isWin(m.host) === win)
    .filter((m) => key(hostPath).startsWith(key(m.host)) && /^[\\/]/.test(hostPath.slice(m.host.length)))
    .sort((a, b) => b.host.length - a.host.length);
  const m = candidates[0];
  if (!m) return undefined;
  const parts = hostPath.slice(m.host.length).split(win ? /[\\/]+/ : /\/+/).filter(Boolean);
  if (!parts.length || parts.some((p) => p === ".." || p === "." || p.includes("\0"))) return undefined;
  const root = resolve(m.local);
  const file = resolve(join(root, ...parts));
  return file.startsWith(root + sep) ? file : undefined;
}

/** ASCII letters, digits, ".", "-", "_" – a name that's safe on every system and in a prompt */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? "";
  const clean = base
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // Ä → A, not A_
    .replace(/[^\w.-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(-80);
  return clean || "file";
}

/**
 * Keeps a file from the phone in the uploads folder (one folder per day, a unique name) and says
 * where the agents find it.
 */
export async function saveUpload(uploads: FolderMap, name: string, data: Uint8Array, now = new Date()): Promise<{ path: string; name: string }> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const file = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${crypto.randomUUID().slice(0, 4)}-${safeName(name)}`;
  await mkdir(join(uploads.local, day), { recursive: true });
  await Bun.write(join(uploads.local, day, file), data);
  const hostSep = isWin(uploads.host) ? "\\" : "/";
  return { path: [uploads.host, day, file].join(hostSep), name: file };
}

/** shown in the browser (pictures, PDFs, video, plain text) – the rest is a download */
const INLINE = /^(image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)|application\/pdf|video\/|audio\/|text\/plain|text\/csv|text\/html)/;

/** How a file goes out: sandboxed, so nothing in it runs as this page (an SVG's or HTML file's scripts). */
export function fileHeaders(type: string, name: string): Record<string, string> {
  const inline = INLINE.test(type);
  return {
    "Content-Type": type || "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "private, max-age=300",
  };
}
