// Paiement par virement : montant calculé côté serveur, communication
// structurée belge (+++123/4567/89012+++) unique par inscription et QR code
// EPC (« QR de paiement SEPA ») que le parent scanne avec son app bancaire.
//
// L'IBAN n'est jamais écrit dans le code : il est lu dans la variable
// d'environnement PAYMENT_IBAN (Vercel → Settings → Environment Variables).
// Tant qu'elle n'est pas définie, buildPayment() renvoie null et le site
// garde l'ancien message (« l'équipe revient vers vous avec les infos
// bancaires »).

const crypto = require('crypto');
const QRCode = require('qrcode');

const IBAN = (process.env.PAYMENT_IBAN || '').replace(/\s+/g, '').toUpperCase();
const BENEFICIARY = process.env.PAYMENT_BENEFICIARY || 'Fun4Kids ASBL';
const BIC = (process.env.PAYMENT_BIC || '').replace(/\s+/g, '').toUpperCase();

/** Montant en centimes, même grille que public/js/inscription.js.
 *  Renvoie null quand le prix n'est pas fixe (séances spécifiques/gardien). */
function computeAmountCents(activity, data) {
  if (activity === 'academie') {
    const cat = data.academie_categorie || '';
    const formule = data.academie_formule || '';
    if (/spécifique|gardien/i.test(cat)) return null;
    return /^2 /.test(formule) ? 39000 : 29000;
  }
  if (activity === 'anniv') {
    const n = parseInt(data.anniv_count, 10);
    return (n && n >= 10 ? n : 10) * 1400;
  }
  if (activity === 'stage') return /6 – 12/.test(data.stage_age || '') ? 10000 : 8500;
  if (activity === 'sejour') return 75000;
  return null;
}

/** Communication structurée : 10 chiffres + 2 chiffres de contrôle (modulo 97). */
function generateStructuredRef() {
  const base = String(crypto.randomInt(0, 1e10)).padStart(10, '0');
  let check = Number(BigInt(base) % 97n);
  if (check === 0) check = 97;
  const digits = base + String(check).padStart(2, '0');
  return `+++${digits.slice(0, 3)}/${digits.slice(3, 7)}/${digits.slice(7)}+++`;
}

function formatEuros(cents) {
  return (cents / 100).toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
}

function formatIban(iban) {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

/** Contenu EPC069-12 (version 002, UTF-8). La communication structurée est
 *  placée dans le champ « texte libre », que les apps bancaires belges
 *  reconnaissent et reprennent telle quelle. */
function epcPayload(cents, ref) {
  return [
    'BCD', '002', '1', 'SCT',
    BIC,
    BENEFICIARY.slice(0, 70),
    IBAN,
    'EUR' + (cents / 100).toFixed(2),
    '', '',
    ref,
  ].join('\n');
}

async function buildPayment(activity, data) {
  if (!IBAN) return null;
  const cents = computeAmountCents(activity, data);
  const reference = generateStructuredRef();
  const payment = {
    beneficiary: BENEFICIARY,
    iban: formatIban(IBAN),
    reference,
    amountCents: cents,
    amount: cents == null ? null : formatEuros(cents),
    qr: null,
  };
  if (cents != null) {
    payment.qr = await QRCode.toDataURL(epcPayload(cents, reference), { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  }
  return payment;
}

/** Texte écrit dans la colonne PAIEMENT des listings Excel, pour que l'équipe
 *  retrouve facilement le virement sur l'extrait bancaire. */
function paymentCell(payment) {
  if (!payment) return '';
  return `À recevoir${payment.amount ? ' ' + payment.amount : ''} · ${payment.reference}`;
}

module.exports = { buildPayment, paymentCell, computeAmountCents, generateStructuredRef, epcPayload };
