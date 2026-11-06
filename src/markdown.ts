// Markdown → HTML for agent answers and comments: headings, lists (nested), quotes, tables, code
// blocks (```diff and GitLab's ```suggestion coloured), rules, and inline code, bold, italic,
// strikethrough and links. Everything else is escaped text – the result is safe as innerHTML.
//
// Self-contained on purpose: the page's script gets this very function as source text
// (mdToHtml.toString()), so it may not use anything from outside its own body.

export function mdToHtml(src: string, suggestedLabel = "Suggested change"): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const inline = (s: string) => {
    const kept: string[] = [];
    const keep = (html: string) => `\u0000${kept.push(html) - 1}\u0000`;
    let out = s.replace(/`([^`\n]+)`/g, (_, code: string) => keep(`<code>${esc(code)}</code>`));
    out = esc(out);
    out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text: string, href: string) => keep(link(href, text)));
    out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, pre: string, href: string) => pre + keep(link(href, href)));
    out = out
      .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
      .replace(/__([^_\n]+)__/g, "<b>$1</b>")
      .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g, "$1<i>$2</i>")
      .replace(/~~([^~\n]+)~~/g, "<s>$1</s>");
    return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)]!);
  };

  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // fenced code
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w+-]*)/);
    if (fence) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith(fence[1]!); i++) body.push(lines[i]!);
      const lang = fence[2]!.toLowerCase();
      const rows = body.map((l) => {
        const kind = lang === "diff" ? (l.startsWith("+") ? "d-add" : l.startsWith("-") ? "d-del" : "") : lang === "suggestion" ? "d-add" : "";
        return kind ? `<span class="${kind}">${esc(l)}\n</span>` : `${esc(l)}\n`;
      });
      out.push(lang === "suggestion" ? `<pre class="code suggestion" data-label="${esc(suggestedLabel)}">${rows.join("")}</pre>` : `<pre class="code">${rows.join("")}</pre>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      const level = Math.min(6, heading[1]!.length + 2);
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flush();
      const quoted: string[] = [];
      for (; i < lines.length && /^\s{0,3}>/.test(lines[i]!); i++) quoted.push(lines[i]!.replace(/^\s{0,3}>\s?/, ""));
      i--;
      out.push(`<blockquote>${mdToHtml(quoted.join("\n"), suggestedLabel)}</blockquote>`);
      continue;
    }
    // table: a row of cells with a |---|---| line below
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const body: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.includes("|") && lines[i]!.trim(); i++) body.push(cells(lines[i]!));
      i--;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? "")}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (LIST.test(line)) {
      flush();
      // nested by indentation; a line indented below an item continues it
      const stack: { indent: number; ordered: boolean }[] = [];
      let html = "";
      for (; i < lines.length; i++) {
        const l = lines[i]!;
        const m = l.match(LIST);
        if (!m) {
          if (l.trim() && /^\s{2,}/.test(l) && stack.length) {
            html += "<br>" + inline(l.trim());
            continue;
          }
          break;
        }
        const indent = m[1]!.replace(/\t/g, "    ").length;
        const ordered = /\d/.test(m[2]!);
        while (stack.length && indent < stack.at(-1)!.indent) html += stack.pop()!.ordered ? "</li></ol>" : "</li></ul>";
        if (!stack.length || indent > stack.at(-1)!.indent) {
          stack.push({ indent, ordered });
          html += ordered ? `<ol${m[2] !== "1." && m[2] !== "1)" && !stack[1] ? ` start="${parseInt(m[2]!, 10)}"` : ""}>` : "<ul>";
        } else html += "</li>";
        html += `<li>${inline(m[3]!)}`;
      }
      i--;
      while (stack.length) html += stack.pop()!.ordered ? "</li></ol>" : "</li></ul>";
      out.push(html);
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out.join("");
}
