import { expect, test } from "bun:test";
import { blocksToLines, parseUnified, windowAround } from "../src/diffview.ts";

const unified = [
  "@@ -1,4 +1,5 @@",
  " import x",
  "-const a = 1;",
  "+const a = 2;",
  "+const b = 3;",
  " ",
  " export { a };",
  "@@ -20,2 +21,2 @@ function later() {",
  " one",
  "-two",
  "+zwei",
  "\\ No newline at end of file",
  "",
].join("\n");

test("parseUnified: numbers on both sides, a gap between hunks", () => {
  const lines = parseUnified(unified);
  expect(lines.map((l) => `${l.kind} ${l.old ?? ""}/${l.new ?? ""} ${l.text}`)).toEqual([
    "ctx 1/1 import x",
    "del 2/ const a = 1;",
    "add /2 const a = 2;",
    "add /3 const b = 3;",
    "ctx 3/4 ",
    "ctx 4/5 export { a };",
    "gap / ",
    "ctx 20/21 one",
    "del 21/ two",
    "add /22 zwei",
  ]);
});

test("windowAround: the commented new line with context, marked; a removed line by its old number", () => {
  const lines = parseUnified(unified);
  const right = windowAround(lines, 3, 3, "right", 1);
  expect(right.map((l) => [l.text, !!l.hit])).toEqual([["const a = 2;", false], ["const b = 3;", true], ["", false]]);
  const left = windowAround(lines, 21, 21, "left", 1);
  expect(left.map((l) => [l.kind, l.text, !!l.hit])).toEqual([["ctx", "one", false], ["del", "two", true], ["add", "zwei", false]]);
  // a range, and a line outside the diff
  expect(windowAround(lines, 2, 3, "right", 0).filter((l) => l.hit).map((l) => l.new)).toEqual([2, 3]);
  expect(windowAround(lines, 99)).toEqual([]);
  // no gap at the edges
  expect(windowAround(lines, 21, 21, "right", 3)[0]!.kind).not.toBe("gap");
});

test("blocksToLines: ADO's changed blocks over both versions", () => {
  const original = ["a", "b", "c", "d"];
  const modified = ["a", "B", "c", "d", "e"];
  const lines = blocksToLines(original, modified, [
    { changeType: 0, originalLineNumberStart: 1, originalLinesCount: 1, modifiedLineNumberStart: 1, modifiedLinesCount: 1 },
    { changeType: 3, originalLineNumberStart: 2, originalLinesCount: 1, modifiedLineNumberStart: 2, modifiedLinesCount: 1 },
    { changeType: "add", originalLineNumberStart: 5, originalLinesCount: 0, modifiedLineNumberStart: 5, modifiedLinesCount: 1 },
  ]);
  expect(lines.map((l) => `${l.kind} ${l.old ?? ""}/${l.new ?? ""} ${l.text}`)).toEqual([
    "ctx 1/1 a",
    "del 2/ b",
    "add /2 B",
    "ctx 3/3 c",
    "ctx 4/4 d",
    "add /5 e",
  ]);
});
