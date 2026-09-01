# Fun4Kids ASBL — site

Implementation of the 7-page Fun4Kids design (Accueil, Académie, Anniversaires,
Stages, Séjour, Contact, Inscription), built from the Claude Design handoff in
`../project/` and `../chats/chat1.md`.

## Stack

Plain static HTML/CSS/JS (`public/`), served by a small Express server
(`server.js`) that also exposes two POST endpoints so the contact form and
the inscription flow can save submissions:
- contact messages → `data/contact.csv`
- inscriptions → printable **Excel listings** under `data/` (see below)

```
site/
├── server.js            # static file server + /api/contact, /api/inscription
├── lib/csv.js            # tiny dependency-free CSV append helper (contact + audit log)
├── lib/xlsx.js            # builds/updates the printable inscription workbooks (exceljs)
├── data/                 # *.csv / *.xlsx submissions land here (git-ignored)
└── public/
    ├── index.html         academie.html   anniversaires.html
    ├── stages.html        sejour.html     contact.html
    ├── inscription.html
    ├── css/style.css      # shared design system (colors, buttons, cards, forms…)
    ├── js/main.js         # mobile nav + FAQ accordions
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
3. To read submissions afterwards: `vercel blob list` / `vercel blob get
   data/contact.csv --output contact.csv` (repeat for the `.xlsx` rosters),
   or fetch them programmatically with `@vercel/blob`'s `list()`/`get()`.

Until step 1 is done (and confirmed via `/api/_storage-mode`), `/api/contact`
and `/api/inscription` will still respond `200 OK` but their writes are
effectively lost on redeploy/cold start — do this before sharing the live
URL with real families.

**Known limitation:** Blob mode reads the whole file, appends the new row in
memory, and re-uploads the whole file (`allowOverwrite: true`) — there's no
locking. Two submissions landing in the exact same instant could in theory
clobber each other. Fine for Fun4Kids' actual volume; revisit with a real
database if submissions ever get busy enough for that to matter.

## What's wired up

- **Contact form** (`contact.html`) posts to `/api/contact`, which appends a
  row to `data/contact.csv` (timestamp, nom, email, sujet, message).
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

## Deliberately **not** wired up: outbound e-mail

The design's copy promises an automatic confirmation e-mail (with bank
transfer details) as soon as a request is submitted. No mail service or
credentials were provided, so this build does **not** send real e-mails —
it only records submissions to the CSV files above, and the confirmation
screen text was adjusted to say the Fun4Kids team will follow up, rather
than falsely claiming an e-mail was already sent. Wiring up an actual
mail step (SMTP, or a transactional-email provider) is a follow-up task
once credentials/a provider are chosen.

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
