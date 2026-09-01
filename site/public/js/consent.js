// Cookie consent + Google Analytics loader.
// GA (gtag.js) is only injected once the visitor accepts — nothing is loaded, no cookie is
// set, before that choice is made. The choice is remembered in localStorage.
(function () {
  var GA_ID = 'G-N60LY0V06L';
  var STORAGE_KEY = 'f4k_cookie_consent'; // 'granted' | 'denied'

  function getConsent() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(STORAGE_KEY, value); } catch (e) {}
  }

  function loadAnalytics() {
    if (window.__f4kGaLoaded) return;
    window.__f4kGaLoaded = true;

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
  }

  function injectStyles() {
    if (document.getElementById('cookie-banner-styles')) return;
    var style = document.createElement('style');
    style.id = 'cookie-banner-styles';
    style.textContent =
      '#cookie-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;' +
      'max-width:640px;margin:0 auto;background:#fff;border:1px solid var(--border,#F6E7DE);' +
      'border-radius:20px;box-shadow:0 12px 32px rgba(46,42,39,0.18);' +
      'padding:20px 22px;display:flex;flex-direction:column;gap:14px;' +
      'font-family:var(--font-body,system-ui,sans-serif);color:var(--ink,#2E2A27)}' +
      '#cookie-banner p{margin:0;font-size:14.5px;line-height:1.6;color:var(--ink-soft,#4A423D)}' +
      '#cookie-banner a{color:var(--orange,#F26E38);font-weight:700}' +
      '#cookie-banner .cb-actions{display:flex;gap:10px;flex-wrap:wrap}' +
      '#cookie-banner button{font-family:var(--font-title,system-ui,sans-serif);' +
      'font-size:14.5px;font-weight:700;border-radius:999px;padding:10px 20px;cursor:pointer;' +
      'border:2px solid transparent;transition:background .15s,color .15s,border-color .15s}' +
      '#cookie-banner .cb-accept{background:var(--orange,#F26E38);color:#fff}' +
      '#cookie-banner .cb-accept:hover{background:var(--orange-dark,#D9542A)}' +
      '#cookie-banner .cb-decline{background:#fff;color:var(--ink,#2E2A27);border-color:var(--border-strong,#F6DCCC)}' +
      '#cookie-banner .cb-decline:hover{border-color:var(--orange,#F26E38);color:var(--orange,#F26E38)}';
    document.head.appendChild(style);
  }

  function showBanner() {
    injectStyles();
    if (document.getElementById('cookie-banner')) return;

    var el = document.createElement('div');
    el.id = 'cookie-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Consentement aux cookies');
    el.innerHTML =
      '<p>Nous utilisons des cookies de mesure d’audience (Google Analytics) pour comprendre ' +
      'comment le site est utilisé et l’améliorer. Ils ne sont déposés qu’avec votre accord. ' +
      'Plus d’infos dans notre <a href="./vie-privee.html">politique de confidentialité</a>.</p>' +
      '<div class="cb-actions">' +
      '<button type="button" class="cb-accept">Accepter</button>' +
      '<button type="button" class="cb-decline">Refuser</button>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('.cb-accept').addEventListener('click', function () {
      setConsent('granted');
      loadAnalytics();
      el.remove();
    });
    el.querySelector('.cb-decline').addEventListener('click', function () {
      setConsent('denied');
      el.remove();
    });
  }

  // Exposed so a "Gérer les cookies" footer link can reopen the choice at any time.
  window.openCookieSettings = function () {
    var existing = document.getElementById('cookie-banner');
    if (existing) existing.remove();
    showBanner();
  };

  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (!link) return;
    e.preventDefault();
    window.openCookieSettings();
  });

  var choice = getConsent();
  if (choice === 'granted') {
    loadAnalytics();
  } else if (choice !== 'denied') {
    document.addEventListener('DOMContentLoaded', showBanner);
  }
})();
