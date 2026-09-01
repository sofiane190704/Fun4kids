// Fun4Kids ASBL — static site server + form submission endpoints.
// Serves public/ as-is. Every form (contact, académie, anniversaire, stage,
// séjour) is appended to its own .xlsx workbook under data/ (Stages get one
// workbook PER WEEK), matching the ASBL's existing paper listing format —
// see lib/xlsx.js. A separate CSV audit log keeps the full raw payload of
// every inscription (incl. optional medical notes, deliberately left out of
// the printable rosters — see lib/xlsx.js header comment).
//
// A small password-protected admin panel (public/admin.html + /api/admin/*
// below) lets the ASBL team list and download those files at any time —
// see README.md for how to set ADMIN_PASSWORD.
//
// No outbound email is configured (no SMTP credentials were provided) —
// submissions land in the files below and the ASBL team follows up
// manually. See README.md for details.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { appendRow } = require('./lib/csv');
const xlsxRoster = require('./lib/xlsx');
const blobStore = require('./lib/blobStore');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Diagnostic only — confirms whether submissions are being written to
// Vercel Blob (persistent) or the local disk fallback (lost between
// invocations on Vercel), and does a real write+read round-trip against a
// throwaway key (not one of the real csv/xlsx files) to catch auth/permission
// errors the mode check alone can't see. No submission data exposed.
app.get('/api/_storage-mode', async (req, res) => {
  const mode = blobStore.USE_BLOB ? 'vercel-blob' : 'local-disk';
  if (!blobStore.USE_BLOB) {
    return res.json({ storage: mode });
  }
  const testKey = 'data/_diagnostic-test.txt';
  const stamp = new Date().toISOString();
  try {
    await blobStore.writeBlob(testKey, Buffer.from(stamp, 'utf8'), 'text/plain');
    const readBack = await blobStore.readBlob(testKey);
    const roundtripOk = !!readBack && readBack.toString('utf8') === stamp;
    res.json({ storage: mode, roundtripOk });
  } catch (err) {
    res.json({ storage: mode, roundtripOk: false, error: String(err && err.message || err) });
  }
});

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

app.post('/api/contact', async (req, res) => {
  const body = req.body || {};
  if (!body.nom || !body.email || !body.message) {
    return res.status(400).json({ ok: false, error: 'Champs requis manquants.' });
  }
  try {
    await xlsxRoster.appendContactRow(DATA_DIR, body);
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
    await appendRow(DATA_DIR, 'inscriptions-log', LOG_COLUMNS, {
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

// ---------------------------------------------------------------------------
// Admin panel API — lets the ASBL team list and download every submission
// file (contact.xlsx, academie.xlsx, anniversaires.xlsx, stage-*.xlsx,
// sejour.xlsx, plus the inscriptions-log.csv audit trail) from
// public/admin.html, gated behind a single shared password.
//
// ADMIN_PASSWORD must be set (Vercel project settings -> Environment
// Variables) or every /api/admin/* route responds 503 — there is no
// hardcoded fallback and no admin panel until it's configured.
// ---------------------------------------------------------------------------

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h
// Secret used to sign session tokens. A dedicated ADMIN_TOKEN_SECRET is
// preferred; if absent, one is derived from ADMIN_PASSWORD so only a single
// env var is strictly required.
const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET
  || crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

function signToken(expiresAt) {
  const hmac = crypto.createHmac('sha256', TOKEN_SECRET).update(String(expiresAt)).digest('hex');
  return Buffer.from(`${expiresAt}.${hmac}`).toString('base64url');
}

function verifyToken(token) {
  try {
    const [expiresAtStr, hmac] = Buffer.from(String(token), 'base64url').toString('utf8').split('.');
    const expiresAt = Number(expiresAtStr);
    if (!expiresAt || Date.now() > expiresAt) return false;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(String(expiresAt)).digest('hex');
    const a = Buffer.from(hmac || '');
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (err) {
    return false;
  }
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function requireAdminConfigured(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ ok: false, error: "Panneau admin non configuré (ADMIN_PASSWORD manquant)." });
  }
  next();
}

function requireAdminAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !verifyToken(token)) {
    return res.status(401).json({ ok: false, error: 'Session admin invalide ou expirée.' });
  }
  next();
}

const DOWNLOADABLE_EXT = { '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.csv': 'text/csv' };
// Internal-only files never exposed through the admin panel (diagnostic round-trip key).
const HIDDEN_NAMES = new Set(['_diagnostic-test.txt']);

app.post('/api/admin/login', requireAdminConfigured, (req, res) => {
  const password = (req.body || {}).password || '';
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' });
  }
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  res.json({ ok: true, token: signToken(expiresAt), expiresAt });
});

app.get('/api/admin/files', requireAdminConfigured, requireAdminAuth, async (req, res) => {
  try {
    let files;
    if (blobStore.USE_BLOB) {
      const blobs = await blobStore.listBlobs('data/');
      files = blobs
        .map((b) => ({ name: b.pathname.replace(/^data\//, ''), size: b.size, updatedAt: b.uploadedAt }))
        .filter((f) => !HIDDEN_NAMES.has(f.name));
    } else {
      const fs = require('fs');
      files = fs.existsSync(DATA_DIR)
        ? fs.readdirSync(DATA_DIR)
          .filter((name) => !HIDDEN_NAMES.has(name))
          .map((name) => {
            const stat = fs.statSync(path.join(DATA_DIR, name));
            return { name, size: stat.size, updatedAt: stat.mtime.toISOString() };
          })
        : [];
    }
    files = files.filter((f) => DOWNLOADABLE_EXT[path.extname(f.name)]);
    files.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ ok: true, files });
  } catch (err) {
    console.error('admin files list failed', err);
    res.status(500).json({ ok: false, error: 'Impossible de lister les fichiers.' });
  }
});

app.get('/api/admin/download/:name', requireAdminConfigured, requireAdminAuth, async (req, res) => {
  const name = req.params.name;
  // Reject anything but a bare filename (no path traversal) with an allowed extension.
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..') || !DOWNLOADABLE_EXT[path.extname(name)]) {
    return res.status(400).json({ ok: false, error: 'Nom de fichier invalide.' });
  }
  try {
    let content;
    if (blobStore.USE_BLOB) {
      content = await blobStore.readBlob(`data/${name}`);
    } else {
      const fs = require('fs');
      const filePath = path.join(DATA_DIR, name);
      content = fs.existsSync(filePath) ? await fs.promises.readFile(filePath) : null;
    }
    if (!content) return res.status(404).json({ ok: false, error: 'Fichier introuvable.' });
    res.setHeader('Content-Type', DOWNLOADABLE_EXT[path.extname(name)]);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(content);
  } catch (err) {
    console.error('admin download failed', err);
    res.status(500).json({ ok: false, error: 'Téléchargement impossible.' });
  }
});

// Only bind a port when run directly (`node server.js` / `npm start`), e.g.
// for local development. On Vercel this file is required as a module by
// api/index.js and exported below instead — the platform's own Node.js
// runtime handles incoming requests, so there is no port to listen on.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Fun4Kids site running at http://localhost:${PORT}`);
  });
}

module.exports = app;
