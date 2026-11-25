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

/** Parses CSV content (as written by toRow/escapeCsv above — comma-separated,
 *  double-quote-escaped fields) into an array of row arrays. */
function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // ignored; \n (below) ends the row
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/**
 * Counts existing rows in <name>.csv matching `predicate(rowObject)`, where
 * rowObject is keyed by the file's own header row. Returns 0 if the file
 * doesn't exist yet. Used for small, point-in-time lookups (e.g. "has this
 * parent already registered a child for this activity?") — not meant for
 * large-scale querying.
 */
async function countRows(dataDir, name, predicate) {
  let content;
  if (blobStore.USE_BLOB) {
    const buf = await blobStore.readBlob(`data/${name}.csv`);
    content = buf ? buf.toString('utf8') : '';
  } else {
    const filePath = path.join(dataDir, `${name}.csv`);
    content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  }
  if (!content) return 0;
  const rows = parseCsv(content);
  if (rows.length <= 1) return 0; // header only, or empty
  const header = rows[0];
  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = rows[i][idx]; });
    if (predicate(obj)) count++;
  }
  return count;
}

module.exports = { appendRow, countRows };
