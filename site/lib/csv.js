// Minimal, dependency-free CSV append helper.
// Each call appends one row to <name>.csv under DATA_DIR, writing the header
// (from `columns`) the first time the file is created. Values are looked up
// from `row` by column name; missing values become ''.

const fs = require('fs');
const path = require('path');

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
 * Append one row to dataDir/<name>.csv.
 * @param {string} dataDir absolute path to the data directory
 * @param {string} name file basename without extension (already validated by caller)
 * @param {string[]} columns fixed column order for this file
 * @param {object} row values keyed by column name (plus a 'timestamp' auto-filled if listed)
 */
function appendRow(dataDir, name, columns, row) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const filePath = path.join(dataDir, `${name}.csv`);
  const isNew = !fs.existsSync(filePath);
  const values = columns.map((c) => (c === 'timestamp' ? row.timestamp : row[c]));
  let out = '';
  if (isNew) out += toRow(columns);
  out += toRow(values);
  fs.appendFileSync(filePath, out, 'utf8');
  return filePath;
}

module.exports = { appendRow };
