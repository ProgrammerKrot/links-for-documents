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

