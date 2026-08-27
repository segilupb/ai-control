/*
 * Claude Control — background/history.js
 * Historial LIGERO de tareas (FASE2 §10): título, tiempos, duración y resultado.
 * JAMÁS contenido de conversaciones. Buffer circular de máx. 200 entradas en
 * storage.local, más reciente primero. Factory testeable en Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.createHistory = api.createHistory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_ENTRIES = 200;
  const KEY = 'cc_history';

  function createHistory(deps) {
    const d = Object.assign(
      {
        now: () => Date.now(),
        storageGet: async () => ({}),
        storageSet: async () => {},
        isEnabled: async () => true,
      },
      deps || {}
    );

    async function load() {
      const st = await d.storageGet([KEY]);
      const arr = st && Array.isArray(st[KEY]) ? st[KEY] : [];
      return arr;
    }

    /**
     * @param {object} e { conversationTitle, outcome: 'completed'|'attention'|'abandoned',
     *                     startedAt?, endedAt?, durationMs?, detectorVersion?, reason? }
     */
    async function add(e) {
      if (!(await d.isEnabled())) return null;
      const entry = {
        provider: e.provider || null,
        conversationTitle: e.conversationTitle || null,
        outcome: e.outcome,
        startedAt: e.startedAt ?? null,
        endedAt: e.endedAt ?? d.now(),
        durationMs: typeof e.durationMs === 'number' ? e.durationMs : null,
        detectorVersion: e.detectorVersion || null,
        reason: e.reason || null,          // para attention: dialog|error|auth
        at: d.now(),
      };
      const arr = await load();
      arr.unshift(entry);                   // más reciente primero
      if (arr.length > MAX_ENTRIES) arr.length = MAX_ENTRIES;
      await d.storageSet({ [KEY]: arr });
      return entry;
    }

    async function list() {
      return load();
    }

    async function clear() {
      await d.storageSet({ [KEY]: [] });
    }

    return { add, list, clear, MAX_ENTRIES };
  }

  return { createHistory };
});
