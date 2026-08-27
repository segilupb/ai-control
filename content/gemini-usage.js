/*
 * AI Control — content/gemini-usage.js
 * Lee el uso de Gemini desde un IFRAME oculto dentro de la propia pestaña.
 *
 * ¿Por qué un iframe y no un fetch? Porque gemini.google.com/usage pinta los
 * porcentajes con JavaScript: el HTML crudo que devuelve un fetch no los trae.
 * Dentro de un iframe same-origin el JS sí se ejecuta y el DOM sí tiene los
 * valores. (Técnica de gemini-usage-bar, reimplementada.)
 *
 * Requiere la regla declarativeNetRequest de rules.json, que quita
 * X-Frame-Options y CSP SOLO para esa ruta concreta.
 *
 * Se ejecuta bajo demanda (mensaje del service worker), nunca en bucle.
 */
(function () {
  'use strict';

  const NS = (typeof globalThis !== 'undefined' ? globalThis : window).__claudeControl || {};
  const detector = NS.detector;
  const adapters = (window.__claudeControlBg || {}).usageAdapters;

  // Solo tiene sentido dentro de Gemini y fuera de un iframe.
  const P = detector && detector.current && detector.current();
  if (!P || P.id !== 'gemini' || window.top !== window) return;

  const IFRAME_ID = '__ai_control_gemini_usage';
  const LOAD_TIMEOUT_MS = 15000;
  const RENDER_WAIT_MS = 1200;   // margen para que Angular pinte los valores

  let busy = false;

  function accountPath() {
    // Conserva el índice de cuenta de la pestaña actual: /u/7/app → /u/7/usage
    const m = location.pathname.match(/^\/u\/(\d+)\//);
    return m ? `/u/${m[1]}/usage` : '/usage';
  }

  function removeFrame() {
    const old = document.getElementById(IFRAME_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function scrape() {
    return new Promise((resolve) => {
      if (busy) return resolve({ status: 'error', error: 'busy' });
      busy = true;

      removeFrame();
      const iframe = document.createElement('iframe');
      iframe.id = IFRAME_ID;
      iframe.src = `${location.origin}${accountPath()}?t=${Date.now()}`;
      // Invisible y sin interferir con la página
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText =
        'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none;left:-9999px';

      let settled = false;
      const done = (payload) => {
        if (settled) return;
        settled = true;
        busy = false;
        clearTimeout(timer);
        removeFrame();
        resolve(payload);
      };

      const timer = setTimeout(() => done({ status: 'error', error: 'timeout' }), LOAD_TIMEOUT_MS);

      iframe.addEventListener('load', () => {
        // Esperar a que el framework pinte los porcentajes.
        setTimeout(() => {
          try {
            const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (!doc) return done({ status: 'auth', error: 'no-access' });

            const t = (doc.title || '').toLowerCase();
            if (/sign in|iniciar sesión|anmelden|connexion/.test(t)) {
              return done({ status: 'auth', error: 'login' });
            }
            if (!adapters) return done({ status: 'error', error: 'no-adapter' });

            const snap = adapters.parseGeminiDocument(doc, { now: Date.now() });
            done(snap);
          } catch (e) {
            // Cross-origin (redirección a accounts.google.com) → sesión
            done({ status: 'auth', error: 'cross-origin' });
          }
        }, RENDER_WAIT_MS);
      });

      (document.body || document.documentElement).appendChild(iframe);
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.ns !== 'cc' || msg.type !== 'CC_GEMINI_SCRAPE') return;
      scrape().then(sendResponse);
      return true;   // respuesta asíncrona
    });
  }
})();
