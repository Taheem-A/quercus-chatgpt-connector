import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://q.utoronto.ca';

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value.replace(/\\n/g, '\n');
  }
  return out;
}

export function normalizeBaseUrl(raw) {
  const input = String(raw || DEFAULT_BASE_URL).trim();
  const url = new URL(input);
  // Quercus is hosted at the origin. Existing connector configs may include /api/v1;
  // the local app normalizes that back to the Canvas origin.
  return url.origin;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function readEnv(file) {
  try {
    return parseEnv(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

export async function loadSettings(projectRoot) {
  const configPath = path.join(projectRoot, '.quercus-local.json');
  const local = (await readJson(configPath)) || {};
  const env = await readEnv(path.join(projectRoot, '.env.local'));

  const baseUrl = normalizeBaseUrl(
    local.baseUrl || env.CANVAS_BASE_URL || process.env.CANVAS_BASE_URL || DEFAULT_BASE_URL,
  );
  const token = String(local.token || env.CANVAS_TOKEN || process.env.CANVAS_TOKEN || '').trim();

  let source = 'none';
  if (local.token) source = '.quercus-local.json';
  else if (env.CANVAS_TOKEN) source = '.env.local';
  else if (process.env.CANVAS_TOKEN) source = 'environment';

  return {
    baseUrl,
    token,
    configured: Boolean(token),
    source,
    configPath,
  };
}

export async function saveSettings(projectRoot, { baseUrl, token }) {
  const current = await loadSettings(projectRoot);
  const next = {
    baseUrl: normalizeBaseUrl(baseUrl || current.baseUrl),
    token: String(token || current.token || '').trim(),
    updatedAt: new Date().toISOString(),
  };
  if (!next.token) throw new Error('Canvas access token cannot be empty.');
  const configPath = path.join(projectRoot, '.quercus-local.json');
  await fs.writeFile(configPath, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try { await fs.chmod(configPath, 0o600); } catch {}
  return {
    baseUrl: next.baseUrl,
    configured: true,
    source: '.quercus-local.json',
  };
}

export function publicSettings(settings) {
  return {
    baseUrl: settings.baseUrl,
    configured: settings.configured,
    source: settings.source,
  };
}
