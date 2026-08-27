/*
 * AI Control — background/usage-multi.js
 * Obtención de uso para ChatGPT (wham) y Gemini (/usage), normalizada por
 * usage-adapters.js. Claude sigue en background/usage.js (ya existente).
 *
 * Principios heredados de la auditoría:
 *  · codex-quota-monitor → accessToken desde client-bootstrap con fallback a
 *    /api/auth/session, reintento único ante 401/403, y NUNCA persistir el
 *    token en disco: vive en memoria del service worker (se pierde al dormir,
 *    se vuelve a pedir; es barato y no deja credenciales guardadas).
 *  · gemini-usage-bar → fetch de /usage + parseo del HTML. El fallback iframe
 *    de ese repo no se replica: requiere declarativeNetRequest para quitar
 *    CSP y aquí no compensa. Si el fetch falla, se degrada a 'unavailable'.
 *
 * Cada fuente conserva su último dato bueno (last-known-good) y lo marca
 * `stale` en vez de dejar el panel vacío.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.createUsageMulti = api.createUsageMulti;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WHAM_URL = 'https://chatgpt.com/backend-api/wham/usage';
  const AUTH_SESSION_URLS = [
    'https://chatgpt.com/api/auth/session',
    'https://chatgpt.com/backend-api/auth/session',
  ];
  const GEMINI_BASE = 'https://gemini.google.com';
  /**
   * Google separa las cuentas por índice en la URL: /u/0/ es la cuenta por
   * defecto, /u/1/ la segunda, etc. Sin el índice correcto se consulta SIEMPRE
   * la cuenta por defecto, que puede no ser la que usas para Gemini.
   */
  function geminiUsageUrl(accountIndex) {
    const i = Number(accountIndex);
    return Number.isInteger(i) && i > 0
      ? `${GEMINI_BASE}/u/${i}/usage`
      : `${GEMINI_BASE}/usage`;
  }

  function createUsageMulti(deps) {
    const d = Object.assign({
      now: () => Date.now(),
      fetchFn: null,
      adapters: null,              // usage-adapters
      parseHTML: null,             // (html) → Document
      storageGet: async () => ({}),
      storageSet: async () => {},
      uiLanguage: () => 'en-US',
      getGeminiAccountIndex: async () => 0,
    }, deps || {});

    const A = d.adapters;
    const http = (url, init) => (d.fetchFn || ((u, i) => fetch(u, i)))(url, init);

    // Token SOLO en memoria (nunca storage): se pierde al dormir el SW y se
    // vuelve a pedir. Evita guardar credenciales en disco.
    let memToken = null;

    /* ── ChatGPT ───────────────────────────────────────────────────── */
    function extractToken(data) {
      return (data && (data.accessToken || data.access_token ||
        (data.session && (data.session.accessToken || data.session.access_token)) ||
        data.token)) || null;
    }

    async function refreshToken() {
      for (const url of AUTH_SESSION_URLS) {
        try {
          const res = await http(url, { credentials: 'include', headers: { accept: 'application/json' } });
          if (!res.ok) continue;
          const token = extractToken(await res.json());
          if (token) { memToken = token; return token; }
        } catch (_e) { /* siguiente endpoint */ }
      }
      return null;
    }

    function whamHeaders(token) {
      const h = { accept: 'application/json', 'oai-language': d.uiLanguage() };
      if (token) h.authorization = `Bearer ${token}`;
      return h;
    }

    async function fetchChatGPT() {
      const now = d.now();
      try {
        let token = memToken;
        let res = await http(WHAM_URL, { credentials: 'include', headers: whamHeaders(token) });

        // 401/403 → refrescar token UNA vez y reintentar (patrón del repo auditado)
        if (res.status === 401 || res.status === 403) {
          memToken = null;
          token = await refreshToken();
          if (token) {
            res = await http(WHAM_URL, { credentials: 'include', headers: whamHeaders(token) });
          }
        }

        if (!res.ok) {
          return fallback('chatgpt', 'wham', A.statusFromHttp(res.status), now, res.status);
        }
        const snap = A.fromChatGPTWham(await res.json(), { now });
        if (snap.status === 'ok') await remember('chatgpt', snap);
        else return fallback('chatgpt', 'wham', 'error', now, 'shape');
        return snap;
      } catch (_e) {
        return fallback('chatgpt', 'wham', 'error', now, 'network');
      }
    }

    /* ── Gemini ────────────────────────────────────────────────────── */
    async function fetchGemini(opts = {}) {
      const now = d.now();
      // 'auto' → índice detectado de las pestañas abiertas de Gemini
      const idx = opts.accountIndex !== undefined
        ? opts.accountIndex
        : await d.getGeminiAccountIndex();
      try {
        const res = await http(`${geminiUsageUrl(idx)}?t=${now}`, {
          credentials: 'include',
          headers: { accept: 'text/html' },
        });
        if (!res.ok) {
          return fallback('gemini', 'usage-page', A.statusFromHttp(res.status), now, res.status);
        }
        const html = await res.text();
        // Redirección silenciosa a login: el HTML no trae la página de uso.
        if (/accounts\.google\.com|<title>[^<]*sign in/i.test(html.slice(0, 4000))) {
          return fallback('gemini', 'usage-page', 'auth', now, 'redirect-login');
        }
        const doc = d.parseHTML ? d.parseHTML(html) : null;
        const snap = A.parseGeminiDocument(doc, { now });
        if (snap.status === 'ok') {
          snap.extras = { ...(snap.extras || {}), accountIndex: idx || 0 };
          await remember('gemini', snap);
        }
        else return fallback('gemini', 'usage-page', snap.status, now, snap.error);
        return snap;
      } catch (_e) {
        return fallback('gemini', 'usage-page', 'error', now, 'network');
      }
    }

    /* ── Last-known-good ───────────────────────────────────────────── */
    const key = (p) => `cc_usage_lkg_${p}`;

    async function remember(provider, snapshot) {
      await d.storageSet({ [key(provider)]: snapshot });
    }

    async function fallback(provider, source, status, now, error) {
      const st = await d.storageGet([key(provider)]);
      const last = st && st[key(provider)];
      if (last && last.windows && last.windows.length) {
        // Nunca dejar el panel vacío: se muestra el último dato bueno marcado.
        return { ...last, status: 'stale', staleReason: status, error: error || null };
      }
      return { provider, source, status, fetchedAt: now, windows: [], extras: {}, error: error || null };
    }

    async function cached(provider) {
      const st = await d.storageGet([key(provider)]);
      const last = st && st[key(provider)];
      return last ? A.markStale(last, d.now()) : null;
    }

    return { fetchChatGPT, fetchGemini, cached, geminiUsageUrl, WHAM_URL, GEMINI_BASE };
  }

  return { createUsageMulti };
});
