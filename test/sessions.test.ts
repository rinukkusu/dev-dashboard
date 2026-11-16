import { afterAll, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeKeyExtractor } from "../src/correlate.ts";
import { SessionReader } from "../src/sessions.ts";

const dir = await mkdtemp(join(tmpdir(), "sessions-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

const T = (hm: string) => `2026-11-13T${hm}:00.000Z`;
const line = (o: object) => JSON.stringify(o) + "\n";
const user = (hm: string, content: unknown, extra: object = {}) => line({ type: "user", timestamp: T(hm), cwd: "C:\\Users\\me\\CleverTax", message: { role: "user", content }, ...extra });
const claude = (hm: string, text: string) => line({ type: "assistant", timestamp: T(hm), message: { content: [{ type: "text", text }] } });

test("active stretches per session: a pause over 10 min splits, my prompts counted, keys from the stretch", async () => {
  await mkdir(join(dir, "C--Users-me-CleverTax"), { recursive: true });
  const file = join(dir, "C--Users-me-CleverTax", "s1.jsonl");
  await writeFile(
    file,
    line({ type: "ai-title", aiTitle: "CT-2052 Umsetzungsplan" }) +
      user("08:00", "<command-name>/clear</command-name>") + // not typed by me
      user("08:01", "plan für ct-2052 bitte") +
      claude("08:03", "Plan steht, siehe CT-2005 als Vorlage") +
      user("08:05", [{ type: "tool_result", content: "…" }]) +
      line({ type: "assistant", timestamp: T("08:06"), isSidechain: true, message: { content: [] } }) +
      // 30 min later Claude finishes something on its own: a stretch without prompts
      claude("08:36", "Build fertig") +
      claude("08:40", "Tests grün") +
      // a stretch that names no ticket gets the session's keys
      user("09:30", "weiter") +
      '{"type":"user","timestamp":"2026-11-13T09:', // half-written last line
  );
  const reader = new SessionReader(dir, makeKeyExtractor(["CT"]));
  const day = [Date.parse("2026-11-13T00:00:00Z"), Date.parse("2026-11-14T00:00:00Z")] as const;
  const got = await reader.between(...day);
  expect(got.map((w) => `${w.start.slice(11, 16)}-${w.end.slice(11, 16)} ${w.prompts} ${w.keys.join(",")}`)).toEqual([
    "08:01-08:05 1 CT-2052,CT-2005",
    "08:36-08:40 0 CT-2052,CT-2005",
    "09:30-09:30 1 CT-2052,CT-2005",
  ]);
  expect(got[0]).toMatchObject({ session: "s1", title: "CT-2052 Umsetzungsplan", project: "CleverTax" });

  // the session goes on: the half line is completed and another prompt follows
  await appendFile(file, '35:00.000Z","message":{"content":"und CT-2100 auch"}}\n');
  const more = await reader.between(...day);
  expect(more.at(-1)).toMatchObject({ start: T("09:30"), end: T("09:35"), prompts: 2, keys: ["CT-2100"] });
  // outside the range: nothing
  expect(await reader.between(Date.parse("2026-11-14T00:00:00Z"), Date.parse("2026-11-15T00:00:00Z"))).toEqual([]);
});
