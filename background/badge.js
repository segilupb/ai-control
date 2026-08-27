/*
 * Claude Control — background/badge.js
 * Regla de prioridad NO ambigua (FASE2 §9): el número mostrado siempre
 * corresponde al color mostrado.
 *   rojo  = nº de pestañas NEEDS_ATTENTION      (lo más urgente)
 *   verde = nº de COMPLETED sin ver
 *   naranja = nº de tareas activas (GENERATING/TOOL_RUNNING/SETTLING)
 *   vacío = nada que contar
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.badge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLORS = { attention: '#dc2626', completed: '#16a34a', generating: '#f59e0b' };

  const PER_TAB = {
    GENERATING: { text: '…', color: COLORS.generating },
    TOOL_RUNNING: { text: '…', color: COLORS.generating },
    SETTLING: { text: '…', color: COLORS.generating },
    COMPLETED: { text: '✓', color: COLORS.completed },
    NEEDS_ATTENTION: { text: '!', color: COLORS.attention },
    UNKNOWN: { text: '?', color: '#6b7280' },
    IDLE: { text: '', color: COLORS.generating },
  };

  /** Calcula el badge global a partir de counts() del registry (puro, testeable). */
  function globalBadge(counts) {
    if (counts.attention > 0) return { text: String(counts.attention), color: COLORS.attention };
    if (counts.completed > 0) return { text: String(counts.completed), color: COLORS.completed };
    if (counts.generating > 0) return { text: String(counts.generating), color: COLORS.generating };
    return { text: '', color: COLORS.generating };
  }

  function perTabBadge(state) {
    return PER_TAB[state] || PER_TAB.IDLE;
  }

  /** Aplica con las APIs reales (no-op fuera de la extensión). */
  function apply(counts, tabsSnapshot) {
    if (typeof chrome === 'undefined' || !chrome.action) return;
    const g = globalBadge(counts);
    chrome.action.setBadgeText({ text: g.text });
    if (g.text) chrome.action.setBadgeBackgroundColor({ color: g.color });

    if (Array.isArray(tabsSnapshot)) {
      for (const t of tabsSnapshot) {
        const b = perTabBadge(t.state);
        try {
          chrome.action.setBadgeText({ text: b.text, tabId: t.tabId });
          if (b.text) chrome.action.setBadgeBackgroundColor({ color: b.color, tabId: t.tabId });
        } catch (_e) { /* la pestaña puede haberse cerrado */ }
      }
    }
  }

  return { globalBadge, perTabBadge, apply, COLORS };
});
