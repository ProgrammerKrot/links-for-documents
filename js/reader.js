// Left side: up to two documents side by side, highlighting, and connector curves
// between linked items of the two open documents.

const Reader = (() => {
  let slots = [null, null]; // docId per pane
  let activeSlot = 0;
  let pendingKey = null;
  let hoverKey = null;
  let on; // callbacks from app.js
  const freshLinks = new Set(); // links that should play the draw-in animation
  const drawing = new Set();    // PDFs with the area tool switched on (images always draw)
  const imageUrls = new Map();  // docId -> object URL of the stored image, or 'loading'
  const panesEl = document.getElementById('panes');
  const svg = document.getElementById('connectors');
  const workspace = document.getElementById('workspace');

  function init(handlers) {
    on = handlers;
    panesEl.addEventListener('mouseup', onMouseUp);
    panesEl.addEventListener('click', onClick);
    panesEl.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.hl, .area[data-area]');
      const key = el && `hl:${el.dataset.area ?? topHighlight(el)}`;
      if (key !== hoverKey) setHover(key);
    });
    panesEl.addEventListener('mouseleave', () => setHover(null));
    panesEl.addEventListener('pointerdown', startDrawing);
    panesEl.addEventListener('dragstart', (e) => e.target.closest('.img-sheet') && e.preventDefault());
    panesEl.addEventListener('scroll', () => { scheduleConnectors(); on.onScroll(); }, true);
    new ResizeObserver(scheduleConnectors).observe(workspace);
  }

  const openDocs = () => slots.filter(Boolean);

  function open(docId) {
    let slot = slots.indexOf(docId);
    if (slot >= 0) {
      activeSlot = slot;
      render();
      restartAnimation(panesEl.querySelector(`.pane[data-slot="${slot}"]`), 'flash');
      return;
    }
    slot = slots.indexOf(null);
    if (slot < 0) slot = 1 - activeSlot; // replace the pane you're not working in
    slots[slot] = docId;
    activeSlot = slot;
    render();
  }

  function close(slot) {
    slots[slot] = null;
    activeSlot = 0;
    render();
  }

  function render() {
    // keep panes left-aligned and drop documents that were deleted
    slots = [...slots.filter((id) => id && Store.doc(id)), null, null].slice(0, 2);

    const scroll = Object.fromEntries([...panesEl.querySelectorAll('.pane')]
      .map((p) => [p.dataset.doc, p.querySelector('.pane-scroll').scrollTop]));

    const docs = openDocs();
    panesEl.className = `panes count-${docs.length}`;
    panesEl.replaceChildren(...docs.flatMap((docId, i) => {
      const pane = renderPane(docId, i);
      return i ? [Object.assign(document.createElement('div'), { className: 'gutter' }), pane] : [pane];
    }));
    for (const pane of panesEl.querySelectorAll('.pane')) {
      pane.querySelector('.pane-scroll').scrollTop = scroll[pane.dataset.doc] ?? 0;
    }
    on.onRender();
    scheduleConnectors();
  }

  function renderPane(docId, slot) {
    const doc = Store.doc(docId);
    const hls = Store.highlightsOf(docId);
    const type = docType(doc.kind);

    // other documents and topics this one is linked with, counted per target
    const related = new Map();
    for (const l of Store.linksOfDoc(docId)) {
      for (const k of [l.a, l.b]) {
        const owner = Store.docOf(k);
        if (owner === docId) continue;
        const key = owner ? `doc:${owner}` : k;
        related.set(key, (related.get(key) ?? 0) + 1);
      }
    }
    const chips = [...related].map(([key, n]) => {
      const item = Store.get(key);
      const isDoc = key.startsWith('doc:');
      return `<button class="chip" data-key="${key}">${isDoc ? docIcon(item.kind, 14) : '<i class="k-topic"></i>'}` +
        `<span>${escapeHtml(isDoc ? item.name : `#${item.name}`)}</span>${n > 1 ? `<em>${n}</em>` : ''}</button>`;
    }).join('') || '<span class="prop-empty">Empty</span>';

    const pane = document.createElement('article');
    const canDraw = doc.kind === 'pdf' && doc.hasFile && PdfView.status(docId) === 'ready';
    pane.className = `pane${slot === activeSlot && slots[1] ? ' active' : ''}${canDraw && drawing.has(docId) ? ' drawing' : ''}`;
    pane.dataset.doc = docId;
    pane.dataset.slot = slot;
    pane.innerHTML = `
      <header class="pane-head">
        <div class="crumb">${docIcon(doc.kind, 16)}<span title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span></div>
        ${canDraw ? `<button class="icon-btn area-tool${drawing.has(docId) ? ' on' : ''}" title="Mark an area: drag a rectangle on a page (Alt+drag works any time)">▭</button>` : ''}
        ${(doc.kind === 'pdf' || doc.kind === 'image') && doc.hasFile ? '<button class="icon-btn open-original" title="Open the original in a new tab">↗</button>' : ''}
        <button class="icon-btn link-doc${pendingKey === `doc:${docId}` ? ' pending' : ''}" title="${pendingKey ? 'Link to this whole document' : 'Link this whole document…'}">⛓</button>
        <button class="icon-btn close-pane" title="Close">✕</button>
      </header>
      <div class="pane-scroll">
        <div class="page${doc.kind === 'pdf' || doc.kind === 'image' ? ' wide' : ''}">
          <div class="page-icon">${docIcon(doc.kind, 64)}</div>
          <h1 class="page-title">${escapeHtml(doc.name)}</h1>
          <div class="props">
            <div class="prop"><span class="prop-k"><b>◉</b>Type</span><span class="prop-v"><span class="tag" style="--c:${type.color}">${type.label}</span></span></div>
            <div class="prop"><span class="prop-k"><b>✎</b>Highlights</span><span class="prop-v">${hls.length || '<span class="prop-empty">Empty</span>'}</span></div>
            <div class="prop"><span class="prop-k"><b>⛓</b>Linked with</span><span class="prop-v chips">${chips}</span></div>
          </div>
          <div class="page-divider"></div>
        </div>
      </div>`;

    const body = buildBody(doc, hls);
    // the page title already shows the name, so hide a leading "# Name" that repeats it
    const first = body.firstElementChild;
    if (first?.tagName === 'H1' && first.textContent.trim().toLowerCase() === doc.name.trim().toLowerCase()) {
      first.classList.add('dup-title');
    }
    pane.querySelector('.page').appendChild(body);
    return pane;
  }

  // The formatted document before highlights. Highlight offsets index into its textContent,
  // so they don't depend on how the document is formatted.
  const baseCache = new Map();
  function baseDom(doc) {
    if (doc.kind === 'pdf' && doc.hasFile) {
      const status = PdfView.status(doc.id);
      if (status === 'ready') return PdfView.build(doc.id);
      if (status === 'idle' || status === 'loading') {
        PdfView.ensure(doc.id, render);
        return loadingBody('Loading PDF…');
      }
      // original missing or unreadable: show the extracted text instead
    }
    if (doc.kind === 'image') return imageDom(doc);
    let cached = baseCache.get(doc.id);
    if (cached?.content !== doc.content) {
      const el = document.createElement('div');
      if (doc.kind === 'md') {
        el.className = 'doc-body md';
        el.innerHTML = Markdown.render(doc.content);
      } else if (doc.kind === 'pdf') {
        el.className = 'doc-body pdf';
        doc.content.split('\f').forEach((page, i) => {
          const section = document.createElement('section');
          section.className = 'pdf-page';
          section.dataset.page = i + 1;
          for (const para of page.split(/\n{2,}/).filter((p) => p.trim())) {
            const p = document.createElement('p');
            p.textContent = Importers.fixAccents(para.replace(/\n/g, ' '));
            section.append(p, '\n');
          }
          el.appendChild(section);
        });
      } else {
        el.className = 'doc-body txt';
        el.textContent = doc.content;
      }
      cached = { content: doc.content, el };
      baseCache.set(doc.id, cached);
    }
    return cached.el.cloneNode(true);
  }

  const plainText = (doc) => baseDom(doc).textContent;

  function loadingBody(message) {
    const el = document.createElement('div');
    el.className = 'doc-body doc-loading';
    el.dataset.loading = message;
    return el;
  }

  // An image document: the stored original, with areas drawn on top of it.
  function imageDom(doc) {
    const url = imageUrls.get(doc.id);
    if (!doc.hasFile) return loadingBody('Image not stored in this browser — upload it again');
    if (!url) {
      imageUrls.set(doc.id, 'loading');
      Store.getFile(doc.id).then((blob) => {
        if (blob) imageUrls.set(doc.id, URL.createObjectURL(blob));
        else imageUrls.delete(doc.id);
        render();
      });
    }
    if (!url || url === 'loading') return loadingBody('Loading image…');
    const root = document.createElement('div');
    root.className = 'doc-body imageview';
    root.innerHTML = `<div class="img-sheet" data-page="1"><img src="${url}" alt="" draggable="false"></div>`;
    return root;
  }

  function nearest(hay, needle, from) {
    let best = -1;
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
      if (best < 0 || Math.abs(i - from) < Math.abs(best - from)) best = i;
    }
    return best;
  }

  // Lowercase letters only (no accents or whitespace) plus a map back to positions in `text`.
  function looseIndex(text) {
    let out = '';
    const map = [];
    for (let i = 0; i < text.length; i++) {
      for (const ch of text[i].normalize('NFD').replace(/[̀-ͯ\s´`ˆ˜¨¸ˇ˚]/g, '').toLowerCase()) {
        out += ch;
        map.push(i);
      }
    }
    return { out, map };
  }

  // Moves highlights whose offsets no longer match their text (renderer or PDF view changed)
  // to the nearest occurrence: exact, then accent-fixed, then ignoring accents and spacing.
  function reanchor(text, hls) {
    let loose;
    let moved = false;
    for (const x of hls) {
      if (text.slice(x.start, x.end) === x.text) continue;
      let start = -1, end;
      for (const needle of [x.text, Importers.fixAccents(x.text)]) {
        start = nearest(text, needle, x.start);
        if (start >= 0) { end = start + needle.length; break; }
      }
      if (start < 0) {
        loose ??= looseIndex(text);
        const needle = looseIndex(Importers.fixAccents(x.text)).out;
        const at = needle ? nearest(loose.out, needle, loose.map.findIndex((p) => p >= x.start)) : -1;
        if (at < 0) continue;
        start = loose.map[at];
        end = loose.map[at + needle.length - 1] + 1;
      }
      Object.assign(x, { start, end, text: text.slice(start, end) });
      moved = true;
    }
    if (moved) {
      Store.persist();
      setTimeout(on.onReanchor);
    }
  }

  // Splits text nodes at highlight boundaries and wraps covered pieces in .hl spans.
  function buildBody(doc, hls) {
    const root = baseDom(doc);
    if (root.dataset.loading) return root;
    const linked = new Set(Store.state.links.flatMap((l) => [l.a, l.b]));
    addAreas(root, hls.filter((x) => x.area), linked);
    hls = hls.filter((x) => !x.area);
    reanchor(root.textContent, hls);
    if (!hls.length) return root;

    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(), pos = 0; n; pos += n.data.length, n = walker.nextNode()) nodes.push([n, pos]);

    for (const [node, ns] of nodes) {
      const ne = ns + node.data.length;
      const inside = hls.filter((x) => x.start < ne && x.end > ns);
      if (!inside.length) continue;
      const cuts = [...new Set([ns, ne, ...inside.flatMap((x) => [x.start, x.end]).filter((c) => c > ns && c < ne)])]
        .sort((a, b) => a - b);
      const frag = document.createDocumentFragment();
      for (let i = 0; i < cuts.length - 1; i++) {
        const s = cuts[i], e = cuts[i + 1];
        const piece = node.data.slice(s - ns, e - ns);
        const covering = inside
          .filter((x) => x.start <= s && x.end >= e)
          .sort((a, b) => (b.end - b.start) - (a.end - a.start)); // innermost last
        if (!covering.length || !piece.trim()) {
          frag.append(piece);
          continue;
        }
        const keys = covering.map((x) => `hl:${x.id}`);
        const span = document.createElement('span');
        span.className = 'hl';
        span.classList.toggle('linked', keys.some((k) => linked.has(k)));
        span.classList.toggle('pending', keys.includes(pendingKey));
        span.dataset.hls = covering.map((x) => x.id).join(' ');
        span.style.setProperty('--c', covering.at(-1).color);
        span.textContent = piece;
        frag.appendChild(span);
      }
      node.replaceWith(frag);
    }
    return root;
  }

  // Area highlights are boxes positioned in % of their page (PDF sheet or image).
  function addAreas(root, areas, linked) {
    const sheets = root.querySelectorAll('.pdf-sheet, .img-sheet');
    for (const x of areas) {
      const sheet = sheets[x.area.page];
      if (!sheet) continue;
      const key = `hl:${x.id}`;
      const el = document.createElement('div');
      el.className = `area${linked.has(key) ? ' linked' : ''}${key === pendingKey ? ' pending' : ''}`;
      el.dataset.area = x.id;
      el.title = x.text;
      el.style.cssText = `--c:${x.color};${boxStyle(x.area)}`;
      sheet.appendChild(el);
    }
  }

  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  const boxStyle = (r) => `left:${pct(r.x)};top:${pct(r.y)};width:${pct(r.w)};height:${pct(r.h)}`;

  // Drag a rectangle on a page: on images always, on PDFs with the area tool on or Alt held.
  function startDrawing(e) {
    const sheet = e.button === 0 && e.target.closest('.pdf-sheet, .img-sheet');
    if (!sheet || e.target.closest('.area')) return;
    const docId = sheet.closest('.pane').dataset.doc;
    if (!(sheet.classList.contains('img-sheet') || drawing.has(docId) || e.altKey)) return;
    e.preventDefault();
    getSelection().removeAllRanges();

    const box = sheet.getBoundingClientRect();
    const point = (ev) => ({
      x: clamp((ev.clientX - box.left) / box.width, 0, 1),
      y: clamp((ev.clientY - box.top) / box.height, 0, 1),
    });
    const start = point(e);
    let rect = { x: start.x, y: start.y, w: 0, h: 0 };
    const ghost = document.createElement('div');
    ghost.className = 'area ghost';
    sheet.appendChild(ghost);

    const move = (ev) => {
      const p = point(ev);
      rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      ghost.style.cssText = boxStyle(rect);
    };
    const end = (ev) => {
      sheet.removeEventListener('pointermove', move);
      sheet.removeEventListener('pointerup', end);
      sheet.removeEventListener('pointercancel', end);
      ghost.remove();
      // ignore clicks and tiny drags (written so a zero-size sheet's NaN also bails out)
      if (ev.type === 'pointercancel' || !(rect.w * box.width >= 8 && rect.h * box.height >= 8)) return;
      const round = (v) => Math.round(v * 1e5) / 1e5;
      on.onArea({
        docId,
        area: { page: Number(sheet.dataset.page) - 1, x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) },
        thumb: thumbnail(sheet, rect),
        rect: {
          left: box.left + rect.x * box.width, top: box.top + rect.y * box.height,
          right: box.left + (rect.x + rect.w) * box.width, bottom: box.top + (rect.y + rect.h) * box.height,
          width: rect.w * box.width, height: rect.h * box.height,
        },
      });
    };
    try { sheet.setPointerCapture(e.pointerId); } catch { /* keep drawing without capture */ }
    sheet.addEventListener('pointermove', move);
    sheet.addEventListener('pointerup', end);
    sheet.addEventListener('pointercancel', end);
  }

  // Small JPEG of the marked region, cut from the painted page canvas or the image.
  function thumbnail(sheet, r) {
    const src = sheet.querySelector('canvas, img');
    const sw = src?.naturalWidth || src?.width, sh = src?.naturalHeight || src?.height;
    if (!sw || !sh) return null;
    const w = r.w * sw, h = r.h * sh;
    const scale = Math.min(1, 240 / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    try {
      ctx.drawImage(src, r.x * sw, r.y * sh, w, h, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    } catch {
      return null;
    }
  }

  const topHighlight = (span) => span.dataset.hls.split(' ').at(-1);

  function offsetIn(container, node, offset) {
    const r = document.createRange();
    r.setStart(container, 0);
    r.setEnd(node, offset);
    return r.toString().length;
  }

  function onMouseUp(e) {
    if (e.button !== 0) return;
    // let the browser finish updating the selection first
    setTimeout(() => {
      const sel = getSelection();
      if (sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const body = (anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement).closest('.doc-body');
      if (!body) return;
      const text = body.textContent;
      let start = offsetIn(body, range.startContainer, range.startOffset);
      let end = offsetIn(body, range.endContainer, range.endOffset);
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (end === start) return;
      on.onSelection({
        docId: body.closest('.pane').dataset.doc,
        start, end,
        text: text.slice(start, end),
        rect: range.getBoundingClientRect(),
      });
    });
  }

  function onClick(e) {
    const pane = e.target.closest('.pane');
    if (!pane) return;
    const slot = Number(pane.dataset.slot);
    const docId = pane.dataset.doc;

    if (e.target.closest('.close-pane')) return close(slot);
    if (e.target.closest('.link-doc')) return on.onDocLink(docId);
    if (e.target.closest('.open-original')) return on.onOpenOriginal(docId);
    if (e.target.closest('.area-tool')) {
      if (drawing.has(docId)) drawing.delete(docId);
      else drawing.add(docId);
      return render();
    }
    const chip = e.target.closest('.chip[data-key]');
    if (chip) return on.onOpenKey(chip.dataset.key);

    if (activeSlot !== slot) {
      activeSlot = slot;
      for (const p of panesEl.querySelectorAll('.pane')) p.classList.toggle('active', p === pane && !!slots[1]);
    }
    const area = e.target.closest('.area[data-area]');
    if (area) return on.onHighlightClick(area.dataset.area, area.getBoundingClientRect(), [area.dataset.area]);
    const span = e.target.closest('.hl');
    if (span && getSelection().isCollapsed) {
      on.onHighlightClick(topHighlight(span), span.getBoundingClientRect(), span.dataset.hls.split(' '));
    }
  }

  function restartAnimation(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so the animation plays again
    el.classList.add(cls);
  }

  function scrollToHighlight(hlId) {
    const spans = panesEl.querySelectorAll(`.hl[data-hls~="${hlId}"], .area[data-area="${hlId}"]`);
    if (!spans.length) return;
    spans[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    spans.forEach((s) => restartAnimation(s, 'flash'));
  }

  function setPending(key) {
    pendingKey = key;
    render();
  }

  function setHover(key) {
    hoverKey = key;
    for (const g of svg.querySelectorAll('.conn')) g.classList.toggle('hot', !!key && (g.dataset.a === key || g.dataset.b === key));
    on.onHover(key);
  }

  const markFresh = (linkId) => freshLinks.add(linkId);

  let raf = 0;
  function scheduleConnectors() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawConnectors);
  }

  // Vertical position of a linked item; items scrolled out of view are pinned to the pane edge.
  function anchorY(key, pane) {
    const { kind, id } = Store.parseKey(key);
    if (kind === 'doc') {
      const head = pane.querySelector('.pane-head').getBoundingClientRect();
      return { y: head.top + head.height / 2, off: false };
    }
    const r = pane.querySelector(`.hl[data-hls~="${id}"], .area[data-area="${id}"]`)?.getClientRects()[0];
    if (!r) return null; // PDF still loading, or the highlight sits in a hidden element
    const { top, bottom } = pane.querySelector('.pane-scroll').getBoundingClientRect();
    const y = r.top + r.height / 2;
    if (y < top) return { y: top + 4, off: true };
    if (y > bottom) return { y: bottom - 4, off: true };
    return { y, off: false };
  }

