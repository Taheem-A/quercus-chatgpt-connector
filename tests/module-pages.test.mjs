import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCoursePages, pageHtmlToMarkdown } from '../lib/page-content.mjs';
import { syncQuercus } from '../lib/sync.mjs';
import { exportFiles, makeMarkdown } from '../lib/export.mjs';

test('discovers and deduplicates Pages from Modules even without a Pages list', () => {
  const pages = discoverCoursePages({
    pages: [],
    modules: [
      { id: 1, name: 'Week 10', items: [
        { type: 'Page', url: 'https://q.utoronto.ca/api/v1/courses/123/pages/assessment-schedule', page_url: 'assessment-schedule', html_url: 'https://q.utoronto.ca/courses/123/modules/items/99', title: 'Assessment Schedule' },
        { type: 'Page', page_url: 'checklist', title: 'Checklist' },
      ] },
      { id: 2, name: 'Resources', items: [
        { type: 'Page', page_url: 'assessment-schedule', title: 'Assessment Schedule' },
      ] },
    ],
  }, 123, 'https://q.utoronto.ca');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].url, 'assessment-schedule', 'Canvas ModuleItem.url must not be used as the slug');
  assert.deepEqual(pages[0].module_names, ['Week 10', 'Resources']);
  assert.equal(pages[0].html_url, 'https://q.utoronto.ca/courses/123/pages/assessment-schedule');
});

test('HTML page conversion retains structure, links and full content', () => {
  const longText = 'Lesson'.repeat(800);
  const actual = pageHtmlToMarkdown(
    '<h2>Assessment &amp; Schedule</h2><p>' + longText +
    '</p><ul><li>Read <a href="/courses/123/files/4">file</a></li></ul>' +
    '<script>steal()</script>',
    'https://q.utoronto.ca',
  );
  assert.match(actual, /Assessment & Schedule/);
  assert.ok(actual.includes(longText));
  assert.ok(actual.includes('[file](https://q.utoronto.ca/courses/123/files/4)'));
  assert.doesNotMatch(actual, /steal\(\)/);
});

test('sync fetches module Page bodies when Pages list is 404 and embedded module items are incomplete', async () => {
  const calls = [];
  const longText = 'x'.repeat(4000);
  const client = {
    baseUrl: 'https://q.utoronto.ca',
    async getOne(path) {
      calls.push(path);
      if (path.endsWith('/pages/lesson-one')) {
        return { data: { url: 'lesson-one', title: 'Lesson One', body: '<h2>Details</h2><p>' + longText + '</p>' } };
      }
      if (path.endsWith('/pages/lesson-two')) {
        return { data: { url: 'lesson-two', title: 'Lesson Two', body: '<p>Second page</p>' } };
      }
      return { data: {} };
    },
    async getAll(path, query) {
      calls.push(path);
      if (path === '/api/v1/courses' && query.enrollment_state === 'active') {
        return { items: [{ id: 123, course_code: 'TEST101', name: 'Sample Course' }], pages: 1 };
      }
      if (path === '/api/v1/courses/123/pages') {
        throw Object.assign(new Error('That page has been disabled for this course'), { status: 404 });
      }
      if (path === '/api/v1/courses/123/modules') {
        return { items: [{
          id: 55, name: 'Week 10', items_count: 3,
          items: [{ id: 1, type: 'Page', page_url: 'lesson-one', title: 'Lesson One' }],
        }], pages: 1 };
      }
      if (path === '/api/v1/courses/123/modules/55/items') {
        return { items: [
          { id: 1, type: 'Page', url: 'https://q.utoronto.ca/api/v1/courses/123/pages/lesson-one', page_url: 'lesson-one', title: 'Lesson One' },
          { id: 2, type: 'Page', url: 'https://q.utoronto.ca/api/v1/courses/123/pages/lesson-two', page_url: 'lesson-two', title: 'Lesson Two' },
          { id: 3, type: 'Assignment', title: 'Quiz' },
        ], pages: 1 };
      }
      return { items: [], pages: 1 };
    },
  };

  const snapshot = await syncQuercus(client);
  assert.equal(snapshot.courseData[123].pages.length, 2);
  assert.equal(snapshot.derived.counts.pages, 2);
  assert.equal(snapshot.courseData[123].pageDetails['lesson-one'].body.includes(longText), true);
  assert.deepEqual(calls.filter((p) => p === '/api/v1/courses/123/pages/lesson-one'), ['/api/v1/courses/123/pages/lesson-one']);
  assert.ok(snapshot.diagnostics.some((d) => d.path === '/api/v1/courses/123/pages' && !d.ok));
  assert.ok(snapshot.diagnostics.some((d) => d.path === '/api/v1/courses/123/pages/lesson-one' && d.ok));
  assert.equal(calls.some((p) => p.includes(encodeURIComponent('https://q.utoronto.ca/api/'))), false, 'should never URL-encode an absolute API URL as a page slug');

  const chatgpt = makeMarkdown(snapshot, { chatgpt: true });
  assert.ok(chatgpt.includes(longText), 'Pages must not be silently truncated at 2200 characters');
  assert.match(chatgpt, /Lesson Two/);
  assert.match(chatgpt, /Second page/);

  const csv = exportFiles(snapshot).find((file) => file.name === 'csv/pages.csv');
  assert.ok(csv);
  assert.ok(csv.data.includes('lesson-one'));
  assert.ok(csv.data.includes('Second page'));
  assert.ok(csv.data.includes('body_html'));
});

test('unreadable module Page stays visible and is reported unavailable', async () => {
  const pages = discoverCoursePages({
    pages: [],
    modules: [{ id: 7, name: 'Locked', items: [{ type: 'Page', page_url: 'private', title: 'Private' }] }],
  }, 123, 'https://q.utoronto.ca');
  pages[0].content_status = 'unavailable';
  const snapshot = {
    meta: { completedAt: '2026-11-17T21:11:00Z', baseUrl: 'https://q.utoronto.ca' },
    courses: [{ id: 123, course_code: 'TEST101' }],
    courseData: { 123: { pages, pageDetails: {} } },
    diagnostics: [],
    derived: {},
  };
  const text = makeMarkdown(snapshot, { chatgpt: true });
  assert.match(text, /Page body unavailable/);
  assert.match(text, /private/);
});
