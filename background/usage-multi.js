/*
 * AI Control — background/usage-multi.js
 * Obtención de uso para ChatGPT (Work/Codex vía wham), normalizada por
 * usage-adapters.js. Claude sigue en background/usage.js (ya existente).
 *
 * Principios heredados de la auditoría:
 *  · codex-quota-monitor → accessToken desde client-bootstrap con fallback a
 *    /api/auth/session, reintento único ante 401/403, y NUNCA persistir el
 *    token en disco: vive en memoria del service worker (se pierde al dormir,
 *    se vuelve a pedir; es barato y no deja credenciales guardadas).
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

  function createUsageMulti(deps) {
    const d = Object.assign({
      now: () => Date.now(),
      fetchFn: null,
      adapters: null,              // usage-adapters
      parseHTML: null,             // (html) → Document
      storageGet: async () => ({}),
      storageSet: async () => {},
      uiLanguage: () => 'en-US',
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

    async function fetchChatGPT(opts = {}) {
      const now = d.now();
      if (await inCooldown('chatgpt', now)) {
        return fallback('chatgpt', 'wham', 'error', now, 'cooldown');
      }
      if (!opts.force && await tooSoon('chatgpt', now)) {
        return fallback('chatgpt', 'wham', 'ok', now, 'throttled');
      }
      await markFetched('chatgpt', now);
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
          if (res.status === 429) await setCooldown('chatgpt', now);
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

    /* ── Suelo de frecuencia: jamás consultar más seguido que esto ─── */
    const MIN_INTERVAL_MS = { chatgpt: 10 * 60 * 1000 };
    const lastKey = (p) => `cc_usage_lastfetch_${p}`;

    async function tooSoon(provider, now) {
      const st = await d.storageGet([lastKey(provider)]);
      const last = st && st[lastKey(provider)];
      const floor = MIN_INTERVAL_MS[provider] || 10 * 60 * 1000;
      return typeof last === 'number' && (now - last) < floor;
    }
    async function markFetched(provider, now) {
      await d.storageSet({ [lastKey(provider)]: now });
    }

    /* ── Enfriamiento tras un bloqueo (429 / límite del proveedor) ─── */
    const COOLDOWN_MS = 45 * 60 * 1000;   // 45 min sin volver a preguntar
    const cdKey = (p) => `cc_usage_cooldown_${p}`;

    async function setCooldown(provider, now) {
      await d.storageSet({ [cdKey(provider)]: now + COOLDOWN_MS });
    }
    async function inCooldown(provider, now) {
      const st = await d.storageGet([cdKey(provider)]);
      const until = st && st[cdKey(provider)];
      return typeof until === 'number' && now < until;
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

    return {
      fetchChatGPT, cached,
      setCooldown, inCooldown, tooSoon, COOLDOWN_MS, MIN_INTERVAL_MS,
      WHAM_URL,
    };
  }

  return { createUsageMulti };
});
