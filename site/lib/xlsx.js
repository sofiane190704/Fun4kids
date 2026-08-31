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

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

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

/** Opens filePath if it exists (and its single sheet's headers match), else
 * creates a fresh workbook with a title row + styled header row. Returns
 * {workbook, sheet} ready for a data row to be appended. */
async function openOrCreateRoster(filePath, title, headers) {
  const workbook = new ExcelJS.Workbook();
  let sheet;
  if (fs.existsSync(filePath)) {
    await workbook.xlsx.readFile(filePath);
    sheet = workbook.worksheets[0];
  } else {
    sheet = workbook.addWorksheet('Listing');
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
  return { workbook, sheet };
}

async function appendRow(filePath, title, headers, values) {
  if (!fs.existsSync(path.dirname(filePath))) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
  const { workbook, sheet } = await openOrCreateRoster(filePath, title, headers);
  const nextN = sheet.rowCount - 1; // header occupies row 2, data starts row 3 => N°1
  const row = sheet.addRow([nextN, ...values]);
  row.eachCell((cell) => {
    cell.font = BODY_FONT;
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle' };
  });
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

/** Stage inscription -> data/stage-<weekSlug>.xlsx, one workbook per week. */
async function appendStageRow(dataDir, weekLabel, weekSlug, data) {
  const slug = weekSlug || slugify(weekLabel) || 'semaine';
  const filePath = path.join(dataDir, `stage-${slug}.xlsx`);
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
  return appendRow(filePath, `Listing présence — ${weekLabel}`, headers, values);
}

async function appendAcademieRow(dataDir, data) {
  const filePath = path.join(dataDir, 'academie.xlsx');
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
  return appendRow(filePath, 'Listing Académie de futsal', headers, values);
}

async function appendAnnivRow(dataDir, data) {
  const filePath = path.join(dataDir, 'anniversaires.xlsx');
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
  return appendRow(filePath, 'Listing Anniversaires', headers, values);
}

async function appendSejourRow(dataDir, data) {
  const filePath = path.join(dataDir, 'sejour.xlsx');
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
  return appendRow(filePath, 'Listing Séjour — Lloret del Mar 2027', headers, values);
}

module.exports = {
  computeAge,
  slugify,
  appendStageRow,
  appendAcademieRow,
  appendAnnivRow,
  appendSejourRow,
};
