import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTranscript, parseTranscript, projectDirName, readChat } from "../src/transcript.ts";

const line = (o: object) => JSON.stringify(o);
const lines = [
  line({ type: "user", isMeta: true, message: { content: "<local-command-caveat>…</local-command-caveat>" } }),
  line({ type: "user", uuid: "u1", timestamp: "2026-10-20T10:00:00Z", message: { content: "Fix den Versand bitte" } }),
  line({ type: "assistant", uuid: "a1", message: { content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "Schau ich mir an." }] } }),
  line({ type: "assistant", uuid: "a2", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git status\ngit diff", description: "Show working tree status" } }] } }),
  line({ type: "user", uuid: "u2", message: { content: [{ type: "tool_result", content: "clean" }] } }),
  line({ type: "user", uuid: "u3", message: { content: "<command-name>/clear</command-name>" } }),
  line({ type: "assistant", uuid: "s1", isSidechain: true, message: { content: [{ type: "text", text: "subagent chatter" }] } }),
  line({ type: "ai-title", aiTitle: "Formular Versand" }),
  line({ type: "assistant", uuid: "a3", message: { content: [{ type: "text", text: "Fertig – `send()` war kaputt." }] } }),
  "{ cut off",
];

test("only what a person sees: prompts, answers, one line per tool call", () => {
  const chat = parseTranscript(lines);
  expect(chat.title).toBe("Formular Versand");
  expect(chat.messages.map((m) => `${m.role}: ${m.text}`)).toEqual([
    "user: Fix den Versand bitte",
    "assistant: Schau ich mir an.",
    "tool: Bash: Show working tree status",
    "assistant: Fertig – `send()` war kaputt.",
  ]);
});

test("project folder name is the cwd with every other character as -", () => {
  expect(projectDirName("C:\\Users\\Max_Lokal\\Documents\\Github\\HausSuche")).toBe("C--Users-Max-Lokal-Documents-Github-HausSuche");
  expect(projectDirName("/home/max/dev-dashboard")).toBe("-home-max-dev-dashboard");
});

const root = await mkdtemp(join(tmpdir(), "transcripts-"));
afterAll(() => rm(root, { recursive: true, force: true }));

test("finds the transcript by session id, else the newest one of the cwd", async () => {
  const cwd = "/work/app";
  const dir = join(root, projectDirName(cwd));
  await mkdir(dir, { recursive: true });
  await mkdir(join(root, "-elsewhere"), { recursive: true });
  await writeFile(join(dir, "old.jsonl"), lines.join("\n"));
  await writeFile(join(dir, "new.jsonl"), lines.join("\n"));
  await writeFile(join(root, "-elsewhere", "abc.jsonl"), lines.join("\n"));
  await utimes(join(dir, "old.jsonl"), new Date(2020, 0, 1), new Date(2020, 0, 1));

  expect(await findTranscript(root, { kind: "id", value: "abc" }, cwd)).toBe(join(root, "-elsewhere", "abc.jsonl"));
  // a path from herdr's machine that doesn't exist here: its file name still finds it
  expect(await findTranscript(root, { kind: "path", value: "/home/max/.claude/projects/x/abc.jsonl" }, undefined)).toBe(join(root, "-elsewhere", "abc.jsonl"));
  expect(await findTranscript(root, undefined, cwd)).toBe(join(dir, "new.jsonl"));
  expect(await findTranscript(root, undefined, "/nothing/here")).toBeUndefined();
});

test("readChat reads only the end of a big file and drops the cut-off first line", async () => {
  const path = join(root, "big.jsonl");
  const filler = Array.from({ length: 2000 }, (_, i) => line({ type: "user", uuid: `f${i}`, message: { content: `filler ${i}` } }));
  await writeFile(path, [...filler, ...lines].join("\n"));
  const chat = await readChat(path, 5_000);
  expect(chat.messages.at(-1)?.text).toBe("Fertig – `send()` war kaputt.");
  expect(chat.messages.some((m) => m.text === "filler 0")).toBe(false);
  expect(chat.size).toBeGreaterThan(5_000);
});
