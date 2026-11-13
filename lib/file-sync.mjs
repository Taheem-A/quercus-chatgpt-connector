import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const MANIFEST_NAME = '.quercus-file-manifest.json';
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeSegment(value, fallback = 'untitled') {
  let result = String(value ?? '').normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 96)
    .replace(/[. ]+$/g, '');
  if (!result || result === '.' || result === '..') result = fallback;
  if (RESERVED.test(result)) result = '_' + result;
  return result;
}

export function listSnapshotFiles(snapshot, courseFilter = '') {
  const found = [];
  const seen = new Set();
  for (const course of snapshot?.courses || []) {
    const code = String(course.course_code || course.name || `Course-${course.id}`);
    if (courseFilter && ![code, String(course.id)].some((s) => s.toLowerCase().includes(courseFilter.toLowerCase()))) continue;
    for (const file of snapshot.courseData?.[course.id]?.files || []) {
      if (!/^\d+$/.test(String(file?.id || ''))) continue;
      const key = String(file.id);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ courseId: course.id, courseCode: code, file });
    }
  }
  return found;
}

function descriptor(entry) {
  const original = String(entry.file.display_name || entry.file.filename || `file-${entry.file.id}`);
  const extension = path.extname(original).slice(0, 16);
  const stem = safeSegment(extension ? original.slice(0, -extension.length) : original, 'file');
  const filenameExtension = extension.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
  const version = JSON.stringify([
    entry.file.updated_at || entry.file.modified_at || null,
    entry.file.size ?? null,
    original,
  ]);
  const shortHash = createHash('sha256').update(version).digest('hex').slice(0, 10);
  return {
    key: String(entry.file.id),
    version,
    relativePath: path.join(
      safeSegment(entry.courseCode, `Course-${entry.courseId}`),
      `${stem} [Canvas-${entry.file.id}-${shortHash}]${filenameExtension}`,
    ),
  };
}

async function loadManifest(destination) {
  try {
    const file = JSON.parse(await fs.readFile(path.join(destination, MANIFEST_NAME), 'utf8'));
    return file?.schemaVersion === 1 && file.files && typeof file.files === 'object'
      ? file : { schemaVersion: 1, files: {} };
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, files: {} };
    throw new Error('Could not read file sync manifest; refusing to overwrite or replace it.');
  }
}

async function saveManifest(destination, manifest) {
  const temp = path.join(destination, `.${MANIFEST_NAME}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, path.join(destination, MANIFEST_NAME));
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

async function readLimited(response, maxBytes) {
  const length = Number(response.headers?.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new Error('File exceeds size limit');
  if (!response.body) throw new Error('Missing file response body');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new Error('File exceeds size limit');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Opt-in, append-only import of Canvas course files into a user-selected directory.
 * Never deletes or overwrites existing course files. Version changes create new names.
 */
export async function syncFiles({
  snapshot, client, destination, dryRun = false, course = '', maxFiles = 100,
  maxBytes = 100 * 1024 * 1024, onProgress = () => {},
}) {
  if (!destination || !path.isAbsolute(destination)) throw new Error('Provide an absolute --out directory.');
  if (!snapshot?.courses || !snapshot?.courseData) throw new Error('Invalid Quercus snapshot.');
  if (!dryRun && typeof client?.downloadFile !== 'function') throw new Error('Canvas client is required for downloads.');
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('File count and size limits must be positive integers.');
  }
  if (!dryRun) await fs.mkdir(destination, { recursive: true });
  const manifest = dryRun ? { schemaVersion: 1, files: {} } : await loadManifest(destination);
  const summary = { total: 0, downloaded: 0, unchanged: 0, skippedLarge: 0, skippedMedia: 0, conflicts: 0, errors: [], proposed: 0 };
  const candidates = listSnapshotFiles(snapshot, course).slice(0, maxFiles);
  summary.total = candidates.length;
  for (const entry of candidates) {
    const spec = descriptor(entry);
    const mime = String(entry.file['content-type'] || entry.file.content_type || '');
    const size = Number(entry.file.size ?? 0);
    if (/^(audio|video)\//i.test(mime)) { summary.skippedMedia++; continue; }
    if (size > maxBytes) { summary.skippedLarge++; continue; }
    const output = path.join(destination, spec.relativePath);
    const current = manifest.files[spec.key];
    if (current?.version === spec.version && current.relativePath === spec.relativePath) {
      try { await fs.access(output); summary.unchanged++; continue; } catch {}
    }
    if (dryRun) { summary.proposed++; onProgress({ fileId: spec.key, action: 'would-download', relativePath: spec.relativePath }); continue; }
    try {
      // Even when the manifest is missing, never assume a pre-existing file is ours.
      try { await fs.access(output); summary.conflicts++; continue; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const { response } = await client.downloadFile(spec.key);
      const bytes = await readLimited(response, maxBytes);
      await fs.mkdir(path.dirname(output), { recursive: true });
      const temporary = path.join(path.dirname(output), `.quercus-${randomUUID()}.part`);
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx' });
        await fs.copyFile(temporary, output, fsConstants.COPYFILE_EXCL);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      manifest.files[spec.key] = {
        version: spec.version, relativePath: spec.relativePath,
        sourceCourseId: entry.courseId, syncedAt: new Date().toISOString(),
      };
      await saveManifest(destination, manifest);
      summary.downloaded++;
      onProgress({ fileId: spec.key, action: 'downloaded', relativePath: spec.relativePath });
    } catch (error) {
      if (error.code === 'EEXIST') summary.conflicts++;
      else summary.errors.push({ fileId: spec.key, error: String(error.message || error).slice(0, 250) });
      onProgress({ fileId: spec.key, action: 'failed' });
    }
  }
  return summary;
}
