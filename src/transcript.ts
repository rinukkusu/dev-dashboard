// Claude Code transcripts (~/.claude/projects/<cwd>/<session id>.jsonl) as a chat history.
// One JSON object per line; we only keep what a person would see in the conversation:
// their prompts, Claude's answers and a one-liner per tool call.
import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  at?: string;
};

export type Chat = {
  title?: string;
  messages: ChatMessage[];
  /** file size – the client sends it back so an unchanged transcript isn't parsed again */
  size: number;
};

/** What herdr knows about the agent's own session (needs herdr's Claude integration). */
export type SessionRef = { kind: "id" | "path"; value: string };

/** Claude names the project folder after the cwd with everything but letters and digits as "-". */
export const projectDirName = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

const exists = (path: string) => stat(path).then((s) => s.isFile(), () => false);

/**
 * The transcript of an agent: by session id if herdr reported one, otherwise the most recently
 * written session in the project folder of the agent's cwd (a good guess while it's running).
 */
export async function findTranscript(projectsDir: string, ref: SessionRef | undefined, cwd: string | undefined): Promise<string | undefined> {
  if (ref) {
    // a reported path is a path on herdr's machine – inside Docker only its file name helps
    if (ref.kind === "path" && (await exists(ref.value))) return ref.value;
    const id = basename(ref.value).replace(/\.jsonl$/, "");
    if (cwd) {
      const direct = join(projectsDir, projectDirName(cwd), `${id}.jsonl`);
      if (await exists(direct)) return direct;
    }
    const dirs = await readdir(projectsDir).catch(() => [] as string[]);
    for (const d of dirs) {
      const p = join(projectsDir, d, `${id}.jsonl`);
      if (await exists(p)) return p;
    }
  }
  if (!cwd) return undefined;
  const dir = join(projectsDir, projectDirName(cwd));
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".jsonl"));
  const dated = await Promise.all(files.map(async (f) => ({ f, t: (await stat(join(dir, f))).mtimeMs })));
  const newest = dated.sort((a, b) => b.t - a.t)[0];
  return newest && join(dir, newest.f);
}

type Block = { type: string; text?: string; name?: string; input?: Record<string, unknown> };
type Entry = {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  aiTitle?: string;
  message?: { id?: string; content?: string | Block[] };
};

/** Things Claude Code writes as "user" that the person didn't type. */
const isNoise = (text: string) => /^\s*<(command-|local-command-|system-reminder|task-notification)/.test(text) || /^\[Request interrupted/.test(text);

/** "Bash: git status" – the input field that says the most about a tool call. */
function toolLine(b: Block): string {
  const i = b.input ?? {};
  const pick = ["description", "command", "file_path", "pattern", "url", "query", "prompt", "skill"].map((k) => i[k]).find((v) => typeof v === "string") as string | undefined;
  const detail = pick?.split("\n")[0]?.slice(0, 140);
  return detail ? `${b.name}: ${detail}` : (b.name ?? "tool");
}

export function parseTranscript(lines: string[], limit = 200): Omit<Chat, "size"> {
  const messages: ChatMessage[] = [];
  let title: string | undefined;
  for (const line of lines) {
    let e: Entry;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // the first line of a tail read is usually cut off
    }
    if (e.type === "ai-title" && e.aiTitle) title = e.aiTitle;
    if ((e.type !== "user" && e.type !== "assistant") || e.isSidechain || e.isMeta) continue;
    const content = e.message?.content;
    const blocks: Block[] = typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);
    blocks.forEach((b, n) => {
      const id = `${e.uuid ?? e.message?.id ?? messages.length}:${n}`;
      if (b.type === "text" && b.text?.trim() && !(e.type === "user" && isNoise(b.text))) {
        messages.push({ id, role: e.type as "user" | "assistant", text: b.text.trim(), at: e.timestamp });
      } else if (b.type === "tool_use" && e.type === "assistant") {
        messages.push({ id, role: "tool", text: toolLine(b), at: e.timestamp });
      }
      // thinking, tool results, images: not part of the chat view
    });
  }
  return { title, messages: messages.slice(-limit) };
}

/** Reads only the end of big transcripts – a long session easily has tens of MB. */
export async function readChat(path: string, maxBytes = 3_000_000): Promise<Chat> {
  const f = await open(path, "r");
  try {
    const { size } = await f.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    await f.read(buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    return { ...parseTranscript(lines), size };
  } finally {
    await f.close();
  }
}
