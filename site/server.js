// Fun4Kids ASBL — static site server + form submission endpoints.
// Serves public/ as-is. Contact messages are appended to data/contact.csv.
// Inscriptions are appended to printable .xlsx "listing" workbooks under
// data/ (one per activity; Stages get one workbook PER WEEK), matching the
// ASBL's existing paper listing format — see lib/xlsx.js.
//
// No outbound email is configured (no SMTP credentials were provided) —
// submissions land in the files below and the ASBL team follows up
// manually. See README.md for details.

const path = require('path');
const express = require('express');
const { appendRow } = require('./lib/csv');
const xlsxRoster = require('./lib/xlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const CONTACT_COLUMNS = ['timestamp', 'nom', 'email', 'sujet', 'message'];
const LOG_COLUMNS = ['timestamp', 'activite', 'payload'];

// Extra required fields per activity, beyond the parent's own coordinates
// (checked below for every activity) — a quick sanity check before we
// bother writing a row.
const REQUIRED_FIELDS = {
  academie: ['child_nom', 'child_prenom'],
  anniv: ['anniv_date'],
  stage: ['child_nom', 'child_prenom', 'stage_semaine'],
  sejour: ['child_nom', 'child_prenom'],
};

const WRITERS = {
  academie: (data) => xlsxRoster.appendAcademieRow(DATA_DIR, data),
  anniv: (data) => xlsxRoster.appendAnnivRow(DATA_DIR, data),
  stage: (data) => xlsxRoster.appendStageRow(DATA_DIR, data.stage_semaine_label || data.stage_semaine, data.stage_semaine_slug, data),
  sejour: (data) => xlsxRoster.appendSejourRow(DATA_DIR, data),
};

app.post('/api/contact', (req, res) => {
  const body = req.body || {};
  if (!body.nom || !body.email || !body.message) {
    return res.status(400).json({ ok: false, error: 'Champs requis manquants.' });
  }
  const row = {
    timestamp: new Date().toISOString(),
    nom: body.nom,
    email: body.email,
    sujet: body.sujet || '',
    message: body.message,
  };
  try {
    appendRow(DATA_DIR, 'contact', CONTACT_COLUMNS, row);
    res.json({ ok: true });
  } catch (err) {
    console.error('contact write failed', err);
    res.status(500).json({ ok: false, error: 'Écriture impossible.' });
  }
});

app.post('/api/inscription', async (req, res) => {
  const body = req.body || {};
  const activite = body.activite;
  const writer = WRITERS[activite];
  if (!writer) {
    return res.status(400).json({ ok: false, error: 'Activité inconnue.' });
  }
  if (!body.parent_nom || !body.parent_email || !body.parent_tel) {
    return res.status(400).json({ ok: false, error: 'Coordonnées du responsable manquantes.' });
  }
  const missing = (REQUIRED_FIELDS[activite] || []).filter((f) => !body[f]);
  if (missing.length) {
    return res.status(400).json({ ok: false, error: `Champs manquants : ${missing.join(', ')}` });
  }
  try {
    const filePath = await writer(body);
    // Full audit log (every submitted field, including notes_medicales —
    // allergies/medical info — which the printable roster above
    // deliberately omits since it's meant as a one-page attendance sheet,
    // not a place to leave sensitive medical notes lying around).
    appendRow(DATA_DIR, 'inscriptions-log', LOG_COLUMNS, {
      timestamp: new Date().toISOString(),
      activite,
      payload: JSON.stringify(body),
    });
    res.json({ ok: true, file: path.basename(filePath) });
  } catch (err) {
    console.error('inscription write failed', err);
    res.status(500).json({ ok: false, error: 'Écriture impossible.' });
  }
});

app.listen(PORT, () => {
  console.log(`Fun4Kids site running at http://localhost:${PORT}`);
});
