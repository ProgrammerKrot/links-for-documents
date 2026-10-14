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

