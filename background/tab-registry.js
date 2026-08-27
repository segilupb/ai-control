/*
 * Claude Control — background/tab-registry.js
 * Fuente de verdad del estado multi-tab. Cada pestaña/ventana-PWA de claude.ai
 * tiene una entrada independiente; el estado de una JAMÁS toca el de otra.
 *
 * Diseñado como factory con dependencias inyectadas (storage, ping, reloj)
 * para testearlo en Node sin chrome.* (tests/test-registry.js).
 *
 * Persistencia: espejo en chrome.storage.session (sobrevive al sleep del SW,
 * muere con el navegador — igual que las pestañas). Debounced.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.createTabRegistry = api.createTabRegistry;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ACTIVE_STATES = ['GENERATING', 'TOOL_RUNNING', 'SETTLING', 'NEEDS_ATTENTION'];
  const STALE_AFTER_MS = 90 * 1000;   // sin heartbeat ni transición en estado activo
  const PERSIST_DEBOUNCE_MS = 500;
  const STORAGE_KEY = 'cc_tab_registry';

  function createTabRegistry(deps) {
    const d = Object.assign(
      {
        now: () => Date.now(),
        // storage.session inyectado: { get(key)→Promise<any>, set(key,val)→Promise }
        storageGet: async () => null,
        storageSet: async () => {},
        // ping(tabId) → Promise<respuesta|null>: CC_QUERY al content script
        ping: async () => null,
      },
      deps || {}
    );

    /** tabId → TabState */
    const tabs = new Map();
    const listeners = { change: [], completed: [], attention: [] };
    let persistTimer = null;

    function emit(event, payload) {
      for (const fn of listeners[event] || []) {
        try { fn(payload); } catch (e) { /* un listener roto no tumba el registro */ }
      }
    }

    function on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return () => {
        const i = listeners[event].indexOf(fn);
        if (i >= 0) listeners[event].splice(i, 1);
      };
    }

    function schedulePersist() {
      if (persistTimer) return;
      persistTimer = setTimeout(async () => {
        persistTimer = null;
        try {
          await d.storageSet(STORAGE_KEY, serialize());
        } catch (_e) { /* best-effort */ }
      }, PERSIST_DEBOUNCE_MS);
    }

    function serialize() {
      return Array.from(tabs.values());
    }

    async function restore() {
      try {
        const saved = await d.storageGet(STORAGE_KEY);
        if (Array.isArray(saved)) {
          for (const t of saved) {
            if (t && typeof t.tabId === 'number') tabs.set(t.tabId, t);
          }
        }
      } catch (_e) { /* arranque en frío */ }
    }

    function blank(tabId, windowId) {
      return {
        tabId,
        windowId: windowId ?? null,
        isAppWindow: false,          // se rellena vía windows.get (Fase F)
        url: '',
        title: '',
        provider: null,
        providerName: null,
        conversationTitle: null,
        state: 'IDLE',
        since: d.now(),
        taskStartedAt: null,
        taskEndedAt: null,
        lastActivityAt: d.now(),
        lastSeenAt: d.now(),         // último mensaje recibido de este content script
        attentionReason: null,
        detectorVersion: null,
        completedUnseen: false,      // COMPLETED aún no visto por el usuario
        stale: false,
      };
    }

    function touch(t) {
      t.lastSeenAt = d.now();
      t.stale = false;
    }

    // ── Entradas desde mensajes del content script ────────────────────
    function register(tabId, windowId, msg) {
      const prev = tabs.get(tabId);
      const t = prev || blank(tabId, windowId);
      t.windowId = windowId ?? t.windowId;
      t.url = msg.url || t.url;
      t.title = msg.title || t.title;
      t.provider = msg.provider || t.provider;
      t.providerName = msg.providerName || t.providerName;
      t.conversationTitle = msg.conversationTitle ?? t.conversationTitle;
      t.detectorVersion = msg.detectorVersion || t.detectorVersion;
      // Re-registro (navegación SPA o recarga): la tarea anterior murió sin notificar.
      t.state = 'IDLE';
      t.taskStartedAt = null;
      t.attentionReason = null;
      touch(t);
      tabs.set(tabId, t);
      schedulePersist();
      emit('change', { tabId, tab: t, reason: 'register' });
      return t;
    }

    function applyState(tabId, windowId, msg) {
      const t = tabs.get(tabId) || register(tabId, windowId, msg);
      t.state = msg.next;
      t.since = msg.at || d.now();
      t.lastActivityAt = d.now();
      if (msg.provider) t.provider = msg.provider;
      if (msg.conversationTitle) t.conversationTitle = msg.conversationTitle;
      if (msg.taskStartedAt !== undefined) t.taskStartedAt = msg.taskStartedAt;
      t.attentionReason = msg.attentionReason ?? null;
      if (msg.detectorVersion) t.detectorVersion = msg.detectorVersion;
      if (ACTIVE_STATES.includes(msg.next)) t.completedUnseen = false;
      touch(t);
      schedulePersist();
      emit('change', { tabId, tab: t, reason: 'state' });
      return t;
    }

    function applyCompleted(tabId, msg) {
      const t = tabs.get(tabId);
      if (!t) return null;
      t.state = 'COMPLETED';          // estado de PRESENTACIÓN (la FSM ya está en IDLE)
      t.taskEndedAt = msg.at || d.now();
      t.completedUnseen = true;
      if (msg.conversationTitle) t.conversationTitle = msg.conversationTitle;
      touch(t);
      schedulePersist();
      const payload = { tabId, tab: t, durationMs: msg.durationMs || 0 };
      emit('completed', payload);
      emit('change', { tabId, tab: t, reason: 'completed' });
      return t;
    }

    function applyAttention(tabId, msg) {
      const t = tabs.get(tabId);
      if (!t) return null;
      t.state = 'NEEDS_ATTENTION';
      t.attentionReason = msg.reason || 'dialog';
      if (msg.conversationTitle) t.conversationTitle = msg.conversationTitle;
      touch(t);
      schedulePersist();
      const payload = { tabId, tab: t, reason: t.attentionReason };
      emit('attention', payload);
      emit('change', { tabId, tab: t, reason: 'attention' });
      return t;
    }

    function heartbeat(tabId, msg) {
      const t = tabs.get(tabId);
      if (!t) return null;
      if (msg && msg.state) t.state = msg.state === 'COMPLETED' ? t.state : msg.state;
      touch(t);
      return t;
    }

    // ── El usuario vio la pestaña ─────────────────────────────────────
    function markSeen(tabId) {
      const t = tabs.get(tabId);
      if (!t) return null;
      if (t.state === 'COMPLETED') {
        t.state = 'IDLE';
        t.completedUnseen = false;
        schedulePersist();
        emit('change', { tabId, tab: t, reason: 'seen' });
      }
      return t;
    }

    // ── Ciclo de vida de pestañas ─────────────────────────────────────
    function remove(tabId) {
      if (tabs.delete(tabId)) {
        schedulePersist();
        emit('change', { tabId, tab: null, reason: 'removed' });
      }
    }

    function replace(addedTabId, removedTabId) {
      const t = tabs.get(removedTabId);
      if (!t) return;
      tabs.delete(removedTabId);
      t.tabId = addedTabId;
      tabs.set(addedTabId, t);
      schedulePersist();
      emit('change', { tabId: addedTabId, tab: t, reason: 'replaced' });
    }

    // ── Detección de zombis ───────────────────────────────────────────
    async function sweepStale() {
      const now = d.now();
      for (const t of tabs.values()) {
        const isActive = ACTIVE_STATES.includes(t.state);
        if (!isActive || now - t.lastSeenAt < STALE_AFTER_MS) continue;
        // Ping de última oportunidad
        let alive = null;
        try { alive = await d.ping(t.tabId); } catch (_e) { alive = null; }
        if (alive && alive.state) {
          t.state = alive.state;
          t.conversationTitle = alive.conversationTitle ?? t.conversationTitle;
          touch(t);
          emit('change', { tabId: t.tabId, tab: t, reason: 'ping' });
        } else {
          t.state = 'UNKNOWN';
          t.stale = true;
          schedulePersist();
          emit('change', { tabId: t.tabId, tab: t, reason: 'stale' });
        }
      }
    }

    // ── Lecturas ──────────────────────────────────────────────────────
    function get(tabId) { return tabs.get(tabId) || null; }
    function snapshot() { return serialize(); }
    function counts() {
      let generating = 0, completed = 0, attention = 0;
      for (const t of tabs.values()) {
        if (t.state === 'GENERATING' || t.state === 'TOOL_RUNNING' || t.state === 'SETTLING') generating++;
        else if (t.state === 'COMPLETED' && t.completedUnseen) completed++;
        else if (t.state === 'NEEDS_ATTENTION') attention++;
      }
      return { generating, completed, attention, total: tabs.size };
    }

    return {
      restore, register, applyState, applyCompleted, applyAttention,
      heartbeat, markSeen, remove, replace, sweepStale,
      get, snapshot, counts, on,
      STALE_AFTER_MS, ACTIVE_STATES,
    };
  }

  return { createTabRegistry };
});
