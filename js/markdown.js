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

