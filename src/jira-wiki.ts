// Jira wiki markup (what Jira DC's REST v2 returns as comment body) → safe HTML for the comment popover.
// Covers what people actually write in comments; everything is escaped first, so unknown markup
// just shows as text. https://jira.atlassian.com/secure/WikiRendererHelpAction.jspa

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Only links that can't run script. */
const safeUrl = (url: string) => /^(https?:\/\/|mailto:)/i.test(url);

const ICONS: Record<string, string> = {
  "(/)": "✅", "(x)": "❌", "(!)": "⚠️", "(?)": "❓", "(i)": "ℹ️", "(y)": "👍", "(n)": "👎",
  "(on)": "💡", "(*)": "⭐", ":)": "🙂", ":(": "🙁", ":D": "😃", ";)": "😉", ":P": "😛",
};

/** Bold, italics, links, mentions … inside one line of already escaped text. */
function inline(escaped: string, codes: string[]): string {
  const code = (html: string) => `\u0000${codes.push(html) - 1}\u0000`;
  return (
    escaped
      // {{monospace}} first, so nothing inside it gets formatted
      .replace(/\{\{(.+?)\}\}/g, (_, t) => code(`<code>${t}</code>`))
      // [text|url], [url], [~user], [^attachment]
      .replace(/\[([^\[\]|]*?)\|([^\[\]]+?)\]/g, (m, text, url) => {
        const href = url.replace(/&amp;/g, "&");
        return safeUrl(href) ? code(`<a href="${esc(href)}">${text || url}</a>`) : text || m;
      })
      .replace(/\[~(?:accountid:)?([^\]]+)\]/g, (_, user) => code(`<span class="mention">@${user}</span>`))
      .replace(/\[\^([^\]]+)\]/g, (_, file) => code(`<span class="attachment">📎 ${file}</span>`))
      .replace(/\[((?:https?:\/\/|mailto:)[^\]\s]+)\]/g, (_, url) => code(`<a href="${esc(url.replace(/&amp;/g, "&"))}">${url}</a>`))
      // bare URLs
      .replace(/(^|[\s(])((?:https?:\/\/)[^\s<)]+)/g, (_, pre, url) => pre + code(`<a href="${esc(url.replace(/&amp;/g, "&"))}">${url}</a>`))
      // !image.png! or !image.png|thumbnail! – attachments need a Jira login, so just name them
      .replace(/!([^!\s|]+\.(?:png|jpe?g|gif|svg|webp|bmp))(?:\|[^!]*)?!/gi, (_, file) => code(`<span class="attachment">🖼 ${file}</span>`))
      .replace(/\{color:([#a-z0-9]+)\}([\s\S]*?)\{color\}/gi, (_, color, t) => `<span style="color:${color}">${t}</span>`)
      // *bold* _italic_ -strike- +underline+ ^sup^ ~sub~ ??citation??, only at word boundaries
      .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1<b>$2</b>")
      .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1<i>$2</i>")
      .replace(/(^|[\s(])-(?=\S)([^-\n]*?\S)-(?=[\s).,!?:;]|$)/g, "$1<s>$2</s>")
      .replace(/(^|[^\w])\+(?=\S)([^+]*?\S)\+(?!\w)/g, "$1<u>$2</u>")
      .replace(/\^(?=\S)([^^]*?\S)\^/g, "<sup>$1</sup>")
      .replace(/(^|[^\w])~(?=\S)([^~]*?\S)~(?!\w)/g, "$1<sub>$2</sub>")
      .replace(/\?\?(?=\S)(.*?\S)\?\?/g, "<cite>$1</cite>")
      .replace(/(\(\/\)|\(x\)|\(!\)|\(\?\)|\(i\)|\(y\)|\(n\)|\(on\)|\(\*\)|(?<=^|\s):\)|(?<=^|\s):\(|(?<=^|\s):D|(?<=^|\s);\)|(?<=^|\s):P)/g, (m) => ICONS[m] ?? m)
      .replace(/ \\\\ /g, "<br>")
      .replace(/\\\\$/g, "<br>")
  );
}

type ListItem = { ordered: boolean; depth: number; html: string };

/** Nested <ul>/<ol> from "*", "**", "#", "#*" … prefixes. */
function renderList(items: ListItem[]): string {
  let out = "";
  const open: boolean[] = []; // ordered? per open level
  for (const it of items) {
    while (open.length > it.depth) out += open.pop() ? "</li></ol>" : "</li></ul>";
    // "* a" followed by "# b" on the same level: close the bullet list, start a numbered one
    if (open.length === it.depth && open[it.depth - 1] !== it.ordered) out += open.pop() ? "</li></ol>" : "</li></ul>";
    if (open.length === it.depth) out += "</li>";
    while (open.length < it.depth) {
      open.push(it.ordered);
      out += it.ordered ? "<ol>" : "<ul>";
    }
    out += `<li>${it.html}`;
  }
  while (open.length) out += open.pop() ? "</li></ol>" : "</li></ul>";
  return out.replace(/<(ul|ol)><\/li>/g, "<$1>");
}

export function jiraToHtml(wiki: string): string {
  const codes: string[] = [];
  const keep = (html: string) => `\u0000${codes.push(html) - 1}\u0000`;
  let text = wiki.replace(/\r\n?/g, "\n");

  // blocks whose content stays as it is
  text = text.replace(/\{code(?::[^}]*)?\}\n?([\s\S]*?)\{code\}/g, (_, body) => keep(`<pre><code>${esc(body.replace(/\n$/, ""))}</code></pre>`));
  text = text.replace(/\{noformat(?::[^}]*)?\}\n?([\s\S]*?)\{noformat\}/g, (_, body) => keep(`<pre>${esc(body.replace(/\n$/, ""))}</pre>`));
  // {quote} and {panel} hold normal markup
  text = text.replace(/\{quote\}\n?([\s\S]*?)\{quote\}/g, (_, body) => keep(`<blockquote>${jiraToHtml(body.trim())}</blockquote>`));
  text = text.replace(/\{panel(?::[^}]*)?\}\n?([\s\S]*?)\{panel\}/g, (_, body) => keep(`<div class="panel">${jiraToHtml(body.trim())}</div>`));

  const out: string[] = [];
  let para: string[] = [];
  let list: ListItem[] = [];
  let table: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list.length) out.push(renderList(list));
    list = [];
  };
  const flushTable = () => {
    if (table.length) out.push(`<table>${table.join("")}</table>`);
    table = [];
  };
  const flush = () => (flushPara(), flushList(), flushTable());

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const placeholder = /^\s*\u0000\d+\u0000\s*$/.test(line);
    const fmt = (s: string) => inline(esc(s), codes);
    let m: RegExpMatchArray | null;
    if (!line.trim()) flush();
    else if (placeholder) (flush(), out.push(line.trim()));
    else if ((m = line.match(/^h([1-6])\.\s+(.*)$/))) (flush(), out.push(`<h${Math.min(6, Number(m[1]) + 2)}>${fmt(m[2]!)}</h${Math.min(6, Number(m[1]) + 2)}>`));
    else if ((m = line.match(/^bq\.\s+(.*)$/))) (flush(), out.push(`<blockquote>${fmt(m[1]!)}</blockquote>`));
    else if (/^-{4,}$/.test(line.trim())) (flush(), out.push("<hr>"));
    else if ((m = line.match(/^\s*([*#-]+)\s+(.*)$/)) && !/^-[^-\s]/.test(line.trim())) {
      flushPara();
      flushTable();
      const marks = m[1]!.replace(/-/g, "*");
      list.push({ ordered: marks.at(-1) === "#", depth: marks.length, html: fmt(m[2]!) });
    } else if (/^\s*\|/.test(line)) {
      flushPara();
      flushList();
      const header = /^\s*\|\|/.test(line);
      const cells = line.trim().replace(/^\|\|?/, "").replace(/\|\|?$/, "").split(header ? "||" : "|");
      table.push(`<tr>${cells.map((c) => (header ? `<th>${fmt(c.trim())}</th>` : `<td>${fmt(c.trim())}</td>`)).join("")}</tr>`);
    } else {
      flushList();
      flushTable();
      para.push(fmt(line));
    }
  }
  flush();
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, n) => codes[Number(n)]!);
}
