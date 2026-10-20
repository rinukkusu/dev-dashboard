import { expect, test } from "bun:test";
import { jiraToHtml } from "../src/jira-wiki.ts";

test("inline formatting, mentions, links", () => {
  expect(jiraToHtml("Hi [~mari], *wichtig*: _bitte_ {{npm ci}} statt -install- (/)")).toBe(
    `<p>Hi <span class="mention">@mari</span>, <b>wichtig</b>: <i>bitte</i> <code>npm ci</code> statt <s>install</s> ✅</p>`,
  );
  expect(jiraToHtml("[Spec|https://wiki.example.com/a?b=1&c=2] und https://ci.example.com/run/5")).toBe(
    `<p><a href="https://wiki.example.com/a?b=1&amp;c=2">Spec</a> und <a href="https://ci.example.com/run/5">https://ci.example.com/run/5</a></p>`,
  );
});

test("everything is escaped, script links are dropped", () => {
  const html = jiraToHtml(`<img src=x onerror=alert(1)> [klick|javascript:alert(1)] {color:red;background:url(x)}x{color}`);
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript');
  expect(html).toContain("&lt;img");
});

test("code blocks stay untouched, quotes and panels hold markup", () => {
  expect(jiraToHtml("{code:java}\nif (a < b) { *x* }\n{code}")).toBe("<pre><code>if (a &lt; b) { *x* }</code></pre>");
  expect(jiraToHtml("{quote}*Zitat*{quote}")).toBe("<blockquote><p><b>Zitat</b></p></blockquote>");
  expect(jiraToHtml("{noformat}\n  _so_ bleibt's\n{noformat}")).toBe("<pre>  _so_ bleibt&#39;s</pre>");
});

test("lists nest, tables and headings", () => {
  expect(jiraToHtml("* eins\n** eins a\n* zwei\n# erster")).toBe("<ul><li>eins<ul><li>eins a</li></ul></li><li>zwei</li></ul><ol><li>erster</li></ol>");
  expect(jiraToHtml("||Feld||Wert||\n|a|*b*|")).toBe("<table><tr><th>Feld</th><th>Wert</th></tr><tr><td>a</td><td><b>b</b></td></tr></table>");
  expect(jiraToHtml("h2. Ergebnis\nZeile 1\nZeile 2\n\nNeuer Absatz")).toBe("<h4>Ergebnis</h4><p>Zeile 1<br>Zeile 2</p><p>Neuer Absatz</p>");
});

test("attachments are named, not loaded", () => {
  expect(jiraToHtml("siehe !screenshot.png|thumbnail! und [^log.txt]")).toBe(
    `<p>siehe <span class="attachment">🖼 screenshot.png</span> und <span class="attachment">📎 log.txt</span></p>`,
  );
});
