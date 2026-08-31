// Shared behavior across all pages: mobile nav toggle + FAQ accordions.
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    initNavToggle();
    initAccordions();
  });

  function initNavToggle() {
    const toggle = document.querySelector('[data-nav-toggle]');
    const bar = document.querySelector('.site-header__bar');
    if (!toggle || !bar) return;
    toggle.addEventListener('click', () => {
      const open = bar.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    bar.querySelectorAll('.site-nav a').forEach((a) => {
      a.addEventListener('click', () => bar.classList.remove('is-open'));
    });
  }

  function initAccordions() {
    document.querySelectorAll('[data-accordion] .faq-item__q').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        const group = btn.closest('[data-accordion]');
        const wasOpen = item.classList.contains('is-open');
        group.querySelectorAll('.faq-item.is-open').forEach((el) => el.classList.remove('is-open'));
        if (!wasOpen) item.classList.add('is-open');
      });
    });
  }
})();
