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

