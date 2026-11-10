// The piece of a PR's diff a thread is about – what GitLab and ADO show above a code comment.
// Sources hand in their diff (GitLab: unified diff text, ADO: changed blocks plus both file
// versions), this turns it into lines and cuts out the commented lines with a little context.

import type { DiffLine } from "./model.ts";

/** A unified diff ("@@ -1,4 +1,5 @@ …") as lines with their numbers; a gap between hunks. */
export function parseUnified(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let o = 0;
  let n = 0;
  for (const line of diff.split("\n")) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      if (out.length) out.push({ kind: "gap", text: "" });
      o = Number(hunk[1]);
      n = Number(hunk[2]);
      continue;
    }
    if (!o && !n) continue; // file header before the first hunk
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const text = line.slice(1);
    if (line.startsWith("+")) out.push({ kind: "add", new: n++, text });
    else if (line.startsWith("-")) out.push({ kind: "del", old: o++, text });
    else if (line.startsWith(" ") || line === "") out.push({ kind: "ctx", old: o++, new: n++, text });
  }
  // a trailing empty line of the text isn't part of the diff
  while (out.at(-1)?.kind === "ctx" && out.at(-1)!.text === "" && diff.endsWith("\n")) out.pop();
  return out;
}

/** ADO's changed blocks (File Diffs API) over both versions of a file, as lines. */
export type Block = {
  changeType: number | string; // 0/none, 1/add, 2/delete, 3/edit
  originalLineNumberStart: number;
  originalLinesCount: number;
  modifiedLineNumberStart: number;
  modifiedLinesCount: number;
};

export function blocksToLines(original: string[], modified: string[], blocks: Block[]): DiffLine[] {
  const out: DiffLine[] = [];
  let o = 1;
  let n = 1;
  const ctxUntil = (mEnd: number) => {
    for (; n < mEnd && n <= modified.length; o++, n++) out.push({ kind: "ctx", old: o, new: n, text: modified[n - 1] ?? "" });
  };
  for (const b of [...blocks].sort((a, b) => a.modifiedLineNumberStart - b.modifiedLineNumberStart)) {
    const type = String(b.changeType).toLowerCase();
    if (type === "0" || type === "none") continue; // unchanged: filled in as context anyway
    // unchanged lines up to the block keep both sides in step, so o needs no help from the block
    ctxUntil(b.modifiedLineNumberStart);
    for (let i = 0; i < b.originalLinesCount; i++, o++) out.push({ kind: "del", old: o, text: original[o - 1] ?? "" });
    for (let i = 0; i < b.modifiedLinesCount; i++, n++) out.push({ kind: "add", new: n, text: modified[n - 1] ?? "" });
  }
  ctxUntil(modified.length + 1);
  return out;
}

/**
 * The commented lines (line..end on the new side, or on the old one for a comment on removed code)
 * with `context` lines around them, marked as hit. Long ranges are cut to `max` lines.
 */
export function windowAround(lines: DiffLine[], line: number, end = line, side: "left" | "right" = "right", context = 3, max = 40): DiffLine[] {
  const num = (l: DiffLine) => (side === "right" ? (l.kind === "del" ? undefined : l.new) : l.kind === "add" ? undefined : l.old);
  const hits = lines.flatMap((l, i) => {
    const k = num(l);
    return k !== undefined && k >= line && k <= Math.max(line, end) ? [i] : [];
  });
  if (!hits.length) return [];
  const from = Math.max(0, hits[0]! - context);
  const to = Math.min(lines.length - 1, Math.min(hits.at(-1)!, hits[0]! + max) + context);
  const hit = new Set(hits);
  const out = lines.slice(from, to + 1).map((l, i) => (hit.has(from + i) ? { ...l, hit: true } : l));
  // a gap at either end says nothing
  while (out[0]?.kind === "gap") out.shift();
  while (out.at(-1)?.kind === "gap") out.pop();
  return out;
}
