// Minimal CSV append helper.
// Each call appends one row to <name>.csv, writing the header (from
// `columns`) the first time the file is created. Values are looked up from
// `row` by column name; missing values become ''.
//
// Storage backend: local disk under dataDir by default, or Vercel Blob
// (private) when BLOB_READ_WRITE_TOKEN is set — see lib/blobStore.js.

const fs = require('fs');
const path = require('path');
const blobStore = require('./blobStore');

function escapeCsv(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toRow(values) {
  return values.map(escapeCsv).join(',') + '\r\n';
}

/**
 * Append one row to <name>.csv.
 * @param {string} dataDir absolute path to the local data directory (local-disk mode only)
 * @param {string} name file basename without extension (already validated by caller)
 * @param {string[]} columns fixed column order for this file
 * @param {object} row values keyed by column name (plus a 'timestamp' auto-filled if listed)
 * @returns {Promise<string>} the file path (local mode) or blob pathname (Blob mode)
 */
async function appendRow(dataDir, name, columns, row) {
  const values = columns.map((c) => (c === 'timestamp' ? row.timestamp : row[c]));

  if (blobStore.USE_BLOB) {
    const pathname = `data/${name}.csv`;
    const existing = await blobStore.readBlob(pathname);
    let out = '';
    if (!existing) out += toRow(columns);
    out += toRow(values);
    const content = existing ? Buffer.concat([existing, Buffer.from(out, 'utf8')]) : Buffer.from(out, 'utf8');
    await blobStore.writeBlob(pathname, content, 'text/csv');
    return pathname;
  }

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, `${name}.csv`);
  const isNew = !fs.existsSync(filePath);
  let out = '';
  if (isNew) out += toRow(columns);
  out += toRow(values);
  fs.appendFileSync(filePath, out, 'utf8');
  return filePath;
}

module.exports = { appendRow };
