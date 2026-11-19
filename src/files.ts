// Files in a conversation, for the server and the web app alike: the paths an agent's chat mentions
// (Claude names a file it made by its path) and the line a file sent from the phone travels as.

/** a file sent from the phone goes to the agent as a line of its own: "📎 C:\…\IMG_1234.jpg" */
export const ATTACHED = "📎 ";

const NAME = String.raw`[^\s"'<>|*?\x60\\/]`;
/** absolute paths with a file extension – C:\x\y.png, C:/x/y.png or /home/x/y.png (not the path part of a URL) */
const PATH = new RegExp(String.raw`[A-Za-z]:[\\/](?:${NAME}+[\\/])*${NAME}+\.[A-Za-z0-9]{1,8}\b|(?<![\w.~:/\\-])\/(?:${NAME}+\/)+${NAME}+\.[A-Za-z0-9]{1,8}\b`, "g");

/** shown as a picture */
export const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
/**
 * Worth showing as a file when the agent mentions it: pictures, documents, media, archives – not the
 * source files it names all the time while it works.
 */
const PRESENTABLE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|pdf|docx?|xlsx?|pptx?|odt|ods|csv|txt|log|html?|zip|7z|gz|tar|mp4|mov|webm|mp3|m4a|wav|ogg)$/i;

const isWin = (p: string) => /^[A-Za-z]:[\\/]/.test(p);
const norm = (p: string) => (isWin(p) ? p.replace(/\//g, "\\").toLowerCase() : p);

/** Is the path inside one of the roots (Windows paths: any case, either slash)? null = no limit. */
export function underRoot(path: string, roots: string[] | null): boolean {
  if (!roots) return true;
  const p = norm(path);
  return roots.some((r) => {
    const root = norm(r).replace(/[\\/]+$/, "");
    return p.startsWith(root) && /^[\\/]/.test(p.slice(root.length));
  });
}

/** The absolute file paths in a text, each once, in order. */
export function filePaths(text: string): string[] {
  return [...new Set(text.match(PATH) ?? [])];
}

/** The files a message shows: what was sent from the phone, and whatever presentable file it names under the roots. */
export function messageFiles(text: string, roots: string[] | null): { text: string; files: string[] } {
  const attached: string[] = [];
  const rest = text
    .split("\n")
    .filter((l) => {
      // only a line that's nothing but a path – not one quoting it with more around
      const path = l.startsWith(ATTACHED) ? l.slice(ATTACHED.length).trim() : "";
      if (!path || filePaths(path)[0] !== path) return true;
      attached.push(path);
      return false;
    })
    .join("\n")
    .trim();
  const named = filePaths(rest).filter((p) => PRESENTABLE.test(p) && underRoot(p, roots));
  return { text: rest, files: [...new Set([...attached, ...named])] };
}

/** "IMG_1234.jpg" – the last part of a path of either kind */
export const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;
