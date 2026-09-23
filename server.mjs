import http from 'node:http';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { CanvasClient } from './lib/canvas.mjs';
import { loadSettings, publicSettings, saveSettings } from './lib/config.mjs';
import { syncQuercus } from './lib/sync.mjs';
import { exportFiles, filenameStamp, makeIcs, makeMarkdown, makeZip } from './lib/export.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const HISTORY = path.join(DATA, 'history');
const EXPORTS = path.join(ROOT, 'exports');
const SNAPSHOT = path.join(DATA, 'snapshot.json');
const HOST = '127.0.0.1';
const START_PORT = Number(process.env.QUERCUS_PORT || 3210);

await Promise.all([fs.mkdir(DATA, { recursive: true }), fs.mkdir(HISTORY, { recursive: true }), fs.mkdir(EXPORTS, { recursive: true })]);

let snapshotCache = null;
let syncStatus = {
  running: false,
  stage: 'idle',
  message: 'Ready',
  percent: 0,
  completedSteps: 0,
  expectedSteps: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  currentCourse: null,
};

async function readSnapshot() {
  if (snapshotCache) return snapshotCache;
  try {
    snapshotCache = JSON.parse(await fs.readFile(SNAPSHOT, 'utf8'));
    return snapshotCache;
  } catch {
    return null;
  }
}

async function writeSnapshot(snapshot) {
  const temp = `${SNAPSHOT}.tmp`;
  await fs.writeFile(temp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  await fs.rename(temp, SNAPSHOT);
  const stamp = filenameStamp(snapshot);
  const hist = path.join(HISTORY, `snapshot-${stamp}.json`);
  await fs.writeFile(hist, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  snapshotCache = snapshot;

  // Keep the 10 most recent historical snapshots.
  try {
    const names = (await fs.readdir(HISTORY)).filter((n) => n.endsWith('.json')).sort().reverse();
    await Promise.all(names.slice(10).map((n) => fs.unlink(path.join(HISTORY, n)).catch(() => {})));
  } catch {}
}

function json(res, status, data, headers = {}) {
  const body = Buffer.from(JSON.stringify(data, null, 2));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function text(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, { 'content-type': type, 'content-length': buf.length, 'cache-control': 'no-store', ...headers });
  res.end(buf);
}

async function readBody(req, max = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}

function safeName(name) {
  return String(name || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180);
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  })[ext] || 'application/octet-stream';
}

async function serveStatic(req, res, url) {
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const decoded = decodeURIComponent(requestPath);
  const resolved = path.resolve(PUBLIC, `.${decoded}`);
  if (!resolved.startsWith(path.resolve(PUBLIC))) return json(res, 403, { error: 'Forbidden' });
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error('not file');
    const body = await fs.readFile(resolved);
    return text(res, 200, body, contentTypeFor(resolved), { 'cache-control': 'no-cache' });
  } catch {
    // SPA fallback.
    try {
      const body = await fs.readFile(path.join(PUBLIC, 'index.html'));
      return text(res, 200, body, 'text/html; charset=utf-8', { 'cache-control': 'no-cache' });
    } catch {
      return json(res, 404, { error: 'Not found' });
    }
  }
}

async function getClient() {
  const settings = await loadSettings(ROOT);
  if (!settings.configured) throw new Error('Canvas token is not configured. Open Settings in the app and add your Quercus access token.');
  return new CanvasClient(settings);
}

async function startSync() {
  if (syncStatus.running) return false;
  syncStatus = {
    running: true,
    stage: 'starting',
    message: 'Starting comprehensive Quercus sync…',
    percent: 0,
    completedSteps: 0,
    expectedSteps: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    currentCourse: null,
  };

  setImmediate(async () => {
    try {
      const client = await getClient();
      const snapshot = await syncQuercus(client, {
        onProgress(update) {
          syncStatus = { ...syncStatus, ...update, running: true, error: null };
        },
      });
      await writeSnapshot(snapshot);
      syncStatus = {
        ...syncStatus,
        running: false,
        stage: 'done',
        percent: 100,
        finishedAt: new Date().toISOString(),
        message: `Sync complete: ${snapshot.courses.length} courses, ${snapshot.derived?.counts?.assignments || 0} assignments`,
      };
    } catch (error) {
      syncStatus = {
        ...syncStatus,
        running: false,
        stage: 'error',
        finishedAt: new Date().toISOString(),
        error: error?.message || String(error),
        message: 'Sync failed',
      };
    }
  });
  return true;
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health' && req.method === 'GET') {
    const settings = await loadSettings(ROOT);
    const snapshot = await readSnapshot();
    return json(res, 200, {
      ok: true,
      app: 'Quercus Local',
      configured: settings.configured,
      hasSnapshot: Boolean(snapshot),
      lastSync: snapshot?.meta?.completedAt || null,
      sync: syncStatus,
    });
  }

  if (url.pathname === '/api/settings' && req.method === 'GET') {
    return json(res, 200, publicSettings(await loadSettings(ROOT)));
  }

  if (url.pathname === '/api/settings' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const saved = await saveSettings(ROOT, body);
      // Verify without exposing account data beyond display name.
      const client = await getClient();
      const profile = await client.getOne('/api/v1/users/self/profile');
      return json(res, 200, { ...saved, verified: true, user: { id: profile.data?.id, name: profile.data?.name || profile.data?.short_name || null } });
    } catch (error) {
      return json(res, 400, { error: error?.message || String(error) });
    }
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    const settings = await loadSettings(ROOT);
    const snapshot = await readSnapshot();
    return json(res, 200, {
      settings: publicSettings(settings),
      sync: syncStatus,
      snapshot: snapshot ? {
        lastSync: snapshot.meta?.completedAt || snapshot.meta?.startedAt,
        durationMs: snapshot.meta?.durationMs,
        courses: snapshot.courses?.length || 0,
        counts: snapshot.derived?.counts || {},
        failedEndpoints: snapshot.meta?.failedEndpoints || 0,
      } : null,
    });
  }

  if (url.pathname === '/api/sync' && req.method === 'POST') {
    const started = await startSync();
    return json(res, started ? 202 : 409, started ? { started: true } : { started: false, error: 'A sync is already running.' });
  }

  if (url.pathname === '/api/sync/status' && req.method === 'GET') {
    return json(res, 200, syncStatus);
  }

  if (url.pathname === '/api/snapshot' && req.method === 'GET') {
    const snapshot = await readSnapshot();
    if (!snapshot) return json(res, 404, { error: 'No snapshot yet. Click Sync Quercus first.' });
    return json(res, 200, snapshot);
  }

  if (url.pathname === '/api/raw' && req.method === 'GET') {
    try {
      const apiPath = url.searchParams.get('path');
      if (!apiPath || !apiPath.startsWith('/api/')) return json(res, 400, { error: 'Provide a Canvas API path beginning with /api/.' });
      const all = url.searchParams.get('all') === '1';
      const client = await getClient();
      const result = all ? await client.getAll(apiPath) : await client.getOne(apiPath);
      return json(res, 200, result);
    } catch (error) {
      return json(res, error?.status || 500, { error: error?.message || String(error) });
    }
  }

  if (url.pathname.startsWith('/api/files/') && url.pathname.endsWith('/download') && req.method === 'GET') {
    try {
      const id = url.pathname.split('/')[3];
      const client = await getClient();
      const { file, response } = await client.downloadFile(id);
      const bytes = Buffer.from(await response.arrayBuffer());
      const name = safeName(file.display_name || file.filename || `canvas-file-${id}`);
      res.writeHead(200, {
        'content-type': response.headers.get('content-type') || file['content-type'] || 'application/octet-stream',
        'content-length': bytes.length,
        'content-disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
        'cache-control': 'no-store',
      });
      return res.end(bytes);
    } catch (error) {
      return json(res, error?.status || 500, { error: error?.message || String(error) });
    }
  }

  if (url.pathname.startsWith('/api/export/') && req.method === 'GET') {
    const snapshot = await readSnapshot();
    if (!snapshot) return json(res, 404, { error: 'No snapshot yet.' });
    const kind = url.pathname.split('/').pop();
    const stamp = filenameStamp(snapshot);
    if (kind === 'json') return text(res, 200, JSON.stringify(snapshot, null, 2) + '\n', 'application/json; charset=utf-8', { 'content-disposition': `attachment; filename="quercus-${stamp}.json"` });
    if (kind === 'markdown') return text(res, 200, makeMarkdown(snapshot) + '\n', 'text/markdown; charset=utf-8', { 'content-disposition': `attachment; filename="quercus-${stamp}.md"` });
    if (kind === 'chatgpt') return text(res, 200, makeMarkdown(snapshot, { chatgpt: true }) + '\n', 'text/markdown; charset=utf-8', { 'content-disposition': `attachment; filename="quercus-chatgpt-${stamp}.md"` });
    if (kind === 'ics') return text(res, 200, makeIcs(snapshot), 'text/calendar; charset=utf-8', { 'content-disposition': `attachment; filename="quercus-${stamp}.ics"` });
    if (kind === 'zip') {
      const zip = makeZip(exportFiles(snapshot));
      return text(res, 200, zip, 'application/zip', { 'content-disposition': `attachment; filename="quercus-export-${stamp}.zip"` });
    }
    return json(res, 404, { error: 'Unknown export type.' });
  }

  if (url.pathname === '/api/export/save' && req.method === 'POST') {
    const snapshot = await readSnapshot();
    if (!snapshot) return json(res, 404, { error: 'No snapshot yet.' });
    const stamp = filenameStamp(snapshot);
    const dir = path.join(EXPORTS, stamp);
    await fs.mkdir(dir, { recursive: true });
    const files = exportFiles(snapshot);
    for (const file of files) {
      const dest = path.join(dir, file.name);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, file.data);
    }
    const zipPath = path.join(EXPORTS, `quercus-export-${stamp}.zip`);
    await fs.writeFile(zipPath, makeZip(files));
    return json(res, 200, { saved: true, folder: dir, zip: zipPath });
  }

  return json(res, 404, { error: 'API route not found.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${START_PORT}`}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (error) {
    return json(res, 500, { error: error?.message || String(error) });
  }
});

async function findPort(port) {
  for (let p = port; p < port + 20; p++) {
    const ok = await new Promise((resolve) => {
      const probe = http.createServer();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => probe.close(() => resolve(true)));
      probe.listen(p, HOST);
    });
    if (ok) return p;
  }
  throw new Error('Could not find a free local port.');
}

const port = await findPort(START_PORT);
server.listen(port, HOST, async () => {
  const url = `http://${HOST}:${port}`;
  const settings = await loadSettings(ROOT);
  const snapshot = await readSnapshot();
  console.log('');
  console.log('Quercus Local is running.');
  console.log(`Open: ${url}`);
  console.log(`Canvas token: ${settings.configured ? `configured (${settings.source})` : 'NOT configured'}`);
  console.log(`Saved snapshot: ${snapshot?.meta?.completedAt || 'none yet'}`);
  console.log('Press Ctrl+C to stop.');
  console.log('');

  if (!process.argv.includes('--no-open')) {
    if (process.platform === 'win32') exec(`start "" "${url}"`);
    else if (process.platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}" >/dev/null 2>&1`);
  }
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
