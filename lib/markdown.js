/**
 * A deliberately small Markdown subset for article bodies.
 *
 * Article text is written by the team, but it is still stored data, so it is
 * treated as untrusted: everything is escaped first and only a whitelist of
 * inline markup is re-enabled afterwards. Raw HTML in an article body will be
 * shown as text, never executed.
 *
 * Supported: ## / ### headings, **bold**, [text](link), - bullet lists,
 * blank-line-separated paragraphs.
 */

const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Escapes, then re-enables bold and safe links. */
function inline(text) {
  let s = esc(text);

  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  s = s.replace(/\[(.+?)\]\((.+?)\)/g, (whole, label, href) => {
    // Only internal paths, in-page anchors, and http(s). Anything else — most
    // importantly javascript: — degrades to plain text.
    if (!/^(https?:\/\/|\/|#)/.test(href)) return label;
    const external = href.startsWith('http');
    const rel = external ? ' target="_blank" rel="noopener nofollow"' : '';
    return `<a href="${href}"${rel}>${label}</a>`;
  });

  return s;
}

export function renderMarkdown(md) {
  const out = [];
  let para = [];
  let inList = false;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const line of String(md ?? '').split(/\r\n|\r|\n/)) {
    const t = line.trim();

    if (t === '') {
      flushPara();
      closeList();
      continue;
    }

    const heading = t.match(/^(#{1,3})\s+(.*)$/);
    const bullet = t.match(/^[-*]\s+(.*)$/);

    if (heading) {
      flushPara();
      closeList();
      // "##" becomes h3 so it never competes with the page's own h1.
      const level = heading[1].length + 1;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet) {
      flushPara();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else {
      closeList();
      para.push(t);
    }
  }

  flushPara();
  closeList();
  return out.join('\n');
}
