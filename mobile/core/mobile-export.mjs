import { makeIcs, makeMarkdown, exportFiles, filenameStamp } from './export.mjs';
import { createZip } from './zip.mjs';

// Entirely client-side exports: never send private course data or tokens to Vercel.
export function makeMobileExport(snapshot, format) {
  if (format === 'source-markdown') {
    throw new Error('Use makeSavedMarkdownExport for a Markdown-only import.');
  }
  if (!snapshot || !Array.isArray(snapshot.courses) || !snapshot.courseData) {
    throw new Error('Sync Quercus or import a JSON snapshot before exporting.');
  }
  const stamp = filenameStamp(snapshot);
  const mimeText = 'text/markdown;charset=utf-8';
  if (format === 'json') return {
    name: 'quercus-' + stamp + '.json',
    type: 'application/json',
    data: JSON.stringify(snapshot, null, 2) + '\n',
  };
  if (format === 'chatgpt') return {
    name: 'quercus-chatgpt-' + stamp + '.md',
    type: mimeText,
    data: makeMarkdown(snapshot, { chatgpt: true }) + '\n',
  };
  if (format === 'markdown') return {
    name: 'quercus-' + stamp + '.md',
    type: mimeText,
    data: makeMarkdown(snapshot) + '\n',
  };
  if (format === 'ics') return {
    name: 'quercus-' + stamp + '.ics',
    type: 'text/calendar;charset=utf-8',
    data: makeIcs(snapshot),
  };
  if (format === 'zip') return {
    name: 'quercus-export-' + stamp + '.zip',
    type: 'application/zip',
    data: createZip(exportFiles(snapshot)),
  };
  throw new Error('Unsupported export format.');
}

export function makeSavedMarkdownExport(markdown) {
  if (typeof markdown !== 'string' || !markdown.startsWith('# Quercus')) {
    throw new Error('No saved Quercus Markdown document.');
  }
  return {
    name: 'quercus-saved-' + new Date().toISOString().slice(0, 10) + '.md',
    type: 'text/markdown;charset=utf-8',
    data: markdown,
  };
}
