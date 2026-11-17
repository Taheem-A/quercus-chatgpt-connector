'use strict';

// An ephemeral, read-only relay. The Canvas access token is supplied for each
// request over HTTPS, forwarded to q.utoronto.ca, and NEVER persisted here.
// Intentionally restrict target hosts, paths and methods (not a generic proxy).
const CANVAS_ORIGIN = 'https://q.utoronto.ca';
const MAX_PATH = 6000;
const MAX_BODY = 4096;
const MAX_JSON_RESPONSE = 3 * 1024 * 1024;

const ROOT_PATHS = new Set([
  '/api/v1/courses', '/api/v1/planner/items', '/api/v1/planner/notes',
  '/api/v1/calendar_events', '/api/v1/conversations', '/api/v1/announcements',
  '/api/v1/users/self/profile', '/api/v1/users/self/settings',
  '/api/v1/users/self/enrollments', '/api/v1/users/self/todo',
  '/api/v1/users/self/upcoming_events', '/api/v1/users/self/activity_stream',
  '/api/v1/users/self/favorites/courses', '/api/v1/users/self/groups',
  '/api/v1/users/self/files', '/api/v1/users/self/folders',
  '/api/v1/users/self/submissions',
]);
const COURSE_CHILDREN = new Set([
  '', 'assignments', 'assignment_groups', 'students/submissions',
  'modules', 'pages', 'discussion_topics', 'files', 'folders', 'quizzes',
  'tabs', 'sections', 'rubrics', 'enrollments', 'users/self/progress',
  'front_page', 'activity_stream', 'features/enabled', 'root_outcome_group',
  'external_tools', 'grading_periods',
]);

function allowedPath(pathname) {
  if (ROOT_PATHS.has(pathname)) return true;
  // File metadata lookup, needed for links embedded in Canvas pages.
  // It returns an authorized temporary download URL, not file bytes.
  if (/^\/api\/v1\/files\/\d+$/.test(pathname)) return true;
  const match = /^\/api\/v1\/courses\/([0-9]+)(?:\/(.+))?$/.exec(pathname);
  if (!match) return false;
  const child = match[2] || '';
  if (COURSE_CHILDREN.has(child)) return true;
  return /^modules\/[0-9]+\/items$/.test(child) ||
    /^assignments\/[0-9]+\/peer_reviews$/.test(child) ||
    /^pages\/[a-z0-9_\-~.%]+$/i.test(child);
}

function validateTarget(rawTarget) {
  if (typeof rawTarget !== 'string' || rawTarget.length < 1 ||
      rawTarget.length > MAX_PATH || !rawTarget.startsWith('/api/v1/') ||
      rawTarget.startsWith('//') || /[\u0000-\u001f\\#]/.test(rawTarget) ||
      /(?:^|\/)(?:\.|%2e){1,2}(?:\/|\?|$)/i.test(rawTarget)) {
    return null;
  }
  try {
    const url = new URL(rawTarget, CANVAS_ORIGIN);
    if (url.origin !== CANVAS_ORIGIN || !allowedPath(url.pathname)) return null;
    if (url.searchParams.get('per_page') && !/^(?:[1-9]|[1-9]\d|100)$/.test(url.searchParams.get('per_page'))) return null;
    return url;
  } catch {
    return null;
  }
}

function nextPage(linkHeader) {
  for (const part of (linkHeader || '').split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/i.exec(part);
    if (!match) continue;
    const candidate = validateTarget(match[1].startsWith(CANVAS_ORIGIN) ? match[1].slice(CANVAS_ORIGIN.length) : '');
    return candidate ? candidate.toString() : null;
  }
  return null;
}

function reject(res, status, message) {
  return res.status(status).json({ error: message });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'POST') return reject(res, 405, 'Read-only relay accepts POST only.');

  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (!origin || origin !== 'https://' + req.headers.host ||
      (site && site !== 'same-origin' && site !== 'none')) {
    return reject(res, 403, 'Only same-origin Quercus Pocket requests are allowed.');
  }
  const auth = req.headers.authorization || '';
  if (!/^Bearer [^\s]{10,1024}$/.test(auth)) return reject(res, 401, 'Add a valid Quercus API token on your device.');
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    return reject(res, 415, 'Expected JSON request.');
  }
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) {
    return reject(res, 413, 'Request too large.');
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        JSON.stringify(payload).length > MAX_BODY) return reject(res, 400, 'Invalid request body.');
  } catch {
    return reject(res, 400, 'Invalid JSON.');
  }
  const url = validateTarget(payload.path);
  if (!url) return reject(res, 403, 'Canvas API path not approved for read-only sync.');

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'GET',
      headers: { Authorization: auth, Accept: 'application/json' },
      redirect: 'manual', // Never forward the token to a redirect destination.
      signal: AbortSignal.timeout(25000),
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return reject(res, 502, 'Canvas unexpectedly redirected this API request.');
    }
    // Canvas may return non-JSON HTML for disabled features; preserve the
    // actual status for useful diagnostics without exposing response content.
    if (!upstream.ok) return reject(res, upstream.status, 'Canvas API returned HTTP ' + upstream.status);
    const contentType = upstream.headers.get('content-type') || '';
    const responseLength = Number(upstream.headers.get('content-length') || 0);
    if (responseLength > MAX_JSON_RESPONSE) return reject(res, 502, 'Canvas response exceeds the safe size limit.');
    if (!/application\/json|application\/.*\+json/i.test(contentType)) {
      return reject(res, 502, 'Canvas did not return JSON.');
    }

    const chunks = [];
    let size = 0;
    for await (const chunk of upstream.body) {
      size += chunk.byteLength;
      if (size > MAX_JSON_RESPONSE) {
        await upstream.body.cancel().catch(() => {});
        return reject(res, 502, 'Canvas response exceeds the safe size limit.');
      }
      chunks.push(Buffer.from(chunk));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!upstream.ok) {
      // Avoid reflecting sensitive upstream errors or token metadata into UI/logs.
      return reject(res, upstream.status, 'Canvas API returned HTTP ' + upstream.status);
    }
    return res.status(200).json({
      data,
      pagination: { next: nextPage(upstream.headers.get('link')) },
      requestId: upstream.headers.get('x-request-id') || null,
      status: upstream.status,
    });
  } catch {
    // Do not print tokens, request bodies, URLs, or Canvas response bodies.
    return reject(res, 502, 'Canvas request failed or timed out. Retry the sync.');
  }
};

// Exposed only for offline tests; no Vercel endpoint can call these directly.
export { allowedPath, validateTarget, nextPage };
