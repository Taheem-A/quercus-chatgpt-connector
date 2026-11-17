import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { BrowserCanvasClient } from '../mobile/core/canvas.mjs';
import { syncQuercus } from '../mobile/core/sync.mjs';

const require = createRequire(import.meta.url);
const relay = require('../mobile/api/canvas.js');
const { allowedPath, validateTarget, nextPage } = relay._test;
const HOST = 'quercus-pocket.vercel.app';
const TOKEN = 'test-token-1234567890123';
function request(path, token = TOKEN, origin = 'https://' + HOST) {
  return {
    method: 'POST',
    headers: {
      host: HOST,
      origin,
      'sec-fetch-site': 'same-origin',
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    },
    body: { path },
  };
}
function response() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('Canvas relay rejects mutation endpoints, external hosts, path traversal and unapproved paths', () => {
  assert.equal(allowedPath('/api/v1/courses/123/modules'), true);
  assert.equal(allowedPath('/api/v1/courses/123/pages/assessment-schedule'), true);
  assert.equal(allowedPath('/api/v1/courses/123/assignments/44/peer_reviews'), true);
  assert.equal(allowedPath('/api/v1/courses/123/assignments/44/submissions'), false);
  assert.equal(validateTarget('//evil.com/api/v1/courses'), null);
  assert.equal(validateTarget('/api/v1/courses/123/../users/self/profile'), null);
  assert.equal(validateTarget('https://evil.com/api/v1/courses'), null);
  assert.equal(validateTarget('/api/v1/courses?per_page=500'), null);
  assert.equal(validateTarget('/api/v1/courses?per_page=100')?.host, 'q.utoronto.ca');
  assert.equal(nextPage('<https://evil.com/api/v1/courses?page=2>; rel="next"'), null);
});

test('relay requires same-origin POST with a token and never reflects it', async () => {
  const cases = [
    [{ method: 'GET', headers: {} }, 405],
    [request('/api/v1/courses', TOKEN, 'https://evil.com'), 403],
    [request('/api/v1/courses', 'short'), 401],
    [request('/api/v1/courses/123/submissions'), 403],
  ];
  for (const [req, expected] of cases) {
    const res = response();
    await relay(req, res);
    assert.equal(res.statusCode, expected);
    assert.ok(!JSON.stringify(res.body).includes(TOKEN));
  }
});

test('relay forwards read-only Canvas GET requests and returns permitted next-page URL', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url.origin, 'https://q.utoronto.ca');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
    return new Response(JSON.stringify([{ id: 1 }]), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        link: '<https://q.utoronto.ca/api/v1/courses?per_page=100&page=2>; rel="next"',
      },
    });
  };
  try {
    const res = response();
    await relay(request('/api/v1/courses?per_page=100'), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, [{ id: 1 }]);
    assert.match(res.body.pagination.next, /page=2/);
    assert.equal(calls, 1);
    assert.equal(res.headers['cache-control'], 'no-store, private');
    assert.ok(!JSON.stringify(res.body).includes(TOKEN));
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('phone completes an authenticated mock Quercus sync including a module-only Page', async () => {
  const oldFetch = globalThis.fetch;
  const seenPaths = [];
  globalThis.fetch = async (url, opts) => {
    if (url === '/api/canvas') {
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers.Authorization, 'Bearer ' + TOKEN);
      const res = response();
      await relay(request(JSON.parse(opts.body).path), res);
      return new Response(JSON.stringify(res.body), {
        status: res.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    }
    const u = new URL(url);
    seenPaths.push(u.pathname);
    let data = [];
    let status = 200;
    if (u.pathname === '/api/v1/users/self/profile') data = { id: 321, name: 'Test Student' };
    if (u.pathname === '/api/v1/courses' && u.searchParams.get('enrollment_state') === 'active')
      data = [{ id: 123, course_code: 'TEST101', name: 'Sample Course' }];
    if (u.pathname === '/api/v1/courses/123/modules')
      data = [{ id: 55, name: 'Week 10', items_count: 1, items: [{ id: 1, type: 'Page', title: 'Assessment Schedule', url: 'https://q.utoronto.ca/api/v1/courses/123/pages/assessment-schedule', page_url: 'assessment-schedule' }] }];
    if (u.pathname === '/api/v1/courses/123/pages') { status = 404; data = { errors: [{ message: 'This page has been disabled for this course' }] }; }
    if (u.pathname === '/api/v1/courses/123/pages/assessment-schedule')
      data = { title: 'Assessment Schedule', url: 'assessment-schedule', body: '<h2>Upcoming</h2><p>Midterm 6 PM</p>' };
    if (u.pathname === '/api/v1/courses/123/front_page') data = {};
    if (u.pathname === '/api/v1/courses/123') data = { id: 123 };
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = new BrowserCanvasClient(TOKEN);
    const profile = await client.getOne('/api/v1/users/self/profile');
    assert.equal(profile.data.id, 321);
    const snapshot = await syncQuercus(client);
    assert.equal(snapshot.courses.length, 1);
    assert.equal(snapshot.courseData[123].pages.length, 1);
    assert.equal(snapshot.courseData[123].pages[0].content_status, 'retrieved');
    assert.match(snapshot.courseData[123].pageDetails['assessment-schedule'].body, /Midterm 6 PM/);
    assert.ok(seenPaths.includes('/api/v1/courses/123/pages/assessment-schedule'));
    assert.ok(snapshot.diagnostics.some(d => d.status === 404 && d.path.endsWith('/123/pages')));
    assert.equal(snapshot.meta.failedEndpoints, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('phone mirrors the tested desktop sync engine', () => {
  for (const name of ['sync.mjs', 'page-content.mjs']) {
    const original = readFileSync(new URL('../lib/' + name, import.meta.url), 'utf8');
    const mobile = readFileSync(new URL('../mobile/core/' + name, import.meta.url), 'utf8');
    assert.equal(mobile, original, 'Desktop and mobile ' + name + ' drifted; update both.');
  }
});
