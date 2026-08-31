// Contact form submission -> POST /api/contact (appended to data/contact.csv server-side).
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('contact-form');
    if (!form) return;
    const status = document.getElementById('contact-status');
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());

      setStatus('', false, false);
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = 'Envoi…';

      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('request failed');
        form.reset();
        setStatus("Message envoyé — merci, nous revenons vers vous très vite !", true, true);
      } catch (err) {
        setStatus("Une erreur est survenue. Réessayez, ou appelez-nous au 0477 / 99.58.33.", false, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });

    function setStatus(text, ok, visible) {
      status.textContent = text;
      status.classList.toggle('is-success', ok);
      status.classList.toggle('is-error', !ok && visible);
      status.classList.toggle('is-visible', visible);
    }
  });
})();
