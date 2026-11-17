// A small dependency-free ZIP (STORE) writer for the mobile browser.
// Runs entirely on the phone; does not upload export data to Vercel.
const encoder = new TextEncoder();

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimeStamp(date = new Date()) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function prepareEntry(entry) {
  const name = String(entry.name).replace(/\\/g, '/');
  if (!name || name.startsWith('/') || name.split('/').some(x => x === '..')) throw new Error('Unsafe ZIP entry name.');
  const bytes = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
  if (!(bytes instanceof Uint8Array)) throw new Error('ZIP data must be string or byte array.');
  return { filename: encoder.encode(name), bytes, crc: crc32(bytes) };
}

export function createZip(files) {
  if (!Array.isArray(files) || files.length > 65535) throw new Error('Too many ZIP entries.');
  const entries = files.map(prepareEntry);
  const totalBytes = entries.reduce((n, e) => n + 30 + 46 + 2 * e.filename.length + e.bytes.length, 22);
  if (totalBytes > 250 * 1024 * 1024 || totalBytes >= 0xffffffff) throw new Error('ZIP is too large for an iPhone export.');
  const result = new Uint8Array(totalBytes);
  const view = new DataView(result.buffer);
  const {time, day} = dosTimeStamp();
  let offset = 0;
  const central = [];

  const u16 = (position, value) => view.setUint16(position, value, true);
  const u32 = (position, value) => view.setUint32(position, value, true);

  for (const entry of entries) {
    const start = offset;
    u32(start, 0x04034b50);
    u16(start + 4, 20);       // version needed
    u16(start + 6, 0x0800);   // UTF-8 filename
    u16(start + 8, 0);        // STORE (no compression)
    u16(start + 10, time); u16(start + 12, day);
    u32(start + 14, entry.crc);
    u32(start + 18, entry.bytes.length);
    u32(start + 22, entry.bytes.length);
    u16(start + 26, entry.filename.length);
    u16(start + 28, 0);
    result.set(entry.filename, start + 30);
    result.set(entry.bytes, start + 30 + entry.filename.length);
    offset += 30 + entry.filename.length + entry.bytes.length;
    central.push({entry, start});
  }

  const centralOffset = offset;
  for (const {entry, start} of central) {
    const pos = offset;
    u32(pos, 0x02014b50);
    u16(pos + 4, 20); u16(pos + 6, 20);
    u16(pos + 8, 0x0800); u16(pos + 10, 0);
    u16(pos + 12, time); u16(pos + 14, day);
    u32(pos + 16, entry.crc);
    u32(pos + 20, entry.bytes.length); u32(pos + 24, entry.bytes.length);
    u16(pos + 28, entry.filename.length);
    u16(pos + 30, 0); u16(pos + 32, 0);
    u16(pos + 34, 0); u16(pos + 36, 0);
    u32(pos + 38, 0); u32(pos + 42, start);
    result.set(entry.filename, pos + 46);
    offset += 46 + entry.filename.length;
  }
  const centralSize = offset - centralOffset;
  u32(offset, 0x06054b50);
  u16(offset + 4, 0); u16(offset + 6, 0);
  u16(offset + 8, entries.length);
  u16(offset + 10, entries.length);
  u32(offset + 12, centralSize);
  u32(offset + 16, centralOffset);
  u16(offset + 20, 0);
  return result;
}
