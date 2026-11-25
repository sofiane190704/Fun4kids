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

const BENEFICIARY = process.env.PAYMENT_BENEFICIARY || 'Fun4Kids ASBL';
const BIC = (process.env.PAYMENT_BIC || '').replace(/\s+/g, '').toUpperCase();

// Longueur IBAN attendue pour quelques pays courants (ISO 13616). Sert
// uniquement de garde-fou supplémentaire — la vraie validation est la clé
// de contrôle modulo 97 ci-dessous, qui marche pour n'importe quel pays.
const IBAN_LENGTH_BY_COUNTRY = { BE: 16, FR: 27, NL: 18, DE: 22, LU: 20 };

/** Validation de forme + clé de contrôle (norme ISO 7064 MOD 97-10) d'un
 *  IBAN. Ne révèle jamais l'IBAN lui-même à l'appelant : renvoie seulement
 *  un booléen. */
function isValidIban(iban) {
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const country = iban.slice(0, 2);
  const expectedLength = IBAN_LENGTH_BY_COUNTRY[country];
  if (expectedLength && iban.length !== expectedLength) return false;
  // Déplace les 4 premiers caractères à la fin, puis convertit chaque
  // lettre en nombre (A=10 … Z=35) avant de calculer le modulo 97.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  try {
    return BigInt(numeric) % 97n === 1n;
  } catch (err) {
    return false; // ne devrait pas arriver vu la regex ci-dessus, mais jamais planter sur un IBAN malformé
  }
}

const IBAN_RAW = (process.env.PAYMENT_IBAN || '').replace(/\s+/g, '').toUpperCase();
let IBAN = IBAN_RAW;
if (IBAN_RAW && !isValidIban(IBAN_RAW)) {
  console.warn('[payment] PAYMENT_IBAN est défini mais invalide (format ou clé de contrôle modulo 97 incorrecte) — paiement par virement désactivé. Vérifiez la valeur dans les Environment Variables Vercel.');
  IBAN = '';
}

// Le navigateur envoie aussi `montant`/`montant_note` (texte affiché dans le
// récapitulatif avant même la réponse du serveur), mais ces champs ne sont
// JAMAIS lus ici : le montant réel est systématiquement recalculé côté
// serveur à partir des champs structurels de l'activité (catégorie,
// formule, nombre d'enfants…). On les retire explicitement du payload avant
// tout calcul, pour qu'un futur champ du même nom ne puisse pas s'y glisser
// par erreur.
const CLIENT_ONLY_FIELDS = ['montant', 'montant_note'];

/** Montant en centimes, même grille que public/js/inscription.js.
 *  Renvoie null quand le prix n'est pas fixe (séances spécifiques/gardien). */
function computeAmountCents(activity, rawData) {
  const data = { ...rawData };
  for (const field of CLIENT_ONLY_FIELDS) delete data[field];

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

module.exports = { buildPayment, paymentCell, computeAmountCents, generateStructuredRef, epcPayload, isValidIban };
