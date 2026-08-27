/*
 * Claude Control — content/detector.js  (multi-proveedor)
 * ÚNICO archivo que conoce el DOM de los sitios. Si una IA cambia su interfaz,
 * se edita SU bloque en PROVIDERS y nada más.
 *
 * Proveedores: claude (claude.ai), chatgpt (chatgpt.com / chat.openai.com),
 *              gemini (gemini.google.com).
 *
 * Contrato de detect() (idéntico para los tres: la FSM no cambia):
 * { provider, providerName, activity{...}, attention{...}, context{...},
 *   online, confidence, detectorVersion }
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControl = root.__claudeControl || {};
  root.__claudeControl.detector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DETECTOR_VERSION = '2026.08.26-multi';

  const PROVIDERS = {
    claude: {
      id: 'claude', name: 'Claude', hosts: ['claude.ai'],
      titleSuffix: /\s*[-–|]\s*Claude\s*$/i,
      mainContainer: ['main', '[role="main"]', '#app'],
      streaming: ['[data-is-streaming="true"]'],
      stopButtonAttr: ['button[data-testid*="stop" i]'],
      toolRunning: ['[aria-busy="true"]', '[role="progressbar"]', '[data-testid*="tool" i][data-state="running"]'],
      toolTextScope: '[data-testid], [class*="artifact" i]',
      dialogs: ['[role="dialog"]', '[role="alertdialog"]'],
      errors: ['[role="alert"]', '[data-testid*="error" i]'],
      authWall: ['input[type="password"]', '[data-testid*="login" i]'],
      composer: ['div[contenteditable="true"]', 'textarea'],
      lastMessage: ['[data-testid="conversation-turn"]:last-of-type'],
      modeProbes: ['[data-testid="model-selector-dropdown"]', 'button[aria-label*="model" i]'],
    },

    chatgpt: {
      id: 'chatgpt', name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'],
      titleSuffix: /\s*[-–|]\s*ChatGPT\s*$/i,
      mainContainer: ['main', '[role="main"]'],
      streaming: ['.result-streaming', '[data-streaming="true"]'],
      stopButtonAttr: [
        'button[data-testid="stop-button"]',
        'button[data-testid*="stop" i]',
        'button[aria-label*="stop streaming" i]',
      ],
      toolRunning: ['[aria-busy="true"]', '[role="progressbar"]', '[data-testid*="tool" i][data-state="running"]', '.result-thinking'],
      toolTextScope: '[data-message-author-role="assistant"], [data-testid]',
      dialogs: ['[role="dialog"]', '[role="alertdialog"]'],
      errors: ['[role="alert"]', '[data-testid*="error" i]'],
      authWall: ['input[type="password"]', 'button[data-testid="login-button"]'],
      composer: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'],
      lastMessage: ['[data-message-author-role="assistant"]:last-of-type'],
      // Etiqueta del modo/modelo activo (solo para el contador local)
      modeProbes: [
        '[data-testid="model-switcher-dropdown-button"]',
        'button[aria-label*="model" i]',
        '[data-testid*="model-switcher"]',
      ],
    },

    gemini: {
      id: 'gemini', name: 'Gemini', hosts: ['gemini.google.com'],
      titleSuffix: /\s*[-–|]\s*Gemini\s*$/i,
      mainContainer: ['main', '[role="main"]', 'chat-window'],
      streaming: [
        'model-response[data-response-state="generating"]',
        '.response-container.streaming',
        '[data-test-id="streaming-indicator"]',
      ],
      stopButtonAttr: [
        'button[aria-label*="stop" i]',
        'button[data-test-id="stop-button"]',
        'button[mattooltip*="stop" i]',
      ],
      toolRunning: ['[aria-busy="true"]', '[role="progressbar"]', 'mat-progress-bar', '.loading-indicator'],
      toolTextScope: 'model-response, [data-test-id], message-content',
      dialogs: ['[role="dialog"]', '[role="alertdialog"]', 'mat-dialog-container'],
      errors: ['[role="alert"]', '.error-container'],
      authWall: ['input[type="password"]'],
      composer: ['rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'],
      lastMessage: ['model-response:last-of-type', '.conversation-container:last-of-type'],
      modeProbes: ['[data-test-id="bard-mode-menu-button"]', 'button[aria-label*="model" i]'],
    },
  };

  const STOP_WORDS = [
    'stop',
    'detener', 'parar', 'interrumpir',
    'interromper',
    'arrêter', 'arreter', 'interrompre',
    'stopp', 'anhalten', 'abbrechen',
    'ferma', 'interrompi',
  ];
  const TOOL_WORDS = [
    'running', 'searching', 'working', 'analyzing', 'thinking', 'reasoning',
    'ejecutando', 'buscando', 'analizando', 'pensando', 'razonando',
    'executando', 'pesquisando', 'analisando',
    'exécution', 'execution', 'recherche', 'analyse', 'réflexion',
    'wird ausgeführt', 'suche', 'analysiere',
    'esecuzione', 'ricerca', 'analisi',
  ];

  function providerFor(hostname) {
    const h = (hostname || '').toLowerCase();
    for (const p of Object.values(PROVIDERS)) {
      if (p.hosts.some((host) => h === host || h.endsWith('.' + host))) return p;
    }
    return null;
  }

  let CURRENT = null;
  function current() {
    if (!CURRENT) {
      try { CURRENT = providerFor(root.location && root.location.hostname); } catch (_e) { CURRENT = null; }
    }
    return CURRENT;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const st = root.getComputedStyle ? root.getComputedStyle(el) : null;
    if (!st) return true;
    return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
  }

  function q(selectors, scope) {
    const base = scope || root.document;
    if (!base || !selectors) return null;
    for (const sel of selectors) {
      try {
        const el = base.querySelector(sel);
        if (el && isVisible(el)) return el;
      } catch (_e) { /* selector no soportado */ }
    }
    return null;
  }

  function probeStopButton(P) {
    if (q(P.stopButtonAttr)) return true;
    const doc = root.document;
    if (!doc) return false;
    const buttons = doc.querySelectorAll('button[aria-label], button[title]');
    for (const b of buttons) {
      const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase();
      if (STOP_WORDS.some((w) => label.includes(w)) && isVisible(b)) return true;
    }
    return false;
  }

  function probeToolRunning(P, main) {
    if (!main) return false;
    if (q(P.toolRunning, main)) return true;
    try {
      const cards = main.querySelectorAll(P.toolTextScope);
      for (const c of cards) {
        if (!isVisible(c)) continue;
        const t = (c.textContent || '').slice(0, 400).toLowerCase();
        if (TOOL_WORDS.some((w) => t.includes(w)) &&
            (c.querySelector('svg') || c.getAttribute('aria-busy') != null)) return true;
      }
    } catch (_e) { /* noop */ }
    return false;
  }

  let _lastMsgLen = -1;
  function probeContentGrowing(P, main) {
    const el = q(P.lastMessage, main) || (main && main.lastElementChild ? main.lastElementChild : null);
    if (!el) { _lastMsgLen = -1; return false; }
    const len = (el.textContent || '').length;
    const grew = _lastMsgLen >= 0 && len > _lastMsgLen;
    _lastMsgLen = len;
    return grew;
  }

  function probeDialog(P) {
    const dlg = q(P.dialogs);
    if (!dlg) return false;
    const btn = dlg.querySelector('button');
    return !!(btn && isVisible(btn));
  }

  function probeAuthWall(P) {
    if (q(P.authWall)) return true;
    try {
      const href = root.location ? root.location.href : '';
      return /\/(login|sign[-_]?in|auth)\b/i.test(href);
    } catch (_e) { return false; }
  }

  function getConversationTitle(P) {
    try {
      const t = root.document ? root.document.title : '';
      return t.replace(P.titleSuffix, '').trim() || null;
    } catch (_e) { return null; }
  }

  function detect() {
    const P = current();
    if (!P) {
      return {
        provider: null, providerName: null,
        activity: { streaming: false, stopButton: false, toolRunning: false, contentGrowing: false },
        attention: { dialog: false, error: false, authWall: false },
        context: { composerReady: false, conversationTitle: null },
        online: true, confidence: 0, detectorVersion: DETECTOR_VERSION,
      };
    }

    const main = q(P.mainContainer) || (root.document ? root.document.body : null);

    const streaming = !!q(P.streaming);
    const stopButton = probeStopButton(P);
    const toolRunning = probeToolRunning(P, main);
    const contentGrowing = probeContentGrowing(P, main);

    const dialog = probeDialog(P);
    const error = !!q(P.errors, main || undefined);
    const authWall = probeAuthWall(P);

    const composerReady = !!q(P.composer);
    const conversationTitle = getConversationTitle(P);

    let anchors = 0;
    if (main && main !== (root.document && root.document.body)) anchors++;
    if (composerReady) anchors++;
    if (conversationTitle) anchors++;

    return {
      provider: P.id,
      providerName: P.name,
      activity: { streaming, stopButton, toolRunning, contentGrowing },
      attention: { dialog, error, authWall },
      context: { composerReady, conversationTitle },
      online: root.navigator ? root.navigator.onLine !== false : true,
      confidence: anchors / 3,
      detectorVersion: DETECTOR_VERSION,
    };
  }

  function resetInternal() { _lastMsgLen = -1; }

  return {
    detect, resetInternal, providerFor, current,
    PROVIDERS, STOP_WORDS, TOOL_WORDS, DETECTOR_VERSION, isVisible,
  };
});
