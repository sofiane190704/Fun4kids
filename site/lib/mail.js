// Notifie l'ASBL par e-mail à chaque nouvelle inscription et à chaque
// message du formulaire de contact, via l'API HTTP de Resend
// (https://resend.com) — un simple fetch, pas de SDK.
//
// Configuration (Vercel → Settings → Environment Variables) :
//  - RESEND_API_KEY — obligatoire ; sans elle, aucun e-mail n'est envoyé.
//  - MAIL_TO — adresse de l'ASBL qui reçoit les notifications ; obligatoire
//    elle aussi (une clé API seule ne suffit pas).
//  - MAIL_FROM — optionnel, par défaut 'Fun4Kids <onboarding@resend.dev>'.
//    Cette adresse par défaut ne peut envoyer qu'à l'adresse du compte
//    Resend tant qu'aucun domaine n'est vérifié — voir README pour
//    envoyer depuis une adresse @funforkidsasbl.com.
//
// Tant que RESEND_API_KEY ou MAIL_TO manque, les fonctions ci-dessous ne
// font rien, silencieusement. Un échec d'envoi (clé invalide, Resend
// indisponible, domaine non vérifié...) est seulement loggé côté serveur :
// il n'interrompt JAMAIS une inscription ou un message de contact, qui sont
// déjà enregistrés avant que l'e-mail ne soit tenté.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Fun4Kids <onboarding@resend.dev>';
const MAIL_TO = process.env.MAIL_TO || '';

const ACTIVITY_LABELS = {
  academie: 'Académie de futsal',
  anniv: 'Anniversaire',
  stage: 'Stage',
  sejour: 'Séjour sportif',
};

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** Paires [libellé, valeur] à afficher dans l'e-mail, propres à chaque
 *  activité. Les informations médicales (notes_medicales) sont
 *  délibérément exclues — comme pour le listing Excel imprimable (voir
 *  lib/xlsx.js), l'e-mail n'est qu'une notification rapide, pas l'endroit
 *  où faire circuler une donnée sensible ; le détail complet reste dans le
 *  panneau admin protégé par mot de passe. */
function inscriptionSummaryRows(activite, data) {
  const rows = [];
  const child = [data.child_prenom, data.child_nom].filter(Boolean).join(' ');
  if (child) rows.push(['Enfant', child]);
  rows.push(['Responsable', data.parent_nom || '—']);
  rows.push(['Téléphone', data.parent_tel || '—']);
  rows.push(['E-mail', data.parent_email || '—']);
  if (activite === 'academie') {
    rows.push(['Catégorie', data.academie_categorie || '—']);
    rows.push(['Formule', data.academie_formule || '—']);
    if (data.academie_jour) rows.push(['Jour', data.academie_jour]);
  }
  if (activite === 'anniv') {
    rows.push(['Date', data.anniv_date || '—']);
    rows.push(["Nombre d'enfants", data.anniv_count || '—']);
    rows.push(['Formule', data.anniv_formule || '—']);
  }
  if (activite === 'stage') {
    rows.push(['Semaine', data.stage_semaine || '—']);
    rows.push(["Tranche d'âge", data.stage_age || '—']);
  }
  if (activite === 'sejour') {
    rows.push(['Session', data.sejour_session || '—']);
  }
  return rows;
}

async function sendEmail(subject, html) {
  if (!RESEND_API_KEY || !MAIL_TO) return; // pas configuré -> silencieux
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: MAIL_FROM, to: [MAIL_TO], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[mail] envoi échoué', res.status, body);
    }
  } catch (err) {
    console.error('[mail] envoi échoué', (err && err.message) || err);
  }
}

function wrapEmail(title, bodyHtml) {
  return `<div style="font-family:Arial,sans-serif;color:#2E2A27;max-width:560px">
    <h2 style="color:#F26E38;margin:0 0 16px">${escapeHtml(title)}</h2>
    ${bodyHtml}
  </div>`;
}

async function notifyInscription(activite, data, payment) {
  const label = ACTIVITY_LABELS[activite] || activite;
  const rows = inscriptionSummaryRows(activite, data)
    .map(([k, v]) => `<tr><td style="padding:3px 14px 3px 0;color:#8A807A;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:3px 0;font-weight:700">${escapeHtml(v)}</td></tr>`)
    .join('');
  const paymentLine = payment
    ? `<p style="margin:16px 0 0">Paiement : <strong>${escapeHtml(payment.amount || 'montant variable')}</strong> — référence ${escapeHtml(payment.reference)}</p>`
    : '';
  const html = wrapEmail(`Nouvelle inscription — ${label}`, `
    <table style="border-collapse:collapse">${rows}</table>
    ${paymentLine}
    <p style="margin-top:20px;font-size:13px;color:#8A807A">Détail complet (dont les éventuelles informations médicales) dans le panneau admin du site.</p>
  `);
  await sendEmail(`Nouvelle inscription — ${label}`, html);
}

async function notifyContact(data) {
  const html = wrapEmail('Nouveau message de contact', `
    <p><strong>${escapeHtml(data.nom)}</strong> — ${escapeHtml(data.email)}</p>
    <p><strong>Sujet :</strong> ${escapeHtml(data.sujet || '—')}</p>
    <p style="white-space:pre-wrap;background:#FFF3EC;border-radius:12px;padding:14px">${escapeHtml(data.message)}</p>
  `);
  await sendEmail(`Nouveau message de contact${data.sujet ? ' — ' + data.sujet : ''}`, html);
}

module.exports = { notifyInscription, notifyContact };
