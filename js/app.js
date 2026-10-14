const COLORS = ['#f2c94c', '#6fcf97', '#56ccf2', '#f178b6', '#bb87fc', '#eb5757'];
const TOPIC_COLOR = '#4dab9a';

const $ = (s) => document.querySelector(s);
const popupEl = $('#popup');
let graph;
let pending = null; // key a link is being drawn from

// PDF text layers can carry detached accents; show highlights with them merged.
const hlText = (h) => Importers.fixAccents(h.text);
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const showHighlights = () => $('#showHighlights').checked;

// With highlights hidden from the graph, their links attach to the owning document.
const project = (key) => (showHighlights() || !key.startsWith('hl:') ? key : `doc:${Store.docOf(key)}`);
const openDocKeys = () => Reader.openDocs().map((id) => `doc:${id}`);

function buildGraph() {
  const { docs, topics, highlights, links } = Store.state;
  const nodes = [
    ...docs.map((d) => ({ key: `doc:${d.id}`, kind: 'doc', label: d.name, color: docType(d.kind).color, badge: docType(d.kind).label })),
    ...topics.map((t) => ({ key: `topic:${t.id}`, kind: 'topic', label: `#${t.name}`, color: TOPIC_COLOR })),
  ];
  const edges = [];
  if (showHighlights()) {
    for (const h of highlights) {
      nodes.push({ key: `hl:${h.id}`, kind: 'hl', label: hlText(h), color: h.color, parent: `doc:${h.docId}`, shape: h.area ? 'square' : undefined });
      edges.push({ a: `doc:${h.docId}`, b: `hl:${h.id}`, kind: 'contains' });
    }
  }
  const seen = new Set();
  for (const l of links) {
    const a = project(l.a), b = project(l.b);
    const pair = pairKey(a, b);
    if (a === b || seen.has(pair)) continue;
    seen.add(pair);
    edges.push({ a, b, kind: 'link' });
  }
  graph.setData(nodes, edges);
  graph.setActive(openDocKeys());
  graph.setPending(pending && project(pending));
}

function openKey(key) {
  const { kind, id } = Store.parseKey(key);
  if (kind === 'doc') Reader.open(id);
  if (kind === 'hl') {
    Reader.open(Store.highlight(id).docId);
    requestAnimationFrame(() => Reader.scrollToHighlight(id));
  }
  graph.focusNode(project(key));
}

function startLink(key) {
  pending = key;
  hidePopup();
  const banner = $('#linkBanner');
  banner.hidden = false;
  banner.innerHTML = `
    <span class="dot"></span>
    Linking from <b>${escapeHtml(Store.label(key))}</b> — select text, draw an area, click a highlight, a document's ⛓, or any graph node.
    <button class="btn ghost small">Cancel (Esc)</button>`;
  banner.querySelector('button').onclick = cancelLink;
  Reader.setPending(key);
  graph.setPending(project(key));
}

function cancelLink() {
  pending = null;
  $('#linkBanner').hidden = true;
  Reader.setPending(null);
  graph.setPending(null);
}

function completeLink(target) {
  const source = pending;
  cancelLink();
  if (source === target) return;
  toast(Store.addLink(source, target)
    ? `Linked ${Store.label(source)} ↔ ${Store.label(target)}`
    : 'Those are already linked');
}

const linkAction = (key) => (pending ? completeLink(key) : startLink(key));

// `actions` maps a button's data-act to a handler that receives the button's dataset.
function showPopup(html, rect, actions) {
  popupEl.innerHTML = html;
  popupEl.hidden = false;
  popupEl.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) actions[btn.dataset.act](btn.dataset);
  };
  const { offsetWidth: w, offsetHeight: h } = popupEl;
  let y = rect.bottom + 8;
  if (y + h > innerHeight - 8) y = rect.top - h - 8;
  popupEl.style.left = `${clamp(rect.left + rect.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
  popupEl.style.top = `${Math.max(8, y)}px`;
}

const hidePopup = () => { popupEl.hidden = true; };
const pointRect = (x, y) => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 });

const swatches = (active) => COLORS.map((c) =>
  `<button class="swatch${c === active ? ' on' : ''}" data-act="color" data-color="${c}" style="--c:${c}" title="Highlight"></button>`).join('');

function onSelection({ docId, start, end, text, rect }) {
  const highlight = (color) => {
    getSelection().removeAllRanges();
    hidePopup();
    return Store.addHighlight(docId, start, end, color, text);
  };
  showPopup(`
    <div class="row">${swatches()}</div>
    <button class="btn primary small wide" data-act="link">⛓ Highlight &amp; ${pending ? 'link here' : 'start link'}</button>`, rect, {
    color: ({ color }) => highlight(color),
    link: () => linkAction(`hl:${highlight(COLORS[0]).id}`),
  });
}

let lastAreaColor = COLORS[2];

// A rectangle was drawn on a PDF page or an image.
function onArea({ docId, area, thumb, rect }) {
  const doc = Store.doc(docId);
  const caption = doc.kind === 'image' ? `Area of ${doc.name}` : `Page ${area.page + 1} area`;
  const key = `hl:${Store.addArea(docId, area, lastAreaColor, caption, thumb).id}`;
  if (pending) return completeLink(key);
  requestAnimationFrame(() => onHighlightClick(Store.parseKey(key).id, rect, [Store.parseKey(key).id]));
}

// Preview of a highlight: the cropped image for areas, the quoted text otherwise.
function highlightPreview(h, max = 160) {
  if (!h.area) return `<div class="quote" style="--c:${h.color}">${escapeHtml(truncate(hlText(h), max))}</div>`;
  return `<div class="area-preview" style="--c:${h.color}">
    ${h.thumb ? `<img src="${h.thumb}" alt="">` : '<div class="no-thumb">▭</div>'}
    <span>${escapeHtml(h.text)}</span></div>`;
}

function connectionsHtml(key) {
  const links = Store.linksOf(key);
  if (!links.length) return '<div class="muted small">No connections yet</div>';
  return `<ul class="conn-list">${links.map((l) => {
    const o = Store.other(l, key);
    const { kind } = Store.parseKey(o);
    const where = kind === 'hl' ? ` <span class="muted">in ${escapeHtml(Store.doc(Store.docOf(o)).name)}</span>` : '';
    return `<li><button class="link-to" data-act="open" data-key="${o}"><i class="k-${kind}"></i>${escapeHtml(Store.label(o))}${where}</button>
      <button class="icon-btn unlink" data-act="unlink" data-link="${l.id}" title="Remove link">✕</button></li>`;
  }).join('')}</ul>`;
}

const connectionActions = {
  open: ({ key }) => { hidePopup(); openKey(key); },
  unlink: ({ link }) => { hidePopup(); Store.removeLink(link); },
};

function onHighlightClick(hlId, rect, overlapping) {
  const key = `hl:${hlId}`;
  if (pending) return completeLink(key);
  const hl = Store.highlight(hlId);
  showPopup(`
    ${highlightPreview(hl)}
    <div class="row">${swatches(hl.color)}</div>
    <div class="section-label">Connections</div>
    ${connectionsHtml(key)}
    <div class="row">
      <button class="btn primary small" data-act="link">⛓ Link…</button>
      ${hl.area ? '<button class="btn ghost small" data-act="rename">Rename</button>' : ''}
      <button class="btn ghost small" data-act="graph">Show in graph</button>
      <button class="btn danger small" data-act="remove">Delete</button>
    </div>
    ${overlapping.length > 1 ? `<div class="muted small">${overlapping.length} highlights overlap here — showing the innermost.</div>` : ''}`, rect, {
    ...connectionActions,
    color: ({ color }) => {
      hidePopup();
      if (hl.area) lastAreaColor = color;
      Store.recolor(hlId, color);
    },
    link: () => startLink(key),
    rename: async () => {
      hidePopup();
      const name = await ask('Area caption', hl.text);
      if (name) Store.rename(key, name);
    },
    graph: () => { hidePopup(); graph.focusNode(project(key)); },
    remove: () => { hidePopup(); Store.remove(key); },
  });
}

function showTopicPopup(key, rect) {
  const t = Store.get(key);
  showPopup(`
    <div class="popup-title"><i class="k-topic"></i>#${escapeHtml(t.name)}</div>
    <div class="section-label">Connections</div>
    ${connectionsHtml(key)}
    <div class="row">
      <button class="btn primary small" data-act="link">⛓ Link…</button>
      <button class="btn ghost small" data-act="rename">Rename</button>
      <button class="btn danger small" data-act="remove">Delete</button>
    </div>`, rect, {
    ...connectionActions,
    link: () => startLink(key),
    rename: async () => {
      hidePopup();
      const name = await ask('Rename topic', t.name);
      if (name) Store.rename(key, name);
    },
    remove: () => { hidePopup(); Store.remove(key); },
  });
}

// Resolves to the entered text (or true for a confirmation), or null when cancelled.
function ask(title, value = '', { confirm = false } = {}) {
  const modal = $('#modal');
  modal.innerHTML = `
    <form class="modal-card">
      <div class="popup-title">${escapeHtml(title)}</div>
      ${confirm ? '' : `<input class="input" value="${escapeHtml(value)}">`}
      <div class="row end">
        <button type="button" class="btn ghost small">Cancel</button>
        <button class="btn ${confirm ? 'danger' : 'primary'} small">${confirm ? 'Delete' : 'OK'}</button>
      </div>
    </form>`;
  modal.hidden = false;
  const input = modal.querySelector('input');
  input?.focus();
  input?.select();
  return new Promise((resolve) => {
    const done = (v) => { modal.hidden = true; resolve(v); };
    modal.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(confirm || input.value.trim()); };
    modal.querySelector('button[type=button]').onclick = () => done(null);
    modal.onmousedown = (e) => e.target === modal && done(null);
  });
}

function toast(msg) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

function renderLibrary() {
  const { docs, topics, highlights, links } = Store.state;
  const open = new Set(Reader.openDocs());
  const row = (key, icon, name, count, cls = '') => `
    <li class="${cls}" data-key="${key}">${icon}<span class="name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      <span class="count">${count || ''}</span>
      <button class="icon-btn rename" title="Rename">✎</button>
      <button class="icon-btn delete" title="Delete">×</button></li>`;

  $('#docList').innerHTML = docs.map((d) =>
    row(`doc:${d.id}`, docIcon(d.kind), d.name, Store.highlightsOf(d.id).length, open.has(d.id) ? 'open' : '')).join('')
    || '<li class="muted small">No documents yet</li>';
  $('#topicList').innerHTML = topics.map((t) =>
    row(`topic:${t.id}`, '<i class="k-topic"></i>', `#${t.name}`, Store.linksOf(`topic:${t.id}`).length)).join('')
    || '<li class="muted small">No topics yet</li>';
  $('#stats').textContent = `Workspace  /  ${docs.length} docs · ${highlights.length} highlights · ${links.length} links`;
  $('#emptyState').hidden = open.size > 0;
  $('#sampleBtn').hidden = docs.length > 0;
}

async function onLibraryClick(e) {
  const li = e.target.closest('li[data-key]');
  if (!li) return;
  const key = li.dataset.key;
  const isDoc = key.startsWith('doc:');

  if (e.target.closest('.delete')) {
    if (!await ask(`Delete ${Store.label(key)}? Its highlights and links will be removed too.`, '', { confirm: true })) return;
    if (pending) cancelLink();
    Store.remove(key);
  } else if (e.target.closest('.rename')) {
    const name = await ask(isDoc ? 'Rename document' : 'Rename topic', Store.get(key).name);
    if (name) Store.rename(key, name);
  } else if (pending) {
    completeLink(key);
  } else if (isDoc) {
    openKey(key);
  } else {
    const r = li.getBoundingClientRect();
    showTopicPopup(key, pointRect(r.right, r.top));
  }
}

async function addFiles(files) {
  for (const file of files) {
    try {
      const { name, kind, content, original } = await Importers.read(file);
      if (!content && kind !== 'image') {
        toast(`${file.name}: no text found${kind === 'pdf' ? ' (scanned PDF?)' : ''}`);
        continue;
      }
      const d = Store.addDoc(name, content, kind);
      if (original) Store.putFile(d.id, original);
      Reader.open(d.id);
      toast(`Added ${name}`);
    } catch (err) {
      console.error(err);
      toast(`Could not read ${file.name}: ${err.message}`);
    }
  }
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function initSplitter() {
  const split = $('#splitter');
  const panel = $('#graphPanel');
  panel.style.width = localStorage.getItem('graphWidth') ?? '';
  split.addEventListener('pointerdown', (e) => {
    split.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const move = (ev) => { panel.style.width = `${clamp(innerWidth - ev.clientX, 260, innerWidth * 0.7)}px`; };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', () => {
      document.body.classList.remove('resizing');
      split.removeEventListener('pointermove', move);
      localStorage.setItem('graphWidth', panel.style.width);
    }, { once: true });
  });
}

function showGraphTip(key, e) {
  const tip = $('#graphTip');
  if (!key) {
    tip.hidden = true;
    return;
  }
  const { kind } = Store.parseKey(key);
  const item = Store.get(key);
  const n = Store.linksOf(key).length;
  const body = kind === 'hl'
    ? `${highlightPreview(item, 140)}<div class="muted small">in ${escapeHtml(Store.doc(item.docId).name)}</div>`
    : `<b>${escapeHtml(Store.label(key))}</b>`;
  const hint = pending ? 'Click to link' : kind === 'topic' ? 'Click for details' : 'Click to open';
  const kindLabel = item.area ? 'Area' : { doc: 'Document', hl: 'Highlight', topic: 'Topic' }[kind];
  tip.innerHTML = `<div class="muted small">${kindLabel} · ${n} link${n === 1 ? '' : 's'}</div>${body}<div class="muted small">${hint}</div>`;
  tip.hidden = false;
  const r = $('#graphPanel').getBoundingClientRect();
  tip.style.left = `${Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8)}px`;
  tip.style.top = `${e.clientY - r.top + 14}px`;
}

function initDropZone() {
  const overlay = $('#dropOverlay');
  let depth = 0;
  addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    depth++;
    overlay.hidden = false;
  });
  addEventListener('dragleave', () => {
    if (--depth > 0) return;
    depth = 0;
    overlay.hidden = true;
  });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    addFiles([...e.dataTransfer.files]);
  });
}

async function main() {
  await Store.load();

  graph = new ForceGraph($('#graph'), {
    onNodeClick(key, e) {
      showGraphTip(null);
      if (pending) completeLink(key);
      else if (key.startsWith('topic:')) showTopicPopup(key, pointRect(e.clientX, e.clientY));
      else openKey(key);
    },
    onHover: showGraphTip,
  });

  Reader.init({
    onSelection,
    onHighlightClick,
    onArea,
    onDocLink: (docId) => linkAction(`doc:${docId}`),
    onOpenKey: openKey,
    onOpenOriginal: async (docId) => window.open(URL.createObjectURL(await Store.getFile(docId)), '_blank'),
    onHover: (key) => graph.setExternalHover(key && project(key)),
    onRender: () => { renderLibrary(); graph.setActive(openDocKeys()); },
    onScroll: hidePopup,
    onReanchor: buildGraph,
  });

  Store.subscribe((evt) => {
    // a link in progress can't survive a reset, or a sync that removed its source
    if (evt.type === 'reset' || (pending && !Store.get(pending))) cancelLink();
    if (evt.type === 'link:add') Reader.markFresh(evt.link.id);
    buildGraph();
    Reader.render();
    if (evt.type === 'link:add') graph.animateLink(project(evt.link.a), project(evt.link.b));
  });

