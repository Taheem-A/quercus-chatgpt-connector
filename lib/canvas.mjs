const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function queryUrl(baseUrl, apiPath, query = {}) {
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  if (!path.startsWith('/api/')) throw new Error(`Canvas API path must start with /api/: ${apiPath}`);
  const url = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);
  for (const [key, raw] of Object.entries(query || {})) {
    if (raw === null || raw === undefined || raw === '') continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) url.searchParams.append(key, String(value));
  }
  return url;
}

function parseLinkHeader(header) {
  const links = {};
  if (!header) return links;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="([^"]+)"/i);
    if (m) links[m[2]] = m[1];
  }
  return links;
}

async function parseBody(response) {
  if (response.status === 204) return null;
  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json')) return response.json();
  const text = await response.text();
  try { return JSON.parse(text); } catch { return text; }
}

export class CanvasError extends Error {
  constructor(message, { status = 0, url = '', data = null } = {}) {
    super(message);
    this.name = 'CanvasError';
    this.status = status;
    this.url = url;
    this.data = data;
  }
}

export class CanvasClient {
  constructor({ baseUrl, token, userAgent = 'quercus-local/2.0' }) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.origin = new URL(this.baseUrl).origin;
    this.token = token;
    this.userAgent = userAgent;
    if (!token) throw new Error('Canvas token is not configured.');
  }

  async request(apiPathOrUrl, { method = 'GET', query = {}, timeoutMs = 30000, retries = 4 } = {}) {
    let url;
    if (/^https?:\/\//i.test(apiPathOrUrl)) {
      url = new URL(apiPathOrUrl);
      if (url.origin !== this.origin) throw new Error(`Refusing Canvas request outside ${this.origin}`);
    } else {
      url = queryUrl(this.baseUrl, apiPathOrUrl, query);
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
            'User-Agent': this.userAgent,
          },
          redirect: 'follow',
          signal: controller.signal,
        });
        clearTimeout(timer);

        const data = await parseBody(response);
        const retryable = response.status === 429 || [500, 502, 503, 504].includes(response.status);
        if (!response.ok) {
          if (retryable && attempt < retries) {
            const retryAfter = Number(response.headers.get('retry-after') || 0);
            await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 500 * 2 ** attempt));
            continue;
          }
          const detail = typeof data === 'string' ? data : JSON.stringify(data);
          throw new CanvasError(`Canvas ${response.status} ${response.statusText}: ${detail.slice(0, 1200)}`, {
            status: response.status,
            url: url.toString(),
            data,
          });
        }

        const remaining = Number(response.headers.get('x-rate-limit-remaining'));
        if (Number.isFinite(remaining) && remaining < 15) await sleep(250);

        return {
          data,
          status: response.status,
          url: url.toString(),
          headers: response.headers,
          pagination: parseLinkHeader(response.headers.get('link')),
          requestId: response.headers.get('x-request-context-id') || response.headers.get('x-request-id'),
        };
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof CanvasError) throw error;
        lastError = error;
        if (attempt >= retries) break;
        await sleep(Math.min(8000, 500 * 2 ** attempt));
      }
    }
    throw new CanvasError(`Canvas request failed: ${lastError?.message || String(lastError)}`, { url: url.toString() });
  }

  async getOne(apiPath, query = {}) {
    return this.request(apiPath, { query });
  }

  async getAll(apiPath, query = {}, { maxPages = 500 } = {}) {
    const first = queryUrl(this.baseUrl, apiPath, { per_page: 100, ...query });
    let next = first.toString();
    const items = [];
    let pages = 0;
    const seen = new Set();
    let requestId = null;

    while (next && pages < maxPages) {
      if (seen.has(next)) throw new Error(`Pagination loop detected at ${next}`);
      seen.add(next);
      const res = await this.request(next);
      requestId ||= res.requestId;
      if (Array.isArray(res.data)) items.push(...res.data);
      else if (res.data !== null && res.data !== undefined) items.push(res.data);
      pages += 1;
      next = res.pagination.next || '';
    }

    return {
      items,
      pages,
      truncated: Boolean(next),
      nextUrl: next || null,
      requestId,
    };
  }

  async downloadFile(fileId) {
    const meta = await this.getOne(`/api/v1/files/${encodeURIComponent(fileId)}`);
    const file = meta.data || {};
    if (!file.url) throw new Error('Canvas did not return a download URL for this file.');
    const downloadUrl = new URL(file.url);
    if (downloadUrl.origin !== this.origin) {
      // Canvas sometimes serves files from a first-party file host. Follow it, but never forward the token cross-origin.
      const response = await fetch(downloadUrl, { redirect: 'follow' });
      if (!response.ok) throw new Error(`File download failed: HTTP ${response.status}`);
      return { file, response };
    }
    const response = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${this.token}`, 'User-Agent': this.userAgent },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`File download failed: HTTP ${response.status}`);
    return { file, response };
  }
}

export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) break;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
