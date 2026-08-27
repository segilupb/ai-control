/*
 * Claude Control — content-main.js
 * Orquesta detector + FSM en UNA pestaña/ventana-PWA de claude.ai.
 * Cargado tras detector.js y state-machine.js (orden en manifest.json).
 *
 * Rendimiento (FASE2 §4):
 * - MutationObserver solo marca dirty; el scheduler evalúa como máximo cada
 *   EVAL_MIN_MS. Latido de seguridad: HEARTBEAT_ACTIVE_MS en estados activos,
 *   HEARTBEAT_IDLE_MS en reposo (backoff). Un solo timer.
 */
(function () {
  'use strict';

  const NS = (typeof globalThis !== 'undefined' ? globalThis : window).__claudeControl || {};
  const detector = NS.detector;
  const fsm = NS.fsm;
  if (!detector || !fsm) {
    console.warn('[Claude Control] detector/fsm no cargados; abortando content script.');
    return;
  }
  const hasChrome = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

  const EVAL_MIN_MS = 250;
  const HEARTBEAT_ACTIVE_MS = 2000;
  const HEARTBEAT_IDLE_MS = 10000;
  const SW_HEARTBEAT_MS = 30000;

  let state = fsm.createState(Date.now());
  let settings = { settleMs: fsm.DEFAULTS.settleMs, minTaskMs: fsm.DEFAULTS.minTaskMs };
  let dirty = true;
  let evalTimer = null;
  let lastEvalAt = 0;
  let lastUrl = location.href;
  // Evidencia de red enviada por el service worker (webRequest).
  const netState = { inFlight: 0, completedAt: 0, lastAt: 0 };
  let swHeartbeatTimer = null;

  // ── Mensajería ─────────────────────────────────────────────────────
  function send(msg) {
    if (!hasChrome) return;
    try {
      chrome.runtime.sendMessage(Object.assign({ ns: 'cc' }, msg)).catch(() => {});
    } catch (_e) { /* contexto de extensión invalidado */ }
  }

  let disabled = false;

  function stopEverything() {
    disabled = true;
    if (evalTimer) clearTimeout(evalTimer);
    if (swHeartbeatTimer) clearInterval(swHeartbeatTimer);
  }

  function register() {
    const sig = detector.detect();
    sendWithReply({
      type: 'CC_REGISTER',
      url: location.href,
      title: document.title,
      provider: sig.provider,
      providerName: sig.providerName,
      conversationTitle: sig.context.conversationTitle,
      detectorVersion: sig.detectorVersion,
    }, (resp) => {
      // El usuario desactivó esta IA en Opciones: no gastar recursos aquí.
      if (resp && resp.disabled) stopEverything();
    });
  }

  function sendWithReply(msg, cb) {
    if (!hasChrome) return;
    try {
      chrome.runtime.sendMessage(Object.assign({ ns: 'cc' }, msg), (resp) => {
        void chrome.runtime.lastError;
        if (cb) cb(resp);
      });
    } catch (_e) { /* contexto invalidado */ }
  }

  function report(prevName, events, sig) {
    for (const ev of events) {
      if (ev.type === 'state_changed') {
        send({
          type: 'CC_STATE',
          prev: ev.prev,
          next: ev.next,
          at: ev.at,
          provider: sig.provider,
          conversationTitle: sig.context.conversationTitle,
          taskStartedAt: state.taskStartedAt,
          attentionReason: state.attentionReason,
          detectorVersion: sig.detectorVersion,
        });
      } else if (ev.type === 'completed') {
        send({ type: 'CC_COMPLETED', durationMs: ev.durationMs, at: ev.at,
               provider: sig.provider, conversationTitle: sig.context.conversationTitle });
      } else if (ev.type === 'needs_attention') {
        send({ type: 'CC_ATTENTION', reason: ev.reason, at: ev.at,
               provider: sig.provider, conversationTitle: sig.context.conversationTitle });
      } else if (ev.type === 'attention_cleared') {
        send({ type: 'CC_ATTENTION_CLEARED', at: ev.at });
      } else if (ev.type === 'abandoned') {
        send({ type: 'CC_ABANDONED', at: ev.at });
      } else if (ev.type === 'task_started') {
        send({ type: 'CC_TASK_STARTED', at: ev.at,
               conversationTitle: sig.context.conversationTitle });
      }
    }
  }

  // ── Evaluación ─────────────────────────────────────────────────────
  function evaluate(reason) {
    if (disabled) return;
    lastEvalAt = Date.now();
    dirty = false;

    // Navegación SPA → reset completo, sin notificar tareas abandonadas.
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      detector.resetInternal();
      state = fsm.reset(Date.now());
      netState.inFlight = 0; netState.completedAt = 0;
      register();
      return scheduleNext();
    }

    const sig = detector.detect();
    // La evidencia de red viaja junto a las señales DOM en el mismo snapshot.
    sig.network = { inFlight: netState.inFlight, completedAt: netState.completedAt };
    const prevName = state.name;
    const res = fsm.step(state, sig, Date.now(), settings);
    state = res.state;
    if (res.events.length) report(prevName, res.events, sig);
    scheduleNext();
  }

  function scheduleNext() {
    if (evalTimer) clearTimeout(evalTimer);
    const active = fsm.ACTIVE.includes(state.name) ||
      state.name === 'SETTLING' || state.name === 'NEEDS_ATTENTION';
    const wait = dirty
      ? Math.max(0, EVAL_MIN_MS - (Date.now() - lastEvalAt))
      : (active ? HEARTBEAT_ACTIVE_MS : HEARTBEAT_IDLE_MS);
    evalTimer = setTimeout(() => evaluate('timer'), wait);
  }

  function markDirty() {
    dirty = true;
    // Si el próximo latido está lejos, adelantar respetando EVAL_MIN_MS.
    if (Date.now() - lastEvalAt >= EVAL_MIN_MS) {
      evaluate('mutation');
    } else {
      scheduleNext();
    }
  }

  // ── Observadores ───────────────────────────────────────────────────
  function startObserver() {
    const P = detector.current && detector.current();
    const sel = (P && P.mainContainer ? P.mainContainer.join(', ') : 'main, [role="main"], #app');
    const main = document.querySelector(sel) || document.body;
    const obs = new MutationObserver(markDirty);
    obs.observe(main, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-is-streaming', 'aria-label', 'aria-busy',
        'data-testid', 'disabled', 'aria-disabled', 'role', 'data-state',
      ],
    });
    // El <title> vive fuera de main: observarlo para el título de conversación.
    const head = document.querySelector('head > title');
    if (head) new MutationObserver(markDirty).observe(head, { childList: true });
  }

  window.addEventListener('online', markDirty);
  window.addEventListener('offline', markDirty);

  // ── Latido hacia el SW (detección de pestañas zombis) ──────────────
  function startSwHeartbeat() {
    if (swHeartbeatTimer) clearInterval(swHeartbeatTimer);
    swHeartbeatTimer = setInterval(() => {
      const active = fsm.ACTIVE.includes(state.name) ||
        state.name === 'SETTLING' || state.name === 'NEEDS_ATTENTION';
      if (active) send({ type: 'CC_HEARTBEAT', state: state.name });
    }, SW_HEARTBEAT_MS);
  }

  // ── Comandos del SW / popup ────────────────────────────────────────
  if (hasChrome) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.ns !== 'cc') return;
      if (msg.type === 'CC_QUERY') {
        const sig = detector.detect();
        sendResponse({
          state: state.name,
          since: state.since,
          taskStartedAt: state.taskStartedAt,
          attentionReason: state.attentionReason,
          provider: sig.provider,
          conversationTitle: sig.context.conversationTitle,
          confidence: sig.confidence,
          detectorVersion: sig.detectorVersion,
          url: location.href,
        });
        return true;
      }
      if (msg.type === 'CC_NET') {
        if (typeof msg.inFlight === 'number') netState.inFlight = msg.inFlight;
        if (msg.phase === 'complete' || msg.phase === 'error') netState.completedAt = msg.at || Date.now();
        netState.lastAt = msg.at || Date.now();
        markDirty();               // re-evaluar ya: el DOM decide, no la red
        sendResponse({ ok: true });
        return true;
      }
      if (msg.type === 'CC_RESET') {
        detector.resetInternal();
        state = fsm.reset(Date.now());
        markDirty();
        sendResponse({ ok: true });
        return true;
      }
      if (msg.type === 'CC_SETTINGS') {
        if (typeof msg.settleMs === 'number') settings.settleMs = msg.settleMs;
        if (typeof msg.minTaskMs === 'number') settings.minTaskMs = msg.minTaskMs;
        // Reactivación en caliente: si vuelven a activarla, recargar la pestaña
        // es lo más limpio; si la desactivan, parar aquí mismo.
        const P = detector.current && detector.current();
        if (P && msg.providers && msg.providers[P.id] === false) stopEverything();
        sendResponse({ ok: true });
        return true;
      }
    });

    // Ajustes iniciales desde storage (best-effort).
    try {
      chrome.storage.local.get(['settings'], (data) => {
        const st = data && data.settings;
        if (st && typeof st.settleMs === 'number') settings.settleMs = st.settleMs;
        if (st && typeof st.minTaskMs === 'number') settings.minTaskMs = st.minTaskMs;
      });
    } catch (_e) { /* noop */ }
  }

  // ── Init ───────────────────────────────────────────────────────────
  function init() {
    if (!detector.current || !detector.current()) return; // sitio no soportado
    register();
    startObserver();
    startSwHeartbeat();
    evaluate('init');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // Pequeño margen para que la SPA monte el hilo.
    setTimeout(init, 800);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
  }
})();
