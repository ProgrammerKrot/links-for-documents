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

