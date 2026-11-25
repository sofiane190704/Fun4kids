# Fun4Kids ASBL — site

Implementation of the 7-page Fun4Kids design (Accueil, Académie, Anniversaires,
Stages, Séjour, Contact, Inscription), built from the Claude Design handoff in
`../project/` and `../chats/chat1.md`.

## Stack

Plain static HTML/CSS/JS (`public/`), served by a small Express server
(`server.js`) that also exposes the POST endpoints so every form can save
submissions — **each form gets its own `.xlsx` workbook** under `data/`:
- contact messages → `data/contact.xlsx`
- inscriptions → one printable **Excel listing per activity** under `data/`
  (see below): `academie.xlsx`, `anniversaires.xlsx`, `sejour.xlsx`, and one
  `stage-<semaine>.xlsx` per stage week.

A small password-protected **admin panel** (`public/admin.html` +
`/api/admin/*`) lets the ASBL team list and download all of these at any
time — see "Récupérer les fichiers" below.

```
site/
├── server.js            # static file server + /api/contact, /api/inscription, /api/admin/*
├── lib/csv.js            # tiny dependency-free CSV append helper (audit log only)
├── lib/xlsx.js            # builds/updates every .xlsx workbook (exceljs) — contact + rosters
├── data/                 # *.csv / *.xlsx submissions land here (git-ignored)
└── public/
    ├── index.html         academie.html   anniversaires.html
    ├── stages.html        sejour.html     contact.html
    ├── inscription.html   admin.html      # password-gated file listing/download
    ├── css/style.css      # shared design system (colors, buttons, cards, forms…)
    ├── js/main.js         # mobile nav + FAQ accordions
    ├── js/consent.js      # cookie consent banner + Google Analytics loader
    ├── js/forms.js        # contact form -> POST /api/contact
    ├── js/inscription.js  # 3-step inscription flow -> POST /api/inscription
    └── images/            # real photos, extracted from the design's image-slots
```

## Run it

```bash
cd site
npm install
npm start
# -> http://localhost:3000
```

## Deploy on Vercel

The site is deployed via `vercel.json` (routes every request through
`api/index.js`, which just re-exports the Express app from `server.js`).

**One manual step is required after the first deploy**, because Vercel's
serverless functions have no writable disk that survives between requests:
`data/*.csv` and `data/*.xlsx` are stored in **Vercel Blob** (private access)
instead of on disk when running on Vercel — see `lib/blobStore.js`. Locally
(`npm start`), nothing changes: it still writes to `site/data/` on disk.

To enable it in production:
1. In the Vercel dashboard, open the project → **Storage** tab → **Create
   Database** → **Blob** (or `vercel blob create-store` via the CLI), and
   connect it to this project (make sure **Production** is checked, not just
   Preview). That step alone sets an env var Vercel injects automatically —
   no code change needed. Newer stores connect via OIDC and expose
   `BLOB_STORE_ID` (no visible token — auth happens through Vercel's own
   `VERCEL_OIDC_TOKEN`, injected automatically at runtime); older/manually
   created stores instead expose a static `BLOB_READ_WRITE_TOKEN`.
   `lib/blobStore.js` checks for either.
2. Redeploy (or just wait for the next request) — `lib/blobStore.js` picks
   up whichever env var is present and switches from disk to Blob
   automatically. You can confirm it worked by hitting
   `GET /api/_storage-mode` on the live site — it returns
   `{"storage":"vercel-blob"}` once this is wired up correctly, or
   `{"storage":"local-disk"}` if it isn't yet.
3. To read submissions afterwards, use the **admin panel** (recommended —
   see below), or `vercel blob list` / `vercel blob get data/contact.xlsx
   --output contact.xlsx` (repeat per file), or fetch them programmatically
   with `@vercel/blob`'s `list()`/`get()`.

Until step 1 is done (and confirmed via `/api/_storage-mode`), `/api/contact`
and `/api/inscription` will still respond `200 OK` but their writes are
effectively lost on redeploy/cold start — do this before sharing the live
URL with real families.

**Known limitation:** Blob mode reads the whole file, appends the new row in
memory, and re-uploads the whole file (`allowOverwrite: true`) — there's no
locking. Two submissions landing in the exact same instant could in theory
clobber each other. Fine for Fun4Kids' actual volume; revisit with a real
database if submissions ever get busy enough for that to matter.

## Récupérer les fichiers (admin panel)

Go to `/admin.html` on the live site and log in with `ADMIN_PASSWORD` (set
below) to list and download every submission file as `.xlsx`/`.csv` —
`contact.xlsx`, `academie.xlsx`, `anniversaires.xlsx`, `sejour.xlsx`, every
`stage-<semaine>.xlsx`, and `inscriptions-log.csv` (the full audit trail).

**Setup (one-time):** in the Vercel dashboard, project → **Settings** →
**Environment Variables**, add `ADMIN_PASSWORD` (Production, and Preview if
you want to test there too) with a strong password, then redeploy. Until
this is set, `/admin.html` and every `/api/admin/*` route respond with a
"not configured" error rather than falling back to a default password.

How it works: `/admin.html` posts the password to `/api/admin/login`, which
returns a signed, time-limited (12h) session token — kept in the browser's
`sessionStorage` only (cleared on tab close), never written to disk or
logged. All list/download calls send it as a `Bearer` token. No plaintext
password or token is ever stored server-side beyond the env var itself.

## What's wired up

- **Contact form** (`contact.html`) posts to `/api/contact`, which appends a
  row to `data/contact.xlsx` (date, nom, email, sujet, message).
- **Inscription flow** (`inscription.html`) is a 3-step client-side flow
  (activity → per-activity form → recap & submit → confirmation), mirroring
  the pricing/recap logic from the original design. On submit it posts to
  `/api/inscription`, which appends a row to a printable Excel listing —
  formatted to match the ASBL's existing paper listings (title row, bold
  header row, borders):
  - `stage-<semaine>.xlsx` — **one workbook per stage week** (e.g.
    `stage-halloween-1.xlsx`), columns `N° · NOM · PRENOM · AGE · GSM · MAIL
    · PAIEMENT · L · M · M · J · V · ANIMATEUR`. PAIEMENT, the daily
    attendance columns and ANIMATEUR are left blank for staff to fill in by
    hand and print.
  - `academie.xlsx` — running roster, `N° · NOM · PRENOM · AGE · GSM · MAIL
    · CATEGORIE · FORMULE · JOUR · PAIEMENT`.
  - `anniversaires.xlsx` — running list, `N° · RESPONSABLE · GSM · MAIL ·
    DATE FÊTE · NB ENFANTS · FORMULE · THÈME · PAIEMENT`.
  - `sejour.xlsx` — running roster, `N° · NOM · PRENOM · AGE · GSM · MAIL ·
    CONTACT URGENCE · TEL URGENCE · PAIEMENT`.

  AGE is computed from the child's date of birth (nearest half-year, e.g.
  `2.5`), matching how the ASBL already writes ages by hand. PAIEMENT is
  always left blank — no payment is collected online (see below).

  Every submission is **also** logged in full to `data/inscriptions-log.csv`
  (timestamp, activity, raw JSON payload) — this is the only place fields
  that don't belong on a printable roster end up, notably the "informations
  utiles à l'encadrement" (allergies / medical notes) field.
- Activity/CTA links across pages deep-link into the inscription flow, e.g.
  `inscription.html?activite=stage&semaine=halloween-1` pre-selects the
  activity (and week, for stages).

## Notification par e-mail à l'ASBL (nouvelle inscription / contact)

À chaque inscription et à chaque message de contact, un e-mail récapitulatif
est envoyé à l'ASBL (`lib/mail.js`), via l'API HTTP de
[Resend](https://resend.com) — pas de SDK, un simple `fetch`. L'e-mail
contient les informations utiles pour réagir vite (activité, enfant,
coordonnées du responsable, montant/référence de paiement le cas échéant)
mais **jamais** les informations médicales (`notes_medicales`) : comme pour
le listing Excel imprimable, celles-ci restent uniquement dans le panneau
admin protégé par mot de passe.

**À configurer une fois** (Vercel → Settings → Environment Variables,
Production **et** Preview) puis redéployer :
- `RESEND_API_KEY` — clé API d'un compte [resend.com](https://resend.com)
  (gratuit jusqu'à 3000 e-mails/mois). Obligatoire ; sans elle, aucun
  e-mail n'est envoyé, silencieusement — rien n'est bloqué pour autant.
- `MAIL_TO` — l'adresse de l'ASBL qui doit recevoir ces notifications
  (ex. `info@fun4kidsasbl.be`). Obligatoire elle aussi.
- `MAIL_FROM` — optionnel, par défaut `Fun4Kids <onboarding@resend.dev>`.
  Cette adresse de test Resend ne peut envoyer qu'**à l'adresse du compte
  Resend lui-même** tant qu'aucun domaine n'est vérifié. Pour envoyer
  depuis une adresse `@funforkidsasbl.com` vers n'importe quelle boîte
  (notamment `info@fun4kidsasbl.be`), vérifiez le domaine dans
  Resend → Domains (ajout de quelques enregistrements DNS chez votre
  registrar), puis réglez `MAIL_FROM` sur, par exemple,
  `Fun4Kids <inscriptions@funforkidsasbl.com>`.

Un échec d'envoi (clé invalide, Resend indisponible, domaine non
vérifié...) est uniquement loggé côté serveur — l'inscription ou le
message, eux, sont déjà enregistrés avant que l'e-mail ne soit tenté et ne
sont jamais perdus.

**Toujours pas prévu** : un e-mail de confirmation envoyé *au parent* avec
les informations bancaires, comme le suggère le texte initial du design.
C'est une fonctionnalité séparée (et plus sensible, puisqu'elle écrirait à
des familles) — la confirmation à l'écran reste donc le seul retour
immédiat pour le parent ; c'est l'ASBL qui est notifiée ici.

## Paiement par virement (QR code)

À la fin de l'inscription, l'écran de confirmation affiche le bénéficiaire,
l'IBAN, le montant, une **référence de paiement lisible**
(`++NOM PRENOM-ACTIVITE++`, à partir du nom de l'enfant — du responsable
pour un anniversaire, où aucun enfant n'est identifié individuellement) et
un **QR code de paiement EPC/SEPA** : le parent le scanne avec son app
bancaire (KBC, Belfius, BNP, ING…), montant et référence sont pré-remplis.
Le montant est recalculé côté serveur (`lib/payment.js`), avec la même
grille que le site.

Ce format a été préféré à la communication structurée belge classique
(`+++xxx/xxxx/xxxxx+++`, contrôle modulo 97) pour rester simple à
reconnaître à l'œil sur un extrait de compte — au prix d'une absence de
garantie d'unicité : deux inscriptions pour le même enfant à la même
activité partageront la même référence (voir `lib/payment.js` pour le
détail de ce choix).

La colonne PAIEMENT des listings Excel est pré-remplie avec
`À recevoir <montant> · <communication>` : il suffit de chercher la
communication sur l'extrait de compte et de cocher « payé ».

**À configurer une fois** (Vercel → Settings → Environment Variables,
Production) puis redéployer :
- `PAYMENT_IBAN` — IBAN de l'ASBL (obligatoire ; sans lui, le bloc paiement
  ne s'affiche pas et l'ancien message reste en place). Vérifié au
  démarrage (format + clé de contrôle modulo 97) : si la valeur est
  invalide, le paiement est désactivé automatiquement et un avertissement
  clair est écrit dans les logs serveur — sans jamais y afficher l'IBAN.
- `PAYMENT_BENEFICIARY` — optionnel, par défaut `Fun4Kids ASBL`
- `PAYMENT_BIC` — optionnel

Les séances spécifiques / gardien de l'Académie n'ont pas de prix fixe :
la communication est affichée, sans montant ni QR code.

L'inscription envoie aussi un événement Google Analytics `generate_lead`
(activité + montant), uniquement si le visiteur a accepté les cookies.

## Images

All photos on the site were extracted from the design's
`.image-slots.state.json` (the real photos the user dropped into the
Claude Design canvas) — see `public/images/`. Two spots in the original
design have no photo at all (Contact and Inscription are text/icon-only
by design), so nothing was invented there.

The three `uploads/IMG_8172-8174.JPG` files from the handoff bundle were
**not** used — they turned out to be screenshots of unrelated websites the
user referenced as style inspiration (per the first chat message), not
photos of Fun4Kids activities.
