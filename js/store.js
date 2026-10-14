// App state in IndexedDB. Graph nodes are addressed by keys: "doc:<id>", "hl:<id>", "topic:<id>";
// a link connects any two keys. Uploaded originals are stored separately under "file:<docId>".
// The link network itself (document names, topics, highlights, links) is also mirrored to
// links.tr next to the app, through server.js, and links.tr wins when the app starts.

const Store = (() => {
  const OBJ = 'kv';
  const TABLES = { doc: 'docs', hl: 'highlights', topic: 'topics' };

  let state = { docs: [], highlights: [], topics: [], links: [] };
  const listeners = new Set();

  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const dbReady = (() => {
    const req = indexedDB.open('linksdocs', 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OBJ);
    return request(req);
  })();

  const objects = async (mode) => (await dbReady).transaction(OBJ, mode).objectStore(OBJ);

  async function load() {
    const saved = await request((await objects('readonly')).get('state'));
    if (saved) state = { ...state, ...saved };
    await loadLinksFile();
  }

  let saveTimer;
  function saveLocal() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => (await objects('readwrite')).put(state, 'state'), 150);
  }

  function save() {
    saveLocal();
    scheduleFileWrite();
  }

  // ---------- links.tr ----------
  // Entries from links.tr whose document isn't in this browser yet. They are written back
  // unchanged, and re-attach when a document with the same name and type is uploaded.
  let orphans = { docs: [], highlights: [], links: [] };
  let fileStatus = 'off'; // 'saved' | 'saving' | 'error' | 'off' (no server API)
  const statusListeners = new Set();
  const setFileStatus = (s) => { fileStatus = s; statusListeners.forEach((fn) => fn(s)); };

  // Several windows (or a text editor) may change links.tr. We remember the version we last
  // read or wrote and its contents (`base`); a write based on an outdated version is refused
  // by the server, and then our changes since `base` are merged into the newer file.
  let version = null;
  let base = {};
  let fileBroken = false;

  async function loadLinksFile() {
    let res;
    try { res = await fetch('/api/links', { cache: 'no-store' }); } catch { return setFileStatus('off'); }
    if (res.status === 404) { // create it
      version = 'none';
      setFileStatus('saved');
      setInterval(pollLinksFile, 3000);
      return scheduleFileWrite(0);
    }
    if (!res.ok) return setFileStatus('off');
    try {
      const data = await res.json();
      applyLinksFile(data);
      [version, base] = [res.headers.get('X-Version'), data];
      setFileStatus('saved');
      setInterval(pollLinksFile, 3000);
    } catch (err) {
      console.warn('links.tr is not readable, leaving it untouched', err);
      setFileStatus('error');
      fileBroken = true;
    }
  }

  // Picks up changes made in another window or by hand, when we have none of our own pending.
  async function pollLinksFile() {
    if (fileBroken || writing || fileTimer) return;
    const res = await fetch('/api/links', { cache: 'no-store', headers: { 'X-Known-Version': version ?? '' } }).catch(() => null);
    if (res?.status !== 200) return;
    const data = await res.json().catch(() => null);
    if (!data || writing || fileTimer) return; // a local change came in meanwhile; its write will merge
    applyLinksFile(data);
    [version, base] = [res.headers.get('X-Version'), data];
    notify('sync');
  }

  // Three-way merge by id: what we added, changed or deleted since `base` is applied on top of
  // `theirs`. Readable from/to fields on links don't count as changes.
  function merge(baseData, mine, theirs) {
    const core = ({ from, to, ...rest }) => JSON.stringify(rest);
    const out = { ...mine };
    for (const col of ['documents', 'topics', 'highlights', 'links']) {
      const before = new Map((baseData[col] ?? []).map((x) => [x.id, x]));
      const now = new Map(mine[col].map((x) => [x.id, x]));
      const result = new Map((theirs[col] ?? []).map((x) => [x.id, x]));
      for (const [id, x] of now) if (!before.has(id) || core(before.get(id)) !== core(x)) result.set(id, x);
      for (const id of before.keys()) if (!now.has(id)) result.delete(id);
      out[col] = [...result.values()];
    }
    return out;
  }

  function applyLinksFile(data) {
    const local = new Set(state.docs.map((d) => d.id));
    for (const d of data.documents ?? []) {
      const mine = state.docs.find((x) => x.id === d.id);
      if (mine) mine.name = d.name;
    }
    orphans.docs = (data.documents ?? []).filter((d) => !local.has(d.id));
    state.topics = data.topics ?? [];
    state.highlights = [];
    state.links = [];
    orphans.highlights = data.highlights ?? [];
    orphans.links = data.links ?? [];
    adoptOrphans();
  }

  // Move orphaned highlights/links into the state once everything they point to exists.
  function adoptOrphans() {
    const local = new Set(state.docs.map((d) => d.id));
    orphans.docs = orphans.docs.filter((d) => !local.has(d.id));
    const keep = [];
    for (const h of orphans.highlights) (local.has(h.docId) ? state.highlights : keep).push(h);
    orphans.highlights = keep;
    const exists = (key) => {
      const { kind, id } = parseKey(key);
      return !!state[TABLES[kind]]?.some((x) => x.id === id);
    };
    const pending = [];
    for (const { id, a, b } of orphans.links) (exists(a) && exists(b) ? state.links : pending).push({ id, a, b });
    orphans.links = pending;
  }

  // Human-readable endpoint, written next to each link so links.tr can be read as-is.
  function describe(key) {
    const { kind, id } = parseKey(key);
    const item = get(key) ?? (kind === 'hl' ? orphans.highlights.find((h) => h.id === id) : orphans.docs.find((d) => d.id === id));
    if (!item) return key;
    if (kind === 'topic') return `#${item.name}`;
    if (kind === 'doc') return item.name;
    const owner = doc(item.docId) ?? orphans.docs.find((d) => d.id === item.docId);
    return `${owner?.name ?? '?'} › “${Importers.fixAccents(item.text)}”`;
  }

  function linksFileData() {
    return {
      format: 'linksdocs/links',
      version: 1,
      saved: new Date().toISOString(),
      documents: [...state.docs.map(({ id, name, kind }) => ({ id, name, kind })), ...orphans.docs],
      topics: state.topics.map(({ id, name }) => ({ id, name })),
      highlights: [
        ...state.highlights.map(({ id, docId, start, end, area, text, color, thumb }) => ({ id, docId, start, end, area, text, color, thumb })),
        ...orphans.highlights,
      ],
      links: [...state.links, ...orphans.links].map(({ id, a, b }) => ({ id, a, b, from: describe(a), to: describe(b) })),
    };
  }

  let fileTimer = null;
  let writing = false;
  function scheduleFileWrite(delay = 300) {
    if (fileStatus === 'off' || fileBroken) return;
    clearTimeout(fileTimer);
    setFileStatus('saving');
    fileTimer = setTimeout(() => {
      fileTimer = null;
      if (writing) scheduleFileWrite(200); // let the write in flight finish first
      else writeLinksFile();
    }, delay);
  }

  async function writeLinksFile() {
    writing = true;
    try {
      let data = linksFileData();
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetch('/api/links', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Base-Version': version ?? 'none' },
          body: JSON.stringify(data, null, 2),
        });
        if (res.ok) {
          [version, base] = [res.headers.get('X-Version'), data];
          return setFileStatus('saved');
        }
        if (res.status !== 409) break;
        // links.tr changed elsewhere since we read it: merge our changes into the newer file
        const latest = await fetch('/api/links', { cache: 'no-store' });
        const theirs = latest.ok ? await latest.json() : {};
        data = merge(base, data, theirs);
        [version, base] = [latest.headers.get('X-Version'), theirs];
        applyLinksFile(data);
        data = linksFileData();
        notify('sync');
      }
      setFileStatus('error');
    } catch {
      setFileStatus('error');
    } finally {
      writing = false;
    }
  }

  function emit(type, payload) {
    save();
    listeners.forEach((fn) => fn({ type, ...payload }));
  }

  // State replaced from links.tr: refresh the UI and IndexedDB, but don't write the file back.
  function notify(type) {
    saveLocal();
    listeners.forEach((fn) => fn({ type }));
  }

  const uid = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function parseKey(key) {
    const i = key.indexOf(':');
    return { kind: key.slice(0, i), id: key.slice(i + 1) };
  }

  function get(key) {
    const { kind, id } = parseKey(key);
    return state[TABLES[kind]].find((item) => item.id === id);
  }

  const doc = (id) => get(`doc:${id}`);
  const highlight = (id) => get(`hl:${id}`);
  const topic = (id) => get(`topic:${id}`);

  function label(key) {
    const item = get(key);
    switch (parseKey(key).kind) {
      case 'doc': return item.name;
      case 'topic': return `#${item.name}`;
      default: {
        if (item.area) return `▭ ${item.text}`;
        const text = Importers.fixAccents(item.text);
        return `“${text.length > 60 ? text.slice(0, 57) + '…' : text}”`;
      }
    }
  }

  // The document a doc or highlight key belongs to; null for topics.
  function docOf(key) {
    const { kind, id } = parseKey(key);
    if (kind === 'doc') return id;
    if (kind === 'hl') return highlight(id).docId;
    return null;
  }

  const linksOf = (key) => state.links.filter((l) => l.a === key || l.b === key);
  const linksOfDoc = (docId) => state.links.filter((l) => docOf(l.a) === docId || docOf(l.b) === docId);
  const other = (link, key) => (link.a === key ? link.b : link.a);
  const highlightsOf = (docId) => state.highlights.filter((h) => h.docId === docId);

  function addDoc(name, content, kind) {
    // re-uploading a document that links.tr already knows brings its highlights and links back
    const known = orphans.docs.find((o) => o.name === name && o.kind === kind);
    const d = { id: known?.id ?? uid('d'), name, content: content.replace(/\r\n?/g, '\n'), kind };
    state.docs.push(d);
    if (known) adoptOrphans();
    emit('doc:add', { doc: d });
    return d;
  }

  // Offsets are positions in the rendered document's text; `text` is that slice.
  function addHighlight(docId, start, end, color, text) {
    const h = { id: uid('h'), docId, start, end, text, color };
    state.highlights.push(h);
    emit('hl:add', { highlight: h });
    return h;
  }

