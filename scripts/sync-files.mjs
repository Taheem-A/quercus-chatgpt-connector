import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasClient } from '../lib/canvas.mjs';
import { loadSettings } from '../lib/config.mjs';
import { syncFiles } from '../lib/file-sync.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function parseArgs(args) {
  const options = { dryRun: false, maxFiles: 100, maxBytes: 100 * 1024 * 1024 };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--dry-run') { options.dryRun = true; continue; }
    if (['--out', '--course', '--max-files', '--max-mb'].includes(key)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      if (key === '--out') options.destination = path.resolve(value);
      if (key === '--course') options.course = value;
      if (key === '--max-files') options.maxFiles = Number(value);
      if (key === '--max-mb') options.maxBytes = Math.floor(Number(value) * 1024 * 1024);
      continue;
    }
    throw new Error(`Unknown argument: ${key}`);
  }
  if (!options.destination) throw new Error('Required: --out "C:\\path\\to\\UofT\\Quercus Imports"');
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(await fs.readFile(path.join(root, 'data', 'snapshot.json'), 'utf8'));
  const settings = options.dryRun ? null : await loadSettings(root);
  if (!options.dryRun && !settings.configured) throw new Error('Configure your Quercus token in the local app first.');
  const client = options.dryRun ? null : new CanvasClient(settings);
  const result = await syncFiles({
    snapshot, client, ...options,
    onProgress: (event) => console.log(`${event.action}: ${event.relativePath || event.fileId}`),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) process.exitCode = 1;
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
