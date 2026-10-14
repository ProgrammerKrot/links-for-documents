// Markdown → HTML for the common subset plus Obsidian ==marks== and [[wikilinks]].
// Everything is escaped, so raw HTML in a document shows as text.

const Markdown = (() => {
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function inline(src) {
    const codes = [];
    let s = src.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = esc(s);
    s = s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, url) => safeUrl(url) ? `<img alt="${alt}" src="${url}">` : alt)
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, text, url) => safeUrl(url) ? `<a href="${url}" target="_blank" rel="noopener">${text}</a>` : text)
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<span class="wikilink">$2</span>')
      .replace(/\[\[([^\]]+)\]\]/g, '<span class="wikilink">$1</span>')
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '<strong>$2</strong>')
      .replace(/(^|[^*\w])\*(?=\S)(.+?)(?<=\S)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/==(.+?)==/g, '<mark>$1</mark>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }

  const safeUrl = (u) => !/^\s*(javascript|data|vbscript):/i.test(u.replace(/&amp;/g, '&'));

  const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

  function render(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    // strip YAML front matter
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) lines.splice(0, end + 1);
    }
    return blocks(lines);
  }

  function blocks(lines) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i++; continue; }

      const fence = line.match(/^\s*(```|~~~)\s*(\S*)/);
      if (fence) {
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
        continue;
      }

      const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      if (/^\s*>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push(`<blockquote>${blocks(body)}</blockquote>`);
        continue;
      }

      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
          rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }

      if (listItem.test(line)) {
        const [html, next] = list(lines, i);
        out.push(html);
        i = next;
        continue;
      }

      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*>|\s*```|\s*~~~)/.test(lines[i]) && !(para.length && listItem.test(lines[i]))) {
        para.push(lines[i++].trim());
      }
      out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>\n')}</p>`);
    }
    return out.join('\n');
  }

  function list(lines, start) {
    const first = lines[start].match(listItem);
    const indent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const items = [];
    let i = start;
    while (i < lines.length) {
      const m = lines[i].match(listItem);
      if (!m || m[1].length < indent) {
        // lazy continuation line of the previous item
        if (!m && lines[i].trim() && items.length && /^\s+/.test(lines[i])) { items[items.length - 1].text += ' ' + lines[i].trim(); i++; continue; }
        break;
      }
      if (m[1].length > indent) {
        const [html, next] = list(lines, i);
        items[items.length - 1].children += html;
        i = next;
        continue;
      }
      items.push({ text: m[3], children: '' });
      i++;
    }
    const tag = ordered ? 'ol' : 'ul';
    const html = items.map((it) => {
      const task = it.text.match(/^\[([ xX])\]\s+(.*)$/);
      const body = task
        ? `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${inline(task[2])}`
        : inline(it.text);
      return `<li${task ? ' class="task"' : ''}>${body}${it.children}</li>`;
    }).join('\n');
    return [`<${tag}>\n${html}\n</${tag}>`, i];
  }

  return { render };
})();
