import { expect, test } from "bun:test";
import type { Change } from "../src/model.ts";
import { isUnseen, sameThing } from "../web/src/lib/seen.ts";

const change = (id: string, detectedAt: string, extra: Partial<Change> = {}): Change => ({
  id, at: "2026-11-06T08:00:00Z", detectedAt, kind: "pr-comment", resource: "ado:pr:7", ref: "!7", url: "u/7", subject: "PR", ...extra,
});

test("unseen: arrived after 'mark all seen', not marked on its own, not muted", () => {
  const lastSeen = Date.parse("2026-11-06T10:00:00Z");
  const seen = { lastSeen, ids: new Set(["b"]) };
  // the comment is older than lastSeen, but the poll found it later: that's what counts
  expect(isUnseen(change("a", "2026-11-06T10:05:00Z"), seen, new Set())).toBe(true);
  expect(isUnseen(change("b", "2026-11-06T10:05:00Z"), seen, new Set())).toBe(false);
  expect(isUnseen(change("c", "2026-11-06T09:00:00Z"), seen, new Set())).toBe(false);
  expect(isUnseen(change("a", "2026-11-06T10:05:00Z"), seen, new Set(["ado:pr:7"]))).toBe(false);
});

test("opening a change marks everything about the same PR – or the same link without one", () => {
  expect(sameThing(change("a", "x"))).toBe("ado:pr:7");
  expect(sameThing(change("a", "x", { resource: undefined }))).toBe("u/7");
});
