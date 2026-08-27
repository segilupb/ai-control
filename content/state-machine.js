/*
 * Claude Control — state-machine.js
 * FSM pura: (estadoPrevio, señales, ahora, config) → { state, events }.
 * Sin DOM, sin chrome.*: testeable en Node (tests/test-fsm.js).
 *
 * Estados: IDLE, GENERATING, TOOL_RUNNING, SETTLING, NEEDS_ATTENTION,
 *          SUSPENDED_NETWORK, UNKNOWN. COMPLETED es un EVENTO (transición
 *          SETTLING→IDLE con evento 'completed'), no un estado persistente:
 *          la persistencia visual de "terminó" vive en el tab-registry del SW.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControl = root.__claudeControl || {};
  root.__claudeControl.fsm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    settleMs: 4000,     // ventana de estabilidad antes de declarar fin
    minTaskMs: 1500,    // actividad mínima acumulada para que una tarea sea notificable
    unknownStreak: 3,   // evaluaciones consecutivas sin confianza → UNKNOWN
  });

  const ACTIVE = ['GENERATING', 'TOOL_RUNNING'];

  function createState(now = 0) {
    return {
      name: 'IDLE',
      since: now,
      lastStepAt: now,
      taskStartedAt: null,   // inicio de la tarea en curso (si la hay)
      activeAccumMs: 0,      // ms acumulados en estados activos (filtro minTaskMs)
      settlingSince: null,
      attentionReason: null, // 'dialog' | 'error' | 'auth'
      hadTaskBeforeAttention: false,
      hadTaskBeforeOffline: false,
      lowConfStreak: 0,
      netInFlight: 0,        // requests de generación en vuelo (evidencia de red)
      netCompletedAt: 0,     // última request terminada
    };
  }

  /** Reset completo (navegación SPA a otra conversación, CC_RESET). */
  function reset(now) {
    return createState(now);
  }

  function step(prev, sig, now, cfgIn) {
    const cfg = Object.assign({}, DEFAULTS, cfgIn || {});
    const s = Object.assign({}, prev);
    const events = [];

    // ── contabilidad de tiempo activo ────────────────────────────────
    const dt = Math.max(0, now - s.lastStepAt);
    if (ACTIVE.includes(s.name)) s.activeAccumMs += dt;
    s.lastStepAt = now;

    function transition(next) {
      if (s.name === next) return;
      events.push({ type: 'state_changed', prev: s.name, next, at: now });
      s.name = next;
      s.since = now;
    }

    // ── normalización de señales ─────────────────────────────────────
    const act = (sig && sig.activity) || {};
    const att = (sig && sig.attention) || {};
    const ctx = (sig && sig.context) || {};
    const online = !sig || sig.online !== false; // por defecto online

    // ── Evidencia de RED (webRequest) ────────────────────────────────
    // Regla: una request en vuelo SOSTIENE la tarea y puede INICIARLA (es la
    // señal más temprana y fiable). Una request TERMINADA no completa nada por
    // sí sola: solo deja de sostener, y la decisión sigue siendo del DOM + la
    // ventana de estabilidad. Así no hay falsos positivos con tool calls,
    // búsquedas ni cadenas de generación.
    const net = (sig && sig.network) || {};
    if (typeof net.inFlight === 'number') s.netInFlight = net.inFlight;
    if (net.completedAt) s.netCompletedAt = net.completedAt;
    const netActive = s.netInFlight > 0;

    // Señal de ARRANQUE de tarea: streaming, botón stop (A1–A3) o request viva.
    const startSignal = !!(act.streaming || act.stopButton || netActive);
    // Señales que SOSTIENEN una tarea ya en curso (A4/A5 nunca inician).
    const taskInProgress = s.taskStartedAt != null;
    const toolSignal = !!act.toolRunning;
    const growthSignal = !!act.contentGrowing;
    const sustainSignal = startSignal || (taskInProgress && (toolSignal || growthSignal));
    void s.netCompletedAt; // conservado para diagnóstico/historial

    // ── Caso 12: red caída — congelar, jamás completar offline ───────
    if (!online) {
      if (s.name !== 'SUSPENDED_NETWORK') {
        s.hadTaskBeforeOffline = taskInProgress || ACTIVE.includes(s.name);
        s.settlingSince = null;
        transition('SUSPENDED_NETWORK');
      }
      return { state: s, events };
    }
    if (s.name === 'SUSPENDED_NETWORK') {
      // Reconexión: re-evaluar limpio. Si había tarea, exigir nueva
      // ventana de estabilidad completa antes de poder completar.
      if (startSignal) {
        transition('GENERATING');
      } else if (taskInProgress && toolSignal) {
        transition('TOOL_RUNNING');
      } else if (s.hadTaskBeforeOffline && taskInProgress) {
        s.settlingSince = now;
        transition('SETTLING');
      } else {
        s.taskStartedAt = null;
        s.activeAccumMs = 0;
        transition('IDLE');
      }
      s.hadTaskBeforeOffline = false;
      return { state: s, events };
    }

    // ── UNKNOWN por pérdida de confianza del detector ────────────────
    const noConfidence =
      sig && typeof sig.confidence === 'number' && sig.confidence <= 0 && !ctx.composerReady;
    s.lowConfStreak = noConfidence ? s.lowConfStreak + 1 : 0;
    if (s.lowConfStreak >= cfg.unknownStreak && s.name !== 'UNKNOWN') {
      s.settlingSince = null;
      transition('UNKNOWN'); // nunca notifica
      return { state: s, events };
    }

    // ── Intervención (Caso 6) ────────────────────────────────────────
    // Un diálogo solo es relevante si hay tarea en curso o venimos de una;
    // errores y muro de login son relevantes siempre.
    const attentionRelevant =
      !!att.error ||
      !!att.authWall ||
      (!!att.dialog && (taskInProgress || ACTIVE.includes(s.name) || s.name === 'SETTLING'));

    if (attentionRelevant && s.name !== 'NEEDS_ATTENTION') {
      s.hadTaskBeforeAttention = taskInProgress;
      s.attentionReason = att.error ? 'error' : att.authWall ? 'auth' : 'dialog';
      s.settlingSince = null;
      transition('NEEDS_ATTENTION');
      events.push({ type: 'needs_attention', reason: s.attentionReason, at: now });
      return { state: s, events };
    }

    if (s.name === 'NEEDS_ATTENTION') {
      if (!att.dialog && !att.error && !att.authWall) {
        events.push({ type: 'attention_cleared', at: now });
        s.attentionReason = null;
        if (startSignal) {
          transition('GENERATING');
        } else if (s.hadTaskBeforeAttention && taskInProgress) {
          s.settlingSince = now; // la tarea puede haber muerto con el diálogo: settle limpio
          transition('SETTLING');
        } else {
          s.taskStartedAt = null;
          s.activeAccumMs = 0;
          transition('IDLE');
        }
        s.hadTaskBeforeAttention = false;
      }
      return { state: s, events };
    }

    // ── Flujo principal ──────────────────────────────────────────────
    switch (s.name) {
      case 'UNKNOWN': {
        if (startSignal) {
          s.taskStartedAt = now;
          s.activeAccumMs = 0;
          transition('GENERATING');
          events.push({ type: 'task_started', at: now });
        } else if (!noConfidence) {
          transition('IDLE');
        }
        break;
      }

      case 'IDLE': {
        if (startSignal) {
          s.taskStartedAt = now;
          s.activeAccumMs = 0;
          transition('GENERATING');
          events.push({ type: 'task_started', at: now });
        }
        break;
      }

      case 'GENERATING': {
        if (!sustainSignal) {
          s.settlingSince = now;
          transition('SETTLING');
        } else if (!startSignal && toolSignal) {
          transition('TOOL_RUNNING'); // Caso 5: streaming cesó, herramienta sigue
        }
        break;
      }

      case 'TOOL_RUNNING': {
        if (startSignal) {
          transition('GENERATING');
        } else if (!sustainSignal) {
          s.settlingSince = now;
          transition('SETTLING');
        }
        break;
      }

      case 'SETTLING': {
        if (startSignal) {
          s.settlingSince = null;
          transition('GENERATING'); // Caso 4: pausa temporal, sin notificar
        } else if (taskInProgress && toolSignal) {
          s.settlingSince = null;
          transition('TOOL_RUNNING');
        } else if (taskInProgress && growthSignal) {
          s.settlingSince = null;
          transition('GENERATING');
        } else if (now - s.settlingSince >= cfg.settleMs) {
          const durationMs = s.taskStartedAt != null ? now - s.taskStartedAt : 0;
          if (s.activeAccumMs >= cfg.minTaskMs) {
            events.push({ type: 'completed', durationMs, at: now });
          } else {
            events.push({ type: 'abandoned', durationMs, at: now }); // micro-parpadeo: sin notificación
          }
          s.taskStartedAt = null;
          s.activeAccumMs = 0;
          s.settlingSince = null;
          transition('IDLE');
        }
        break;
      }
    }

    return { state: s, events };
  }

  return { createState, reset, step, DEFAULTS, ACTIVE };
});
