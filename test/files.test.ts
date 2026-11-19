import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileName, filePaths, messageFiles, underRoot } from "../src/files.ts";
import { fileHeaders, parseFolderMap, safeName, saveUpload, toLocal } from "../src/remote-files.ts";

const scratch = String.raw`C:\Users\me\AppData\Local\Temp\claude\abc\s1\scratchpad`;

test("filePaths: absolute paths with an extension, not URLs, relative paths or line numbers", () => {
  const text = [
    `Screenshot: ${scratch}\\shot.png – und \`${scratch}\\report.pdf\`.`,
    "Code in src/remote.ts:12 und C:/Users/me/repo/web/app.tsx:40, Doku https://example.com/a/b.png",
    "Linux: /home/me/out/chart.svg, Ordner C:\\Users\\me\\repo ohne Datei",
  ].join("\n");
  expect(filePaths(text)).toEqual([`${scratch}\\shot.png`, `${scratch}\\report.pdf`, "C:/Users/me/repo/web/app.tsx", "/home/me/out/chart.svg"]);
});

test("messageFiles: what I sent, and the presentable files the agent names under the roots", () => {
  const roots = [String.raw`C:\Users\me\AppData\Local\Temp\claude`, String.raw`C:\Users\me\uploads`];
  const mine = messageFiles(`Was ist das?\n\n📎 C:\\Users\\me\\uploads\\2026-11-19\\101500-ab12-log.ts`, roots);
  expect(mine).toEqual({ text: "Was ist das?", files: [String.raw`C:\Users\me\uploads\2026-11-19\101500-ab12-log.ts`] });
  const answer = messageFiles(`Fertig: ${scratch}\\shot.png, Code in C:\\Users\\me\\repo\\x.ts, Bild C:\\Windows\\secret.png, ${scratch.toLowerCase()}\\b.pdf`, roots);
  // source files aren't presented, nor anything outside the roots; the case of a Windows path doesn't matter
  expect(answer.files).toEqual([`${scratch}\\shot.png`, `${scratch.toLowerCase()}\\b.pdf`]);
  expect(messageFiles(`Bild C:\\Windows\\x.png`, null).files).toEqual([String.raw`C:\Windows\x.png`]);
  // a quoted attachment line with more around it stays text
  const quoted = `Got it: "Schau mal\n📎 C:\\Users\\me\\uploads\\a.png" – on it.`;
  expect(messageFiles(quoted, roots)).toEqual({ text: quoted, files: [String.raw`C:\Users\me\uploads\a.png`] });
  expect(underRoot("C:/Users/me/uploadsX/a.png", roots)).toBe(false);
  expect(fileName(`${scratch}\\shot.png`)).toBe("shot.png");
});

test("toLocal: the most specific folder, never above it", () => {
  const maps = [parseFolderMap(String.raw`C:\Users\me\AppData\Local\Temp\claude=/host/claude`), parseFolderMap(String.raw`C:\Users\me\uploads\=/uploads/`)];
  expect(toLocal(maps, `${scratch}\\shot.png`)?.endsWith(join("claude", "abc", "s1", "scratchpad", "shot.png"))).toBe(true);
  expect(toLocal(maps, "c:/users/me/uploads/2026-11-19/a.jpg")?.endsWith(join("uploads", "2026-11-19", "a.jpg"))).toBe(true);
  expect(toLocal(maps, String.raw`C:\Users\me\AppData\Local\Temp\claude\..\..\secret.txt`)).toBeUndefined();
  expect(toLocal(maps, String.raw`C:\Users\me\AppData\Local\Temp\claudeX\a.png`)).toBeUndefined();
  expect(toLocal(maps, String.raw`C:\Users\me\AppData\Local\Temp\claude`)).toBeUndefined();
  expect(toLocal(maps, "/etc/passwd")).toBeUndefined();
  expect(() => parseFolderMap("=/x")).toThrow();
});

test("uploads: a day folder, a unique safe name, the path as the agents see it", async () => {
  const local = await mkdtemp(join(tmpdir(), "uploads-"));
  try {
    const saved = await saveUpload({ host: String.raw`C:\Users\me\uploads`, local }, "../../Ärger mit $(rm -rf).png", new Uint8Array([1]), new Date(2026, 10, 19, 8, 5, 9));
    expect(saved.path).toMatch(/^C:\\Users\\me\\uploads\\2026-11-19\\080509-[0-9a-f]{4}-Arger_mit_rm_-rf_\.png$/);
    expect(await Bun.file(join(local, "2026-11-19", saved.name)).bytes()).toEqual(new Uint8Array([1]));
    expect(safeName("...")).toBe("file");
  } finally {
    await rm(local, { recursive: true, force: true });
  }
});

test("fileHeaders: pictures inline, unknown types as a download, everything sandboxed", () => {
  expect(fileHeaders("image/png", "a.png")["Content-Disposition"]).toStartWith("inline");
  expect(fileHeaders("application/zip", "a.zip")["Content-Disposition"]).toStartWith("attachment");
  expect(fileHeaders("text/html", "a.html")["Content-Security-Policy"]).toContain("sandbox");
});
