/*
 * AI Control — background/usage-adapters.js
 * Cada proveedor convierte SU fuente al mismo contrato. El popup nunca conoce
 * las APIs concretas.
 *
 *   { provider, source, status: 'ok'|'stale'|'unavailable'|'auth'|'error',
 *     fetchedAt, windows: [{ id, label, usedPercent, remainingPercent, resetsAt }],
 *     extras }
 *
 * Fuentes (verificadas contra los repos de referencia, ver docs/USAGE-SOURCES.md):
 *  · Claude  → GET /api/organizations → /api/organizations/{id}/usage   (oficial)
 *  · ChatGPT → GET /backend-api/wham/usage  (oficial, SOLO Work/Codex)
 *
 * Todos son endpoints privados sin contrato: se valida el shape, se degrada
 * limpio y se conserva el último dato bueno marcándolo `stale`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.usageAdapters = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clampPct = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, n));
  };

  function mkWindow(id, label, usedPercent, resetsAt) {
    const used = clampPct(usedPercent);
    if (used === null) return null;
    return {
      id,
      label,
      usedPercent: used,
      remainingPercent: Math.max(0, 100 - used),
      resetsAt: resetsAt || null,
    };
  }

  const result = (provider, source, status, extra = {}) => ({
    provider, source, status,
    fetchedAt: extra.fetchedAt || Date.now(),
    windows: extra.windows || [],
    extras: extra.extras || {},
    error: extra.error || null,
  });

  /* ═══ CLAUDE ═══════════════════════════════════════════════════════
     Fuente propia ya existente (background/usage.js). Aquí solo se
     traduce su salida al contrato común. */
  function fromClaude(data, fetchedAt) {
    if (!data) return result('claude', 'claude-api', 'unavailable');
    const windows = [];
    const five = data.fiveHour && mkWindow('session', '5h', data.fiveHour.utilization, data.fiveHour.resetsAt);
    const week = data.sevenDay && mkWindow('weekly', 'weekly', data.sevenDay.utilization, data.sevenDay.resetsAt);
    if (five) windows.push(five);
    if (week) windows.push(week);
    if (!windows.length) return result('claude', 'claude-api', 'error', { error: 'shape' });
    return result('claude', 'claude-api', 'ok', { windows, fetchedAt });
  }

  /* ═══ CHATGPT — /backend-api/wham/usage ════════════════════════════
     Shape confirmado en codex-quota-monitor:
       rate_limit.primary_window   { used_percent, limit_window_seconds,
                                     reset_after_seconds, reset_at }
       rate_limit.secondary_window { ídem }
       credits { balance, has_credits, unlimited }
       plan_type
     IMPORTANTE: esto es la cuota de Work/Codex, NO el uso de los chats
     normales. Se etiqueta como tal en la UI para no engañar. */
  function normalizeWhamWindow(w, id, now) {
    if (!w || typeof w !== 'object') return null;
    const used = clampPct(w.used_percent);
    if (used === null) return null;

    const secs = Number(w.limit_window_seconds) || null;
    const label = secs === 604800 ? 'weekly' : secs === 18000 ? '5h'
      : secs ? `${Math.round(secs / 3600)}h` : id;

    const resetAtSec = Number(w.reset_at) || null;
    const resetAfter = Number(w.reset_after_seconds) || null;
    const resetsAt = resetAtSec
      ? new Date(resetAtSec * 1000).toISOString()
      : resetAfter ? new Date(now + resetAfter * 1000).toISOString() : null;

    return mkWindow(id, label, used, resetsAt);
  }

  function fromChatGPTWham(raw, opts = {}) {
    const now = opts.now || Date.now();
    if (!raw || typeof raw !== 'object' || !raw.rate_limit) {
      return result('chatgpt', 'wham', 'error', { error: 'shape', fetchedAt: now });
    }
    const primary = normalizeWhamWindow(raw.rate_limit.primary_window, 'session', now);
    if (!primary) {
      return result('chatgpt', 'wham', 'error', { error: 'shape', fetchedAt: now });
    }
    const secondary = normalizeWhamWindow(raw.rate_limit.secondary_window, 'weekly', now);

    const credits = raw.credits || {};
    const balance = Number(credits.balance);
    const extras = {
      scope: 'work-codex',                       // la UI lo rotula así, nunca "todo ChatGPT"
      plan: typeof raw.plan_type === 'string' ? raw.plan_type : null,
      limitReached: Boolean(raw.rate_limit.limit_reached),
      allowed: raw.rate_limit.allowed !== false,
      credits: Number.isFinite(balance) ? balance : null,
      creditsUnlimited: Boolean(credits.unlimited),
    };

    return result('chatgpt', 'wham', 'ok', {
      windows: secondary ? [primary, secondary] : [primary],
      fetchedAt: now, extras,
    });
  }

  /* ═══ Helpers de estado ════════════════════════════════════════════ */
  const STALE_AFTER_MS = 30 * 60 * 1000;

  function markStale(snapshot, now = Date.now()) {
    if (!snapshot || snapshot.status !== 'ok') return snapshot;
    const age = now - (snapshot.fetchedAt || 0);
    const expired = snapshot.windows.some(
      (w) => w.resetsAt && new Date(w.resetsAt).getTime() <= now
    );
    if (age > STALE_AFTER_MS || expired) return { ...snapshot, status: 'stale' };
    return snapshot;
  }

  function statusFromHttp(status) {
    if (status === 401 || status === 403) return 'auth';
    if (status === 429) return 'error';
    if (status === 404) return 'unavailable';
    return 'error';
  }

  return {
    fromClaude, fromChatGPTWham,
    mkWindow, markStale, statusFromHttp, clampPct,
    STALE_AFTER_MS,
  };
});
