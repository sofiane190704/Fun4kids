// Paiement par virement : montant calculé côté serveur, référence de
// paiement lisible (++NOM PRENOM-ACTIVITE++, à partir du nom de l'enfant)
// et QR code EPC (« QR de paiement SEPA ») que le parent scanne avec son
// app bancaire.
//
// Ce format a été choisi volontairement au détriment de la communication
// structurée belge classique (+++xxx/xxxx/xxxxx+++, contrôle modulo 97) :
// plus simple à reconnaître à l'œil sur un extrait de compte, mais SANS
// garantie d'unicité — deux inscriptions pour le même enfant à la même
// activité (ou deux enfants homonymes) partageront la même référence. Si ce
// cas se présente en pratique, l'équipe devra s'appuyer sur le montant et
// la date du virement en plus de la référence pour les distinguer.
//
// L'IBAN n'est jamais écrit dans le code : il est lu dans la variable
// d'environnement PAYMENT_IBAN (Vercel → Settings → Environment Variables).
// Tant qu'elle n'est pas définie, buildPayment() renvoie null et le site
// garde l'ancien message (« l'équipe revient vers vous avec les infos
// bancaires »).
//
// Tarif famille : -10% dès le 2e enfant d'un même responsable inscrit à
// l'académie ou à un stage (pas aux anniversaires, pas au séjour) — voir
// countPriorSiblings() plus bas pour comment c'est détecté.

const QRCode = require('qrcode');
const csv = require('./csv');

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

// Prix par semaine de stage (public/stages.html) — la "Semaine givrée" de
// Noël ne dure que 3 jours et coûte donc moins cher que les semaines de 5
// jours d'Halloween. Clé = stage_semaine_slug (voir
// public/js/inscription.js, même table). "default" sert de garde-fou si le
// slug est absent/inconnu (ne devrait pas arriver via le formulaire réel).
const STAGE_PRICES_CENTS = {
  'halloween-1': { young: 8500, old: 10000 },
  'halloween-2': { young: 8500, old: 10000 },
  noel: { young: 7500, old: 9000 },
  default: { young: 8500, old: 10000 },
};

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
  if (activity === 'stage') {
    const table = STAGE_PRICES_CENTS[data.stage_semaine_slug] || STAGE_PRICES_CENTS.default;
    return /6 – 12/.test(data.stage_age || '') ? table.old : table.young;
  }
  if (activity === 'sejour') return 75000;
  return null;
}

const ACTIVITY_LABELS = {
  academie: 'ACADEMIE',
  anniv: 'ANNIVERSAIRE',
  stage: 'STAGE',
  sejour: 'SEJOUR',
};

/** Majuscules, sans accents, sans ponctuation — pour rester simple à
 *  recopier à la main et sûr à placer dans le champ texte libre du QR. */
function sanitizeForReference(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim();
}

/** Référence lisible : ++NOM PRENOM-ACTIVITE++, construite à partir du nom
 *  de l'enfant (ou, pour l'anniversaire où il n'y a pas d'enfant identifié,
 *  du responsable). Voir la note d'en-tête de fichier sur l'absence de
 *  garantie d'unicité — choix assumé pour la simplicité. */
function generateReadableReference(activity, data) {
  const nom = sanitizeForReference(data.child_nom || data.parent_nom || '');
  const prenom = sanitizeForReference(data.child_prenom || '');
  const name = [nom, prenom].filter(Boolean).join(' ') || 'INSCRIPTION';
  const label = ACTIVITY_LABELS[activity] || sanitizeForReference(activity) || 'ACTIVITE';
  return `++${name}-${label}++`;
}

function formatEuros(cents) {
  return (cents / 100).toLocaleString('fr-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
}

function formatIban(iban) {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}

// Tarif famille : -10% dès le 2e enfant d'un même responsable (identifié par
// e-mail) inscrit à l'académie ou à un stage — pas aux anniversaires, pas au
// séjour (confirmé par l'ASBL). "2e enfant" est détecté en comptant, dans le
// journal d'audit (inscriptions-log.csv, qui contient déjà chaque inscription
// avec son e-mail de responsable), les soumissions passées pour la même
// activité et le même e-mail — peu importe la semaine de stage ou la
// formule. Un échec de cette vérification (ex. journal illisible) ne doit
// jamais bloquer une inscription : on applique alors le tarif plein, par
// défaut sûr.
const SIBLING_DISCOUNT_ACTIVITIES = new Set(['academie', 'stage']);
const SIBLING_DISCOUNT_RATE = 0.10;

async function countPriorSiblings(dataDir, activity, parentEmail) {
  const email = String(parentEmail || '').trim().toLowerCase();
  if (!email) return 0;
  try {
    return await csv.countRows(dataDir, 'inscriptions-log', (row) => {
      if (row.activite !== activity) return false;
      try {
        const payload = JSON.parse(row.payload);
        return String(payload.parent_email || '').trim().toLowerCase() === email;
      } catch (err) {
        return false;
      }
    });
  } catch (err) {
    console.error('[payment] vérification du tarif famille impossible, tarif plein appliqué', (err && err.message) || err);
    return 0;
  }
}

/** Contenu EPC069-12 (version 002, UTF-8). La référence est placée dans le
 *  champ « texte libre » (remittance information non structurée), que les
 *  apps bancaires belges reconnaissent et reprennent telle quelle. */
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

async function buildPayment(activity, data, dataDir) {
  if (!IBAN) return null;
  let cents = computeAmountCents(activity, data);
  let discountApplied = false;
  if (cents != null && SIBLING_DISCOUNT_ACTIVITIES.has(activity)) {
    const priorSiblings = await countPriorSiblings(dataDir, activity, data.parent_email);
    if (priorSiblings >= 1) {
      cents = Math.round(cents * (1 - SIBLING_DISCOUNT_RATE));
      discountApplied = true;
    }
  }
  const reference = generateReadableReference(activity, data);
  const payment = {
    beneficiary: BENEFICIARY,
    iban: formatIban(IBAN),
    reference,
    amountCents: cents,
    amount: cents == null ? null : formatEuros(cents),
    discountApplied,
    qr: null,
  };
  if (cents != null) {
    payment.qr = await QRCode.toDataURL(epcPayload(cents, reference), { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  }
  return payment;
}

/** Texte écrit dans la colonne PAIEMENT des listings Excel, pour que l'équipe
 *  retrouve facilement le virement sur l'extrait bancaire — et comprenne
 *  immédiatement pourquoi un montant est inférieur au tarif plein. */
function paymentCell(payment) {
  if (!payment) return '';
  const discountNote = payment.discountApplied ? ' (tarif famille -10 % appliqué)' : '';
  return `À recevoir${payment.amount ? ' ' + payment.amount : ''}${discountNote} · ${payment.reference}`;
}

module.exports = { buildPayment, paymentCell, computeAmountCents, generateReadableReference, epcPayload, isValidIban };
