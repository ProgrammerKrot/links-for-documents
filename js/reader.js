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

