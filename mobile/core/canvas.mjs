// Browser adapter for the same exhaustive, read-only syncQuercus core used on desktop.
// All Canvas requests are sent to a same-origin stateless relay; token never goes
// into URLs, exports, logs or server-side persistence.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const CANVAS_ORIGIN = 'https://q.utoronto.ca';

function canvasUrl(apiPathOrUrl, query = {}) {
  const url = new URL(apiPathOrUrl, CANVAS_ORIGIN);
  if (url.origin !== CANVAS_ORIGIN || !url.pathname.startsWith('/api/v1/')) {
    throw new Error('Refusing API path outside Quercus.');
  }
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
  }
  return url;
}

export class BrowserCanvasClient {
  constructor(token) {
    if (!token || typeof token !== 'string') throw new Error('A Quercus access token is required.');
    this.token = token;
    this.baseUrl = CANVAS_ORIGIN;
  }

  async request(path, query = {}) {
    const url = canvasUrl(path, query);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 35000);
      try {
        const response = await fetch('/api/canvas', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + this.token,
          },
          body: JSON.stringify({ path: url.pathname + url.search }),
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const retry = response.status === 429 || response.status >= 500;
          if (retry && attempt < 2) { await sleep(Math.min(4000, 550 * 2 ** attempt)); continue; }
          const error = new Error(result.error || ('Canvas relay HTTP ' + response.status));
          error.status = response.status;
          throw error;
        }
        return {
          data: result.data,
          pagination: result.pagination || {},
          requestId: result.requestId || null,
          pages: 1,
        };
      } catch (error) {
        clearTimeout(timeout);
        lastError = error;
        if (error.status || attempt === 2) throw error;
        await sleep(Math.min(4000, 550 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  async getOne(path, query = {}) { return this.request(path, query); }

  async getAll(path, query = {}, { maxPages = 500 } = {}) {
    let next = canvasUrl(path, { per_page: 100, ...query }).toString();
    const seen = new Set(), items = [];
    let pages = 0, requestId = null;
    while (next && pages < maxPages) {
      if (seen.has(next)) throw new Error('Canvas pagination loop detected.');
      seen.add(next);
      const result = await this.request(next);
      requestId ||= result.requestId;
      if (Array.isArray(result.data)) items.push(...result.data);
      else if (result.data != null) items.push(result.data);
      pages++;
      next = result.pagination.next || '';
    }
    return { items, pages, truncated: Boolean(next), nextUrl: next || null, requestId };
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
