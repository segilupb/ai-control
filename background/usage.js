/*
 * Claude Control — background/usage.js
 * Módulo B: uso de Claude vía la API interna de claude.ai (reimplementación
 * propia del mecanismo verificado en la auditoría; sin copiar código).
 *
 *   1) GET https://claude.ai/api/organizations   (cookies de sesión del navegador)
 *      → organización con capability "chat" → orgId cacheado.
 *   2) GET https://claude.ai/api/organizations/{orgId}/usage
 *      → { five_hour: {utilization, resets_at}, seven_day: {utilization, resets_at} }
 *
 * ADVERTENCIA DOCUMENTADA (docs/FRAGILITY.md): endpoint privado sin contrato.
 * Por eso este módulo:
 *   - valida el shape y degrada a estado de error SIN romper el Módulo A;
 *   - invalida el orgId cacheado ante 401/403/404 y reintenta el descubrimiento
 *     UNA vez (cuenta/organización cambiada);
 *   - jamás hace scraping ni abre pestañas como fallback (descartado en auditoría);
 *   - todo queda en el navegador: cero peticiones a terceros.
 *
 * Factory con dependencias inyectadas → testeable en Node (tests/test-usage.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.createUsageMonitor = api.createUsageMonitor;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BASE = 'https://claude.ai/api';
  const FRESH_MS = 5 * 60 * 1000;        // dato "fresco": no re-consultar
  const DEFAULT_THRESHOLDS = { session: 80, weekly: 80 };

  function createUsageMonitor(deps) {
    const d = Object.assign(
      {
        now: () => Date.now(),
        // fetchFn(url) → Promise<{ok, status, json()}> — inyectable en tests
        fetchFn: null,
        storageGet: async () => ({}),
        storageSet: async () => {},
        // notifyThreshold({kind:'session'|'weekly', utilization, resetsAt})
        notifyThreshold: () => {},
        getSettings: async () => ({}),
      },
      deps || {}
    );

    async function http(url) {
      const fn = d.fetchFn || ((u) => fetch(u, { credentials: 'include' }));
      return fn(url);
    }

    // ── Descubrimiento de organización ────────────────────────────────
    async function discoverOrgId() {
      const res = await http(`${BASE}/organizations`);
      if (!res.ok) {
        const err = new Error(`organizations HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const orgs = await res.json();
      if (!Array.isArray(orgs)) throw new Error('organizations: shape inesperado');
      const chatOrg = orgs.find(
        (o) => o && Array.isArray(o.capabilities) && o.capabilities.includes('chat') && o.uuid
      ) || orgs.find((o) => o && o.uuid);
      if (!chatOrg) throw new Error('sin organización con capability chat');
      await d.storageSet({ cc_usage_orgId: chatOrg.uuid });
      return chatOrg.uuid;
    }

    async function getOrgId() {
      const st = await d.storageGet(['cc_usage_orgId']);
      if (st && st.cc_usage_orgId) return st.cc_usage_orgId;
      return discoverOrgId();
    }

    async function invalidateOrgId() {
      await d.storageSet({ cc_usage_orgId: null });
    }

    // ── Validación de shape (endpoint privado: no confiar) ───────────
    function parseWindow(w) {
      if (!w || typeof w !== 'object') return null;
      const utilization = Number(w.utilization);
      if (!Number.isFinite(utilization)) return null;
      const resetsAt = typeof w.resets_at === 'string' ? w.resets_at : null;
      return {
        utilization: Math.max(0, Math.min(100, utilization)),
        resetsAt,
        remaining: Math.max(0, 100 - utilization),
      };
    }

    function parseUsage(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const fiveHour = parseWindow(raw.five_hour);
      const sevenDay = parseWindow(raw.seven_day);
      if (!fiveHour && !sevenDay) return null; // nada usable
      return { fiveHour, sevenDay };
    }

    // ── Fetch principal con invalidación y reintento único ───────────
    async function fetchUsageOnce(orgId) {
      const res = await http(`${BASE}/organizations/${orgId}/usage`);
      if (!res.ok) {
        const err = new Error(`usage HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }

    async function refresh(opts = {}) {
      const { force = false } = opts;
      const now = d.now();

      const cached = await d.storageGet(['cc_usage_data', 'cc_usage_fetchedAt']);
      if (
        !force &&
        cached && cached.cc_usage_data &&
        typeof cached.cc_usage_fetchedAt === 'number' &&
        now - cached.cc_usage_fetchedAt < FRESH_MS
      ) {
        return { ok: true, fromCache: true, data: cached.cc_usage_data, fetchedAt: cached.cc_usage_fetchedAt };
      }

      let orgId;
      try {
        orgId = await getOrgId();
      } catch (e) {
        return fail(`No se pudo identificar la organización: ${e.message}`, e.status);
      }

      let raw;
      try {
        raw = await fetchUsageOnce(orgId);
      } catch (e) {
        if (e.status === 401 || e.status === 403 || e.status === 404) {
          // orgId muerto o sesión caducada → invalidar y reintentar UNA vez.
          await invalidateOrgId();
          try {
            const freshOrg = await discoverOrgId();
            raw = await fetchUsageOnce(freshOrg);
          } catch (e2) {
            const authish = e2.status === 401 || e2.status === 403;
            return fail(
              authish
                ? 'Sesión no válida: abre claude.ai e inicia sesión'
                : `Error al consultar el uso: ${e2.message}`,
              e2.status
            );
          }
        } else {
          return fail(`Error al consultar el uso: ${e.message}`, e.status);
        }
      }

      const data = parseUsage(raw);
      if (!data) {
        return fail('La API de uso devolvió un formato desconocido (posible cambio de Anthropic)');
      }

      await d.storageSet({ cc_usage_data: data, cc_usage_fetchedAt: now, cc_usage_error: null });
      await checkThresholds(data);
      return { ok: true, fromCache: false, data, fetchedAt: now };

      async function fail(message, status) {
        await d.storageSet({ cc_usage_error: { message, status: status ?? null, at: now } });
        return { ok: false, error: message, status: status ?? null };
      }
    }

    // ── Umbrales con anti-repetición por cruce ────────────────────────
    async function checkThresholds(data) {
      const settings = (await d.getSettings()) || {};
      const usageCfg = settings.usage || {};
      if (usageCfg.thresholdsEnabled === false) return;
      const th = Object.assign({}, DEFAULT_THRESHOLDS, usageCfg.thresholds || {});

      const st = await d.storageGet(['cc_usage_notified']);
      const notified = (st && st.cc_usage_notified) || { session: false, weekly: false };
      const next = { ...notified };

      const checks = [
        { kind: 'session', win: data.fiveHour, limit: th.session },
        { kind: 'weekly', win: data.sevenDay, limit: th.weekly },
      ];
      for (const c of checks) {
        if (!c.win) continue;
        const above = c.win.utilization >= c.limit;
        if (above && !notified[c.kind]) {
          d.notifyThreshold({ kind: c.kind, utilization: c.win.utilization, resetsAt: c.win.resetsAt });
        }
        next[c.kind] = above; // se re-arma al bajar del umbral
      }
      await d.storageSet({ cc_usage_notified: next });
    }

    // ── Lectura para el popup ─────────────────────────────────────────
    async function getState() {
      const st = await d.storageGet(['cc_usage_data', 'cc_usage_fetchedAt', 'cc_usage_error']);
      return {
        data: (st && st.cc_usage_data) || null,
        fetchedAt: (st && st.cc_usage_fetchedAt) || null,
        error: (st && st.cc_usage_error) || null,
        stale: !st || !st.cc_usage_fetchedAt || d.now() - st.cc_usage_fetchedAt >= FRESH_MS,
      };
    }

    return { refresh, getState, discoverOrgId, parseUsage, FRESH_MS };
  }

  return { createUsageMonitor };
});
