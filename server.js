// Static file server for the app plus a tiny API that keeps the link network in links.tr.
// No dependencies:  node server.js [port] [--open]   → http://localhost:5173
//   --open  also opens the app in the default browser
//
//   GET /api/links   contents of links.tr (404 if it doesn't exist yet)
//   PUT /api/links   replace links.tr with the request body (JSON)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARGS = process.argv.slice(2);
const OPEN = ARGS.includes('--open');
const ROOT = __dirname;
const LINKS_FILE = path.join(ROOT, 'links.tr');
const PORT = Number(ARGS.find((a) => /^\d+$/.test(a)) || process.env.PORT || 5173);
const MAX_BODY = 20 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Version of links.tr = hash of its contents ('none' while it doesn't exist). Several
// browser windows can share the file: a PUT names the version it was based on and is
// refused with 409 if the file has changed since, so the window can merge and retry.
const versionOf = (text) => (text == null ? 'none' : crypto.createHash('sha1').update(text).digest('hex').slice(0, 16));

async function readLinks() {
  try {
    return await fs.promises.readFile(LINKS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

let writes = Promise.resolve(); // one PUT at a time, so check-then-write can't interleave

async function handleLinks(req, res) {
  if (req.method === 'GET') {
    try {
      const text = await readLinks();
      const version = versionOf(text);
      const headers = { 'X-Version': version };
      if (req.headers['x-known-version'] === version) return send(res, 304, '', undefined, headers);
      if (text == null) return send(res, 404, 'No links.tr yet', undefined, headers);
      send(res, 200, text, 'application/json; charset=utf-8', headers);
    } catch (err) {
      send(res, 500, err.message);
    }
    return;
  }
  if (req.method === 'PUT') {
    let body;
    try {
      body = await readBody(req);
      JSON.parse(body); // refuse to write anything that isn't valid JSON
    } catch (err) {
      return send(res, 400, err.message);
    }
    writes = writes.then(async () => {
      try {
        const current = versionOf(await readLinks());
        // a PUT without a base version (e.g. a tab still running older code) is refused as well,
        // so it can't silently overwrite changes it never saw
        if (req.headers['x-base-version'] !== current) {
          return send(res, 409, 'links.tr changed since you read it — reload the page', undefined, { 'X-Version': current });
        }
        // write to a temp file first so a crash never leaves a half-written links.tr
        const tmp = `${LINKS_FILE}.tmp`;
        await fs.promises.writeFile(tmp, body, 'utf8');
        await fs.promises.rename(tmp, LINKS_FILE);
        send(res, 200, '', undefined, { 'X-Version': versionOf(body) });
      } catch (err) {
        send(res, 500, err.message);
      }
    });
    return;
  }
  send(res, 405, 'Method not allowed');
}

function serveStatic(req, res) {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

// Open the app in the default browser (used by start.bat / start.sh via --open).
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    require('child_process').spawn(cmd, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

const URL_ = `http://localhost:${PORT}`;

http
  .createServer((req, res) => {
    if (req.url.split('?')[0] === '/api/links') handleLinks(req, res);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res);
    else send(res, 405, 'Method not allowed');
  })
  .on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    // most likely LinksDocs is already running: just show it
    console.log(`Port ${PORT} is already in use — LinksDocs is probably already running at ${URL_}`);
    if (OPEN) openBrowser(URL_);
    process.exitCode = 0;
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log(`LinksDocs on ${URL_}  (links saved to ${LINKS_FILE})`);
    console.log('Close this window or press Ctrl+C to stop the server.');
    if (OPEN) openBrowser(URL_);
  });
