// Fun4Kids — 3-step inscription flow (activity -> form -> recap/submit -> confirmation).
// Mirrors the pricing/recap logic from the original design, submits to
// POST /api/inscription which appends a row to a per-activity CSV file.
(function () {
  const LABELS = { academie: 'Académie de futsal', anniv: 'Anniversaire', stage: 'Stage', sejour: 'Séjour sportif' };
  const SEMAINE_PARAM_MAP = {
    'halloween-1': 'Halloween approche ! — 19 au 23 octobre',
    'halloween-2': 'Halloween, la suite ! — 26 au 30 octobre',
    'noel': 'Semaine givrée — 22 au 24 décembre',
  };
  // Reverse of the map above — used to derive a stable filename slug
  // (data/stage-<slug>.xlsx) from the select's display label, so the
  // per-week workbook survives the wording changing slightly later.
  const STAGE_WEEK_SLUGS = Object.fromEntries(
    Object.entries(SEMAINE_PARAM_MAP).map(([slug, label]) => [label, slug])
  );

  let state = { step: 1, activity: null };

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('inscription-form');
    const sendBtn = document.getElementById('send-request');
    const restartBtn = document.getElementById('restart');

    document.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => pick(btn.getAttribute('data-pick')));
    });
    document.querySelectorAll('[data-go]').forEach((btn) => {
      btn.addEventListener('click', () => goToStep(parseInt(btn.getAttribute('data-go'), 10)));
    });

    const academieFormule = form.querySelector('[data-academie-formule]');
    if (academieFormule) {
      academieFormule.addEventListener('change', updateAcademieJourVisibility);
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      goToStep(3);
      fillRecap();
    });

    sendBtn.addEventListener('click', submitInscription);
    restartBtn.addEventListener('click', () => {
      form.reset();
      state = { step: 1, activity: null };
      document.querySelectorAll('[data-fields]').forEach((el) => (el.style.display = 'none'));
      goToStep(1);
    });

    // Deep-link: /inscription.html?activite=stage&semaine=halloween-1
    const params = new URLSearchParams(window.location.search);
    const activite = params.get('activite');
    if (activite && LABELS[activite]) {
      pick(activite);
      const semaine = params.get('semaine');
      if (activite === 'stage' && semaine && SEMAINE_PARAM_MAP[semaine]) {
        const sel = form.querySelector('[name="stage_semaine"]');
        if (sel) sel.value = SEMAINE_PARAM_MAP[semaine];
      }
    }
  });

  function pick(activity) {
    state.activity = activity;
    showFieldsFor(activity);
    updateActivityBadge(activity);
    goToStep(2);
  }

  function showFieldsFor(activity) {
    document.querySelectorAll('[data-fields]').forEach((el) => (el.style.display = 'none'));
    document.querySelectorAll(`[data-fields="${activity}"]`).forEach((el) => (el.style.display = 'flex'));
    const isChild = activity === 'academie' || activity === 'stage' || activity === 'sejour';
    document.querySelectorAll('[data-fields="child"]').forEach((el) => (el.style.display = isChild ? 'flex' : 'none'));
    const childTitle = document.querySelector('[data-child-title]');
    if (childTitle) {
      childTitle.textContent = activity === 'sejour' ? 'Le jeune participant (10 – 17 ans)' : "Informations de l'enfant";
    }
    if (activity === 'academie') updateAcademieJourVisibility();
  }

  function updateAcademieJourVisibility() {
    const form = document.getElementById('inscription-form');
    const formule = form.querySelector('[name="academie_formule"]').value;
    const jourField = form.querySelector('[data-academie-jour]');
    if (jourField) jourField.style.display = /^2 /.test(formule) ? 'none' : 'flex';
  }

  function updateActivityBadge(activity) {
    const badge = document.querySelector('[data-activity-badge]');
    if (badge) badge.textContent = LABELS[activity] || '';
  }

  function goToStep(step) {
    state.step = step;
    document.querySelectorAll('[data-step]').forEach((el) => {
      const match = el.getAttribute('data-step') === String(step);
      el.style.display = match ? '' : 'none';
    });
    document.querySelectorAll('[data-step-indicator]').forEach((el) => {
      const n = parseInt(el.getAttribute('data-step-indicator'), 10);
      el.classList.toggle('is-active', n === step);
      el.classList.toggle('is-done', n < step);
    });
    const fill = document.querySelector('[data-stepper-fill]');
    if (fill) fill.style.width = step === 1 ? '33%' : step === 2 ? '66%' : '100%';
    window.scrollTo(0, 0);
  }

  function getFormData() {
    const form = document.getElementById('inscription-form');
    return Object.fromEntries(new FormData(form).entries());
  }

  function computePrice(activity, data) {
    if (activity === 'academie') {
      const cat = data.academie_categorie || '';
      const formule = data.academie_formule || '';
      if (/spécifique|gardien/i.test(cat)) return { price: 'dès 10 €', note: 'par séance réservée' };
      if (/^2 /.test(formule)) return { price: '390 €', note: '2 séances / semaine — saison complète' };
      return { price: '290 €', note: '1 séance / semaine — saison complète' };
    }
    if (activity === 'anniv') {
      const n = parseInt(data.anniv_count, 10);
      if (n && n >= 10) return { price: (n * 14) + ' €', note: n + ' enfants × 14 €' };
      return { price: '140 €', note: '10 enfants minimum × 14 €' };
    }
    if (activity === 'stage') {
      return /6 – 12/.test(data.stage_age || '') ? { price: '100 €', note: '6 – 12 ans, garderie incluse' } : { price: '85 €', note: '2,5 – 5 ans, garderie incluse' };
    }
    if (activity === 'sejour') return { price: '750 €', note: 'transport et pension complète inclus' };
    return { price: '—', note: '' };
  }

  function recapOption(activity, data) {
    if (activity === 'anniv') {
      const formule = data.anniv_formule || '—';
      return data.anniv_date ? formule + ' · ' + data.anniv_date : formule;
    }
    if (activity === 'academie') {
      const cat = data.academie_categorie || '—';
      const formule = data.academie_formule || '';
      const jour = /^2 /.test(formule) ? '' : ' · ' + (data.academie_jour || '');
      return cat + ' · ' + formule + jour;
    }
    if (activity === 'stage') return data.stage_semaine || '—';
    if (activity === 'sejour') return data.sejour_session || '—';
    return '—';
  }

  function childFullName(data) {
    return [data.child_prenom, data.child_nom].filter(Boolean).join(' ');
  }

  function recapParticipant(activity, data) {
    const name = childFullName(data);
    if (name) return name;
    if (activity === 'anniv') return data.anniv_count ? data.anniv_count + ' enfants' : 'À préciser';
    return 'À préciser';
  }

  function fillRecap() {
    const data = getFormData();
    const activity = state.activity;
    const p = computePrice(activity, data);
    setText('[data-recap="activite"]', LABELS[activity] || '—');
    setText('[data-recap="option"]', recapOption(activity, data));
    setText('[data-recap="participant"]', recapParticipant(activity, data));
    setText('[data-recap="responsable"]', data.parent_nom || 'À préciser');
    setText('[data-recap="price"]', p.price);
    setText('[data-recap="price-note"]', p.note);
  }

  function setText(sel, text) {
    const el = document.querySelector(sel);
    if (el) el.textContent = text;
  }

  async function submitInscription() {
    const data = getFormData();
    const activity = state.activity;
    const p = computePrice(activity, data);
    const status = document.getElementById('inscription-status');
    const btn = document.getElementById('send-request');

    setStatus(status, '', false, false);
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Envoi…';

    const payload = Object.assign({}, data, {
      activite: activity,
      activite_label: LABELS[activity],
      recap_option: recapOption(activity, data),
      recap_participant: recapParticipant(activity, data),
      montant: p.price,
      montant_note: p.note,
    });
    if (activity === 'stage') {
      payload.stage_semaine_label = data.stage_semaine;
      payload.stage_semaine_slug = STAGE_WEEK_SLUGS[data.stage_semaine] || null;
    }

    try {
      const res = await fetch('/api/inscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('request failed');

      setText('[data-done="email"]', data.parent_email || 'vous');
      setText('[data-done="activite"]', LABELS[activity] || '—');
      setText('[data-done="option"]', recapOption(activity, data));
      setText('[data-done="price"]', p.price);
      goToStep('done');
    } catch (err) {
      setStatus(status, "Une erreur est survenue lors de l'envoi. Réessayez, ou appelez-nous au 0477 / 99.58.33.", false, true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function setStatus(el, text, ok, visible) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-success', ok);
    el.classList.toggle('is-error', !ok && visible);
    el.classList.toggle('is-visible', visible);
  }
})();
