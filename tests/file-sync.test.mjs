import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { safeSegment, listSnapshotFiles, syncFiles } from '../lib/file-sync.mjs';

function snapshot(updated = '2026-11-13T15:00:00Z') {
  return {
    courses: [{ id: 17, course_code: 'MAT188' }],
    courseData: {
      17: { files: [{ id: 302, display_name: 'Tutorial 07.pdf', size: 5,
        updated_at: updated, 'content-type': 'application/pdf' }] },
    },
  };
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'quercus-file-test-'));
}

test('sanitizes Windows-dangerous filename segments and rejects duplicate file IDs', () => {
  assert.equal(safeSegment('CON'), '_CON');
  assert.equal(safeSegment('test\\../:pdf'), 'test_..__pdf');
  assert.equal(safeSegment(' ..  '), 'untitled');
  const s = snapshot();
  s.courseData[17].files.push({ id: 302, display_name: 'Duplicate.pdf' });
  assert.equal(listSnapshotFiles(s).length, 1);
});

test('first run downloads, repeat run skips, revisions create new files without overwriting', async (t) => {
  const dir = await tempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let calls = 0;
  const client = {
    async downloadFile() {
      calls++;
      return { response: new Response('hello') };
    },
  };
  const one = await syncFiles({ snapshot: snapshot(), client, destination: dir });
  assert.equal(one.downloaded, 1);
  assert.equal(one.errors.length, 0);
  const originalNames = await fs.readdir(path.join(dir, 'MAT188'));
  assert.equal(originalNames.length, 1);
  const two = await syncFiles({ snapshot: snapshot(), client, destination: dir });
  assert.equal(two.unchanged, 1);
  assert.equal(calls, 1);
  const three = await syncFiles({ snapshot: snapshot('2026-11-14T15:00:00Z'), client, destination: dir });
  assert.equal(three.downloaded, 1);
  assert.equal(calls, 2);
  assert.equal((await fs.readdir(path.join(dir, 'MAT188'))).length, 2);
  assert.equal(await fs.readFile(path.join(dir, 'MAT188', originalNames[0]), 'utf8'), 'hello');
});

test('dry run performs no writes or network requests', async (t) => {
  const parent = await tempDir();
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const dir = path.join(parent, 'not-yet-created');
  const result = await syncFiles({ snapshot: snapshot(), destination: dir, dryRun: true });
  assert.equal(result.proposed, 1);
  await assert.rejects(() => fs.access(dir), { code: 'ENOENT' });
});

test('oversized, streamed oversized, and media files do not get imported', async (t) => {
  const dir = await tempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const large = snapshot();
  large.courseData[17].files[0].size = 15;
  const skipped = await syncFiles({ snapshot: large, destination: dir, client: { downloadFile() { throw Error('should not fetch'); } }, maxBytes: 10 });
  assert.equal(skipped.skippedLarge, 1);
  large.courseData[17].files[0].size = 5;
  const client = { async downloadFile() { return { response: new Response('123456789012345') }; } };
  const streamed = await syncFiles({ snapshot: large, destination: dir, client, maxBytes: 10 });
  assert.equal(streamed.errors.length, 1);
  const media = snapshot();
  media.courseData[17].files[0]['content-type'] = 'video/mp4';
  const blocked = await syncFiles({ snapshot: media, destination: dir, client });
  assert.equal(blocked.skippedMedia, 1);
});

test('download budget advances across unchanged entries on repeated runs', async (t) => {
  const dir = await tempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const s = snapshot();
  s.courseData[17].files.push({ id: 303, display_name: 'Tutorial 08.pdf', size: 5,
    updated_at: '2026-11-13T15:00:00Z', 'content-type': 'application/pdf' });
  let count = 0;
  const client = { async downloadFile() { count++; return { response: new Response('hello') }; } };
  const first = await syncFiles({ snapshot: s, client, destination: dir, maxFiles: 1 });
  assert.equal(first.downloaded, 1);
  assert.equal(first.attempted, 1);
  const preview = await syncFiles({ snapshot: s, destination: dir, maxFiles: 1, dryRun: true });
  assert.equal(preview.proposed, 1);
  assert.equal(preview.unchanged, 1);
  const next = await syncFiles({ snapshot: s, client, destination: dir, maxFiles: 1 });
  assert.equal(next.downloaded, 1);
  assert.equal(next.unchanged, 1);
  assert.equal(count, 2);
});
