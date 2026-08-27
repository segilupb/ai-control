/*
 * Claude Control — shared/i18n.js
 * Localiza el DOM con chrome.i18n. El idioma lo elige el navegador según
 * _locales/ (en, es, pt_BR, fr, de, it) con respaldo en inglés.
 *
 * Uso en HTML:
 *   <span data-i18n="clave">texto por defecto</span>
 *   <button data-i18n-title="clave">   → traduce el atributo title
 *   <input data-i18n-placeholder="clave">
 */
(function () {
  'use strict';
  const has = typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage;

  function t(key, subs) {
    if (!has) return null;
    const s = chrome.i18n.getMessage(key, subs);
    return s || null;
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const s = t(el.getAttribute('data-i18n'));
      if (s) el.textContent = s;
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const s = t(el.getAttribute('data-i18n-title'));
      if (s) el.title = s;
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const s = t(el.getAttribute('data-i18n-placeholder'));
      if (s) el.placeholder = s;
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const s = t(el.getAttribute('data-i18n-html'));
      if (s) el.textContent = s;
    });
    try {
      if (has && chrome.i18n.getUILanguage) {
        document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
      }
    } catch (_e) {}
  }

  window.__ccI18n = { t, apply };
  document.addEventListener('DOMContentLoaded', () => apply());
})();
