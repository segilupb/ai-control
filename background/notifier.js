/*
 * Claude Control — background/notifier.js
 * Notificaciones nativas con:
 *  - agrupación: ≥2 COMPLETED en <5 s → una sola notificación de grupo;
 *  - UN solo listener global de clicks (el destino va codificado en el id:
 *    "cc|done|<tabId>", "cc|attn|<tabId>", "cc|group|<ts>") — corrige la fuga
 *    de listeners detectada en la auditoría de ai-tab-notifier;
 *  - auto-clear con chrome.alarms de un disparo (jamás setTimeout en el SW).
 *    Nota: Chromium fija un mínimo efectivo (~30 s) para alarms; el auto-clear
 *    es aproximado y Windows ya recoge el toast en el Centro de actividades.
 *  - NEEDS_ATTENTION: requireInteraction=true, sin auto-clear, icono/tono distinto.
 *
 * Factory con dependencias inyectadas → testeable en Node (tests/test-notifier.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.createNotifier = api.createNotifier;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GROUP_WINDOW_MS = 5000;
  const ALARM_PREFIX = 'cc_notif_clear|';

  const DEFAULT_SETTINGS = Object.freeze({
    notifyDone: true,
    notifyAttention: true,
    autoDismissSeconds: 25, // aproximado (mínimo de alarms de Chromium)
    sound: { enabled: true },
  });

  function createNotifier(deps) {
    const d = Object.assign(
      {
        now: () => Date.now(),
        create: async () => {},           // chrome.notifications.create(id, opts)
        clear: async () => {},            // chrome.notifications.clear(id)
        alarmCreate: () => {},            // chrome.alarms.create(name, {when})
        focusTab: async () => {},
        playSound: () => {},              // sound.play('done'|'attention')
        getSettings: async () => ({}),    // settings desde storage
        // t(key, subs) → texto localizado; null si no hay i18n (tests)
        t: () => null,
        iconDone: 'icons/icon128.png',
        iconAttention: 'icons/icon128.png',
      },
      deps || {}
    );

    /** Finalizaciones recientes para agrupación: [{tabId, title, at, notifId}] */
    let recent = [];
    let groupId = null;

    async function settings() {
      const s = (await d.getSettings()) || {};
      return {
        ...DEFAULT_SETTINGS,
        ...s,
        sound: { ...DEFAULT_SETTINGS.sound, ...(s.sound || {}) },
      };
    }

    function prune(now) {
      recent = recent.filter((r) => now - r.at <= GROUP_WINDOW_MS);
    }

    function scheduleAutoClear(notifId, seconds) {
      if (!seconds || seconds <= 0) return;
      d.alarmCreate(ALARM_PREFIX + notifId, { when: d.now() + seconds * 1000 });
    }

    // ── COMPLETED ─────────────────────────────────────────────────────
    async function notifyCompleted({ tabId, conversationTitle, durationMs, provider, providerName }) {
      const cfg = await settings();
      if (!cfg.notifyDone) return;

      const now = d.now();
      prune(now);

      const title = conversationTitle ||
        d.t('fallbackTab', [String(tabId)]) || `Conversation (tab ${tabId})`;
      const entry = { tabId, title, at: now, provider, providerName,
                      notifId: `cc|done|${tabId}|${now}` };
      recent.push(entry);

      if (cfg.sound.enabled) d.playSound('done', provider);

      if (recent.length >= 2) {
        // Agrupar: limpiar individuales del grupo y mostrar una sola.
        for (const r of recent) {
          if (r.notifId) await d.clear(r.notifId).catch?.(() => {});
        }
        if (groupId) await d.clear(groupId);
        groupId = `cc|group|${now}`;
        const names = recent
          .map((r) => `• ${r.providerName ? r.providerName + ': ' : ''}${r.title}`)
          .join('\n');
        await d.create(groupId, {
          type: 'basic',
          iconUrl: d.iconDone,
          title: d.t('notifDoneGroup', [String(recent.length)]) ||
                 `Claude finished ${recent.length} tasks`,
          message: names.slice(0, 500),
          priority: 2,
          silent: cfg.sound.enabled, // sin doble sonido
        });
        scheduleAutoClear(groupId, cfg.autoDismissSeconds);
        return groupId;
      }

      await d.create(entry.notifId, {
        type: 'basic',
        iconUrl: d.iconDone,
        title: `${providerName || 'Claude'} ${d.t('finishedWord') || 'finished'}`,
        message: title + (durationMs ? `\n${formatDuration(durationMs)}` : ''),
        priority: 2,
        silent: cfg.sound.enabled,
      });
      scheduleAutoClear(entry.notifId, cfg.autoDismissSeconds);
      return entry.notifId;
    }

    // ── NEEDS_ATTENTION ───────────────────────────────────────────────
    const REASON_KEY = { dialog: 'reasonDialog', error: 'reasonError', auth: 'reasonAuth' };
    const REASON_FALLBACK = {
      dialog: 'A permission or confirmation is pending',
      error: 'The conversation shows an error',
      auth: 'Your session needs you to sign in',
    };

    async function notifyAttention({ tabId, conversationTitle, reason, provider, providerName }) {
      const cfg = await settings();
      if (!cfg.notifyAttention) return;

      if (cfg.sound.enabled) d.playSound('attention', provider);

      const notifId = `cc|attn|${tabId}|${d.now()}`;
      await d.create(notifId, {
        type: 'basic',
        iconUrl: d.iconAttention,
        title: `⚠️ ${providerName || 'Claude'} ${d.t('needsAttentionWord') || 'needs your attention'}`,
        message: `${conversationTitle || d.t('fallbackTab', [String(tabId)]) || `Tab ${tabId}`}\n` +
          `${d.t(REASON_KEY[reason]) || REASON_FALLBACK[reason] || 'An action is required'}`,
        priority: 2,
        requireInteraction: true,   // no se auto-oculta
        silent: cfg.sound.enabled,
      });
      return notifId;
    }

    // ── Click routing (UN solo listener global, registrado por el SW) ─
    async function handleClick(notifId) {
      if (typeof notifId !== 'string' || !notifId.startsWith('cc|')) return false;
      const parts = notifId.split('|'); // cc | kind | tabId/ts | ts?
      const kind = parts[1];

      if (kind === 'done' || kind === 'attn') {
        const tabId = parseInt(parts[2], 10);
        if (!Number.isNaN(tabId)) await d.focusTab(tabId);
      } else if (kind === 'group') {
        // Enfocar la más reciente del grupo.
        const last = recent[recent.length - 1];
        if (last) await d.focusTab(last.tabId);
        groupId = null;
        recent = [];
      }
      await d.clear(notifId);
      return true;
    }

    // ── Auto-clear vía alarms (el SW enruta onAlarm aquí) ─────────────
    async function handleAlarm(alarmName) {
      if (typeof alarmName !== 'string' || !alarmName.startsWith(ALARM_PREFIX)) return false;
      const notifId = alarmName.slice(ALARM_PREFIX.length);
      await d.clear(notifId);
      return true;
    }

    function formatDuration(ms) {
      const label = d.t('durationLabel') || 'Duration';
      const s = Math.round(ms / 1000);
      if (s < 60) return `${label}: ${s} s`;
      const m = Math.floor(s / 60);
      return `${label}: ${m} min ${s % 60} s`;
    }

    return { notifyCompleted, notifyAttention, handleClick, handleAlarm, ALARM_PREFIX, GROUP_WINDOW_MS };
  }

  return { createNotifier };
});
