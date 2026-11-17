import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, assignments, pages, announcements, extractMarkdownSections, htmlText } from '../mobile/data.mjs';

const example = {
  courses: [{ id: 1, course_code: 'APS111' }],
  courseData: {
    1: {
      pages: [{ url: 'schedule', title: 'Assessment Schedule', module_names: ['Week 10'], content_status: 'retrieved' }],
      pageDetails: { schedule: { body: '<p>Due: <strong>Friday</strong></p>' } },
      assignments: [{ id: 10, name: 'CDS', due_at: '2026-11-29T18:00:00Z', description: '<div>Build it</div>' }],
      announcements: [{ title: 'Reminder', message: '<p>Hi</p>' }],
    },
  },
};

test('validation rejects Markdown and malformed JSON', () => {
  assert.throws(() => validateSnapshot(null));
  assert.throws(() => validateSnapshot({ courses: [] }));
  assert.equal(validateSnapshot(example), example);
});
test('reader extracts module page text and assignment metadata', () => {
  assert.equal(pages(example)[0].text, 'Due: Friday');
  assert.equal(pages(example)[0].module, 'Week 10');
  assert.equal(assignments(example)[0].name, 'CDS');
  assert.equal(announcements(example)[0].title, 'Reminder');
});
test('markup never executes and Markdown extracts course sections', () => {
  assert.equal(htmlText('<script>alert(1)</script><p>A &amp; B</p>'), 'A & B');
  assert.deepEqual(extractMarkdownSections('## Immediate workload\nDue\n### APS111\nThing'), [
    { title: 'Immediate workload', content: 'Due\n' }, { title: 'APS111', content: 'Thing\n' },
  ]);
});
