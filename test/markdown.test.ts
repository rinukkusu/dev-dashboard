import { expect, test } from "bun:test";
import { mdToHtml } from "../src/markdown.ts";

test("headings, paragraphs with line breaks, bold/italic/code inline", () => {
  expect(mdToHtml("I found it.\n\n## Issue testprojekt#2: \"Add fancy CSS\"\nThe description is *one* line: **bold** and `<title>`.")).toBe(
    '<p>I found it.</p><h4>Issue testprojekt#2: &quot;Add fancy CSS&quot;</h4><p>The description is <i>one</i> line: <b>bold</b> and <code>&lt;title&gt;</code>.</p>',
  );
});

test("lists: bullets, numbered, nested, continued lines", () => {
  expect(mdToHtml("- a\n- b\n  - b1\n- c")).toBe("<ul><li>a</li><li>b<ul><li>b1</li></ul></li><li>c</li></ul>");
  expect(mdToHtml("1. **Base:** wait\n   until merged\n2. Then")).toBe("<ol><li><b>Base:</b> wait<br>until merged</li><li>Then</li></ol>");
  expect(mdToHtml("3. three\n4. four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>');
});

test("code blocks stay as they are; diff and suggestion lines coloured", () => {
  expect(mdToHtml("```ts\nconst a = 1 < 2;\n```")).toBe('<pre class="code">const a = 1 &lt; 2;\n</pre>');
  expect(mdToHtml("```diff\n-old\n+new\n same\n```")).toBe('<pre class="code"><span class="d-del">-old\n</span><span class="d-add">+new\n</span> same\n</pre>');
  expect(mdToHtml("```suggestion:-0+0\nfixed\n```", "Vorschlag")).toBe('<pre class="code suggestion" data-label="Vorschlag"><span class="d-add">fixed\n</span></pre>');
  // markdown inside code is not markdown
  expect(mdToHtml("```\n## not a heading\n- not a list\n```")).toBe('<pre class="code">## not a heading\n- not a list\n</pre>');
});

test("links, bare URLs (the artifact link), quotes, rules and tables", () => {
  expect(mdToHtml("See https://claude.ai/artifact/abc-1.")).toBe('<p>See <a href="https://claude.ai/artifact/abc-1" target="_blank" rel="noopener">https://claude.ai/artifact/abc-1</a>.</p>');
  expect(mdToHtml("[MR !1](https://gitlab/x/-/merge_requests/1)")).toBe('<p><a href="https://gitlab/x/-/merge_requests/1" target="_blank" rel="noopener">MR !1</a></p>');
  expect(mdToHtml("> quoted\n> **too**")).toBe("<blockquote><p>quoted<br><b>too</b></p></blockquote>");
  expect(mdToHtml("a\n\n---\n\nb")).toBe("<p>a</p><hr><p>b</p>");
  expect(mdToHtml("| File | Change |\n|---|:--:|\n| `a.ts` | new |")).toBe(
    "<table><thead><tr><th>File</th><th>Change</th></tr></thead><tbody><tr><td><code>a.ts</code></td><td>new</td></tr></tbody></table>",
  );
});

test("nothing gets through as HTML", () => {
  const html = mdToHtml('<img src=x onerror=alert(1)> [x](javascript:alert(1)) "quote" & **<b>**');
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript');
  expect(html).toContain("&lt;img");
  expect(html).toContain("<b>&lt;b&gt;</b>");
});

test("the page gets the very same function as source text – it must stand on its own", () => {
  const fn = new Function(`return (${mdToHtml.toString()})`)() as typeof mdToHtml;
  const sample = "## Plan\n- **a** `b`\n\n> q\n\n```diff\n+x\n```\n| a | b |\n|--|--|\n| 1 | 2 |";
  expect(fn(sample, "S")).toBe(mdToHtml(sample, "S"));
});
