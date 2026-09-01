// Builds/updates printable "listing" workbooks for Fun4Kids registrations —
// one row per inscription, formatted to match the ASBL's existing paper
// listings (title row, bold header row, borders, wide enough to print).
//
// Design choices (see conversation with the user for context):
//  - Stages: one .xlsx PER WEEK (e.g. stage-halloween-1.xlsx), with L/M/M/J/V
//    attendance columns left blank for staff to tick by hand, and a trailing
//    ANIMATEUR column left blank for manual group assignment — matching the
//    ASBL's own "Listing présence" sheets.
//  - Académie / Anniversaires / Séjour: one running roster per activity.
//  - PAIEMENT is always left blank at registration time — staff fill it in
//    once the bank transfer is received (per the site's own confirmation
//    copy: no payment is collected online).
//
// Storage backend: local disk under dataDir by default, or Vercel Blob
// (private) when BLOB_READ_WRITE_TOKEN is set — see lib/blobStore.js. In
// Blob mode there is no real file path: each roster is read back in full,
// modified in memory with exceljs, and re-uploaded whole (no file locking —
// see blobStore.js for why that's an acceptable trade-off here).

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const blobStore = require('./blobStore');

const FONT_NAME = 'Arial';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF26E38' } };
const HEADER_FONT = { name: FONT_NAME, bold: true, color: { argb: 'FFFFFFFF' } };
const TITLE_FONT = { name: FONT_NAME, bold: true, size: 13 };
const BODY_FONT = { name: FONT_NAME, size: 11 };
const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
  right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
};
const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Age in years (0.5 precision, matching how the ASBL writes ages by hand —
 * e.g. 2.5, 5.5) computed from an ISO date-of-birth string. Returns '' when
 * the date is missing/unparseable, rather than guessing. */
function computeAge(dobStr) {
  if (!dobStr) return '';
  const dob = new Date(dobStr);
  if (Number.isNaN(dob.getTime())) return '';
  const years = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years < 0) return '';
  return Math.round(years * 2) / 2;
}

function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function styleHeaderSheet(sheet, title, headers) {
  sheet.mergeCells(1, 1, 1, headers.length);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = TITLE_FONT;
  headers.forEach((h, i) => {
    const cell = sheet.getRow(2).getCell(i + 1);
    cell.value = h;
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  sheet.getRow(2).height = 22;
  sheet.columns = headers.map(() => ({ width: 16 }));
  sheet.views = [{ state: 'frozen', ySplit: 2 }];
}

/** Loads the workbook for `key` (local file path or Blob pathname), creating
 * a fresh one with a title row + styled header row if it doesn't exist yet.
 * Returns {workbook, sheet} ready for a data row to be appended. */
async function openOrCreateRoster(key, title, headers) {
  const workbook = new ExcelJS.Workbook();
  let sheet;
  let existingBuffer = null;

  if (blobStore.USE_BLOB) {
    existingBuffer = await blobStore.readBlob(key);
  } else if (fs.existsSync(key)) {
    existingBuffer = await fs.promises.readFile(key);
  }

  if (existingBuffer) {
    await workbook.xlsx.load(existingBuffer);
    sheet = workbook.worksheets[0];
  } else {
    sheet = workbook.addWorksheet('Listing');
    styleHeaderSheet(sheet, title, headers);
  }
  return { workbook, sheet };
}

async function appendRow(key, title, headers, values) {
  const { workbook, sheet } = await openOrCreateRoster(key, title, headers);
  const nextN = sheet.rowCount - 1; // header occupies row 2, data starts row 3 => N°1
  const row = sheet.addRow([nextN, ...values]);
  row.eachCell((cell) => {
    cell.font = BODY_FONT;
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle' };
  });

  if (blobStore.USE_BLOB) {
    const buffer = await workbook.xlsx.writeBuffer();
    await blobStore.writeBlob(key, buffer, XLSX_CONTENT_TYPE);
  } else {
    if (!fs.existsSync(path.dirname(key))) fs.mkdirSync(path.dirname(key), { recursive: true });
    await workbook.xlsx.writeFile(key);
  }
  return key;
}

/** Stage inscription -> data/stage-<weekSlug>.xlsx, one workbook per week. */
async function appendStageRow(dataDir, weekLabel, weekSlug, data) {
  const slug = weekSlug || slugify(weekLabel) || 'semaine';
  const key = blobStore.USE_BLOB ? `data/stage-${slug}.xlsx` : path.join(dataDir, `stage-${slug}.xlsx`);
  const headers = ['N°', 'NOM', 'PRENOM', 'AGE', 'GSM', 'MAIL', 'PAIEMENT', 'L', 'M', 'M', 'J', 'V', 'ANIMATEUR'];
  const values = [
    data.child_nom || '',
    data.child_prenom || '',
    computeAge(data.child_naissance),
    data.parent_tel || '',
    data.parent_email || '',
    '', // paiement — filled in by hand
    '', '', '', '', '', // L M M J V — ticked by hand
    '', // animateur — assigned by hand
  ];
  return appendRow(key, `Listing présence — ${weekLabel}`, headers, values);
}

async function appendAcademieRow(dataDir, data) {
  const key = blobStore.USE_BLOB ? 'data/academie.xlsx' : path.join(dataDir, 'academie.xlsx');
  const headers = ['N°', 'NOM', 'PRENOM', 'AGE', 'GSM', 'MAIL', 'CATEGORIE', 'FORMULE', 'JOUR', 'PAIEMENT'];
  const values = [
    data.child_nom || '',
    data.child_prenom || '',
    computeAge(data.child_naissance),
    data.parent_tel || '',
    data.parent_email || '',
    data.academie_categorie || '',
    data.academie_formule || '',
    data.academie_jour || '',
    '',
  ];
  return appendRow(key, 'Listing Académie de futsal', headers, values);
}

async function appendAnnivRow(dataDir, data) {
  const key = blobStore.USE_BLOB ? 'data/anniversaires.xlsx' : path.join(dataDir, 'anniversaires.xlsx');
  const headers = ['N°', 'RESPONSABLE', 'GSM', 'MAIL', 'DATE FÊTE', 'NB ENFANTS', 'FORMULE', 'THÈME', 'PAIEMENT'];
  const values = [
    data.parent_nom || '',
    data.parent_tel || '',
    data.parent_email || '',
    data.anniv_date || '',
    data.anniv_count || '',
    data.anniv_formule || '',
    data.anniv_theme || '',
    '',
  ];
  return appendRow(key, 'Listing Anniversaires', headers, values);
}

async function appendSejourRow(dataDir, data) {
  const key = blobStore.USE_BLOB ? 'data/sejour.xlsx' : path.join(dataDir, 'sejour.xlsx');
  const headers = ['N°', 'NOM', 'PRENOM', 'AGE', 'GSM', 'MAIL', 'CONTACT URGENCE', 'TEL URGENCE', 'PAIEMENT'];
  const values = [
    data.child_nom || '',
    data.child_prenom || '',
    computeAge(data.child_naissance),
    data.parent_tel || '',
    data.parent_email || '',
    data.sejour_urgence_nom || '',
    data.sejour_urgence_tel || '',
    '',
  ];
  return appendRow(key, 'Listing Séjour — Lloret del Mar 2027', headers, values);
}

/** Contact-form message -> data/contact.xlsx, one running log. */
async function appendContactRow(dataDir, data) {
  const key = blobStore.USE_BLOB ? 'data/contact.xlsx' : path.join(dataDir, 'contact.xlsx');
  const headers = ['N°', 'DATE', 'NOM', 'EMAIL', 'SUJET', 'MESSAGE'];
  const values = [
    new Date().toLocaleString('fr-BE'),
    data.nom || '',
    data.email || '',
    data.sujet || '',
    data.message || '',
  ];
  return appendRow(key, 'Messages de contact', headers, values);
}

module.exports = {
  computeAge,
  slugify,
  appendStageRow,
  appendAcademieRow,
  appendAnnivRow,
  appendSejourRow,
  appendContactRow,
};
