// What a waiting agent asks, read off its screen: Claude Code writes a question (AskUserQuestion,
// a permission prompt) to its transcript only once it's answered, so the screen is the only place.

/** a full-width rule: Claude Code draws one above its question box (and before "Chat about this") */
const RULE = /^\s*[─━]{8,}\s*$/;
/** a numbered choice: "❯ 1. Yes", "  2. No" */
const CHOICE = /^\s*(?:[❯›>]\s*)?(\d)\.\s+\S/;

/** How far back to look: the question box is at the bottom, everything above is the conversation. */
const TAIL = 40;
/** Without a rule to start at, this many lines from the bottom. */
const FALLBACK = 16;

/** The question (from the rule above it on, rules left out) and the numbers of its choices – 1 to 3 if none are seen. */
export function questionOf(screen: string): { text: string; choices: number[] } {
  const lines = screen.replace(/\s+$/, "").split("\n").slice(-TAIL);
  const start = lines.findIndex((l) => RULE.test(l));
  const box = start >= 0 ? lines.slice(start + 1) : lines.slice(-FALLBACK);
  const text = box
    .filter((l) => !RULE.test(l))
    .join("\n")
    .replace(/^\s*\n/, "");
  const choices = [...new Set(box.map((l) => CHOICE.exec(l)?.[1]).filter((n): n is string => !!n).map(Number))].sort((a, b) => a - b);
  return { text, choices: choices.length ? choices : [1, 2, 3] };
}
