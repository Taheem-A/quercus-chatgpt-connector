import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCanvasLink } from '../mobile/core/rich-content.mjs';
import { createZip } from '../mobile/core/zip.mjs';
import { makeMobileExport, makeSavedMarkdownExport } from '../mobile/core/mobile-export.mjs';
import { pages } from '../mobile/data.mjs';
import { allowedPath } from '../mobile/api/canvas.js';

const sample = {
  meta: { completedAt: '2026-11-17T22:00:00Z', failedEndpoints: 0 },
  courses: [{ id: 123, name: 'Engineering Strategies', course_code: 'APS111', html_url: 'https://q.utoronto.ca/courses/123' }],
  courseData: { 123: {
    modules: [{id:5,name:'Week 10',items:[{type:'Page',page_url:'week-10',title:'Week 10'}]}],
    pages: [{url:'week-10',title:'Week 10',module_names:['Week 10'],content_status:'retrieved'}],
    pageDetails: {'week-10': {url:'week-10',title:'Week 10',body:'<p>Download <a href="/courses/123/files/456/download">PDF</a>.</p>'}},
    assignments: [{id:20,name:'Team Charter',due_at:'2026-11-20T20:00:00Z',html_url:'https://q.utoronto.ca/courses/123/assignments/20'}],
    announcements: [],
  }},
  global: { calendarEvents: [] },
  diagnostics: [],
  derived: { counts: { assignments:1,pages:1 }, assignments:[
    {courseId:123,id:20,courseCode:'APS111',name:'Team Charter',dueAt:'2026-11-20T20:00:00Z'},
  ], overdueAssignments:[],upcomingAssignments:[],recentAnnouncements:[],grades:[] },
};

test('Canvas-rich-content URL classification preserves page links and detects file references', () => {
  const fileByHref = classifyCanvasLink('/courses/123/files/456/download?download_frd=1');
  assert.deepEqual({kind:fileByHref.kind,id:fileByHref.fileId}, {kind:'file',id:'456'});
  const fileByApi = classifyCanvasLink('/courses/123/modules/items/11',
    'https://q.utoronto.ca/api/v1/courses/123/files/555');
  assert.equal(fileByApi.fileId, '555');
  const page = classifyCanvasLink('/courses/123/pages/assessment-schedule');
  assert.equal(page.kind, 'quercus');
  assert.equal(page.url, 'https://q.utoronto.ca/courses/123/pages/assessment-schedule');
  const external = classifyCanvasLink('https://example.org/resource.pdf');
  assert.equal(external.kind, 'external');
  assert.equal(classifyCanvasLink('javascript:alert(1)'), null);
  assert.equal(classifyCanvasLink('data:text/html,<svg/onload=alert(1)>'), null);
  assert.equal(classifyCanvasLink('file:///etc/passwd'), null);
  assert.equal(classifyCanvasLink('https://evil.example/files/123').kind,'external');
});

test('file access is only via per-ID read-only Canvas metadata API', () => {
  assert.equal(allowedPath('/api/v1/files/456'), true);
  assert.equal(allowedPath('/api/v1/files/456/delete'), false);
  assert.equal(allowedPath('/api/v1/files/abc'), false);
  assert.equal(allowedPath('/api/v1/files/456/download'), false);
  assert.equal(allowedPath('/api/v1/files/456/reset_verifier'), false);
});

test('saved snapshot retains full raw HTML for later rendering', () => {
  const page = pages(sample)[0];
  assert.match(page.html, /<a href/);
  assert.match(page.text, /Download PDF/);
});

test('export mobile JSON Markdown ICS and complete ZIP without token', () => {
  const json = makeMobileExport(sample, 'json');
  assert.match(json.name, /\.json$/);
  assert.deepEqual(JSON.parse(json.data).courseData[123].pageDetails['week-10'].body,
    sample.courseData[123].pageDetails['week-10'].body);
  assert.doesNotMatch(json.data, /Canvas access token/);
  const md = makeMobileExport(sample, 'chatgpt');
  assert.match(md.data, /##### Week 10/);
  assert.match(md.data, /files\/456\/download/);
  const readable = makeMobileExport(sample, 'markdown');
  assert.match(readable.data, /APS111/);
  const calendar = makeMobileExport(sample, 'ics');
  assert.match(calendar.data, /BEGIN:VCALENDAR/);
  assert.match(calendar.data, /BEGIN:VEVENT/);
  const zip = makeMobileExport(sample, 'zip');
  assert.match(zip.name, /\.zip$/);
  assert.equal(new DataView(zip.data.buffer).getUint32(0, true), 0x04034b50);
  const eocd = new DataView(zip.data.buffer).getUint32(zip.data.byteLength-22,true);
  assert.equal(eocd,0x06054b50);
  const numEntries = new DataView(zip.data.buffer).getUint16(zip.data.byteLength-12,true);
  assert.ok(numEntries >= 10, 'should contain all desktop export tables and snapshots');
  assert.ok(new TextDecoder().decode(zip.data).includes('snapshot.json'));
  assert.ok(new TextDecoder().decode(zip.data).includes('csv/pages.csv'));
  assert.throws(() => makeMobileExport(null,'json'));
});

test('ZIP writer computes size, central directory and filenames correctly', () => {
  const bytes = createZip([{name:'a.txt',data:'hello'},{name:'sub/b.txt',data:'world'}]);
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0,true),0x04034b50);
  assert.equal(view.getUint16(bytes.byteLength-12,true),2);
  assert.equal(view.getUint32(bytes.byteLength-22,true),0x06054b50);
  assert.equal(view.getUint32(14,true),0x3610a686,'known CRC32(hello)');
  assert.throws(()=>createZip([{name:'../evil.txt',data:'bad'}]));
});

test('Markdown-only import can still be exported to .md', () => {
  const md = makeSavedMarkdownExport('# Quercus Context for ChatGPT\nCourse notes');
  assert.match(md.name,/\.md$/);
  assert.match(md.data,/Course notes/);
  assert.throws(()=>makeSavedMarkdownExport('not Quercus'));
});
