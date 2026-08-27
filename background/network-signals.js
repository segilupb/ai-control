/*
 * AI Control — background/network-signals.js
 * Convierte chrome.webRequest en EVIDENCIA para la FSM. Nunca notifica.
 *
 * Patrones tomados de aicq (LLM_ENDPOINTS) y verificables en vivo:
 *   ChatGPT → /backend-api/f/conversation  y  /backend-api/conversation
 *   Claude  → /api/organizations/*./chat_conversations/*./completion
 *
 * Diferencia clave con aicq: allí `onCompleted` dispara la notificación
 * directamente, lo que produce falsos positivos con tool calls y cadenas de
 * requests. Aquí `onCompleted` solo emite NETWORK_COMPLETE hacia el content
 * script; la FSM decide, y solo puede completar si además el DOM está quieto.
 *
 * Factory con dependencias inyectadas → testeable en Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.createNetworkSignals = api.createNetworkSignals;
  root.__claudeControlBg.NETWORK_PATTERNS = api.NETWORK_PATTERNS;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NETWORK_PATTERNS = {
    chatgpt: [
      'https://chatgpt.com/backend-api/f/conversation*',
      'https://chatgpt.com/backend-api/conversation*',
      'https://chat.openai.com/backend-api/conversation*',
    ],
    claude: [
      'https://claude.ai/api/organizations/*/chat_conversations/*/completion*',
      'https://claude.ai/api/organizations/*/completion*',
    ],
  };

  const ALL_PATTERNS = Object.values(NETWORK_PATTERNS).flat();

  function providerForUrl(url) {
    if (typeof url !== 'string') return null;
    if (/^https:\/\/(chatgpt\.com|chat\.openai\.com)\/backend-api\/(f\/)?conversation/.test(url)) return 'chatgpt';
    if (/^https:\/\/claude\.ai\/api\/organizations\/[^/]+\/(chat_conversations\/[^/]+\/)?completion/.test(url)) return 'claude';
    return null;
  }

  function createNetworkSignals(deps) {
    const d = Object.assign({
      now: () => Date.now(),
      send: async () => {},   // send(tabId, message)
    }, deps || {});

    /** tabId → { inFlight:Set<requestId>, lastStartedAt, lastCompletedAt, provider } */
    const perTab = new Map();

    function entry(tabId) {
      if (!perTab.has(tabId)) {
        perTab.set(tabId, { inFlight: new Set(), lastStartedAt: 0, lastCompletedAt: 0, provider: null });
      }
      return perTab.get(tabId);
    }

    function onBeforeRequest(details) {
      const provider = providerForUrl(details.url);
      if (!provider || details.tabId == null || details.tabId < 0) return;
      const e = entry(details.tabId);
      e.provider = provider;
      e.inFlight.add(details.requestId);
      e.lastStartedAt = d.now();
      d.send(details.tabId, {
        ns: 'cc', type: 'CC_NET', phase: 'start',
        provider, inFlight: e.inFlight.size, at: e.lastStartedAt,
      });
    }

    function finish(details, phase) {
      const provider = providerForUrl(details.url);
      if (!provider || details.tabId == null || details.tabId < 0) return;
      const e = entry(details.tabId);
      e.inFlight.delete(details.requestId);
      e.lastCompletedAt = d.now();
      d.send(details.tabId, {
        ns: 'cc',
        type: 'CC_NET',
        // NETWORK_COMPLETE es EVIDENCIA, no una transición: la FSM sigue
        // exigiendo que el DOM esté quieto durante la ventana de estabilidad.
        phase: phase === 'error' ? 'error' : 'complete',
        provider,
        statusCode: details.statusCode ?? null,
        inFlight: e.inFlight.size,
        at: e.lastCompletedAt,
      });
    }

    const onCompleted = (details) => finish(details, 'complete');
    const onErrorOccurred = (details) => finish(details, 'error');

    function forget(tabId) { perTab.delete(tabId); }
    function state(tabId) { return perTab.get(tabId) || null; }

    /** Registra los listeners reales (no-op fuera de la extensión). */
    function attach(chromeApi) {
      const c = chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
      if (!c || !c.webRequest) return false;
      const filter = { urls: ALL_PATTERNS };
      c.webRequest.onBeforeRequest.addListener(onBeforeRequest, filter);
      c.webRequest.onCompleted.addListener(onCompleted, filter);
      c.webRequest.onErrorOccurred.addListener(onErrorOccurred, filter);
      return true;
    }

    return {
      attach, onBeforeRequest, onCompleted, onErrorOccurred,
      forget, state, providerForUrl, ALL_PATTERNS,
    };
  }

  return { createNetworkSignals, NETWORK_PATTERNS, providerForUrl, ALL_PATTERNS };
});
