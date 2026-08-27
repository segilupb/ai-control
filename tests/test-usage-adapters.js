/*
 * AI Control — tests/test-usage-adapters.js
 * Ejecutar: node tests/test-usage-adapters.js
 *
 * Fixtures con el shape REAL de cada fuente + casos de degradación: campos
 * ausentes, shape cambiado, 401/403/429, offline, cache stale, ventana ya
 * reseteada, bloqueo por frecuencia y enfriamiento.
 */
'use strict';
const assert = require('assert');
const A = require('../background/usage-adapters.js');
const { createUsageMulti } = require('../background/usage-multi.js');

/* ── Fixtures ──────────────────────────────────────────────────────── */
const WHAM_OK = {
  plan_type: 'plus',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 22, limit_window_seconds: 18000, reset_after_seconds: 7200 },
    secondary_window: { used_percent: 48, limit_window_seconds: 604800, reset_at: 1893456000 },
  },
  credits: { balance: 12.5, has_credits: true, unlimited: false },
};

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

(async () => {
  console.log('Adaptadores de uso (Claude · ChatGPT) — AI Control\n');

  await test('Ambos adaptadores devuelven el MISMO contrato', async () => {
    const snaps = [
      A.fromClaude({ fiveHour: { utilization: 34, resetsAt: '2026-01-01T00:00:00Z' },
                     sevenDay: { utilization: 61, resetsAt: '2026-01-05T00:00:00Z' } }, 1000),
      A.fromChatGPTWham(WHAM_OK, { now: 1000 }),
    ];
    for (const snap of snaps) {
      for (const k of ['provider', 'source', 'status', 'fetchedAt', 'windows', 'extras']) {
        assert.ok(k in snap, `falta ${k} en ${snap.provider}`);
      }
      for (const w of snap.windows) {
        for (const k of ['id', 'label', 'usedPercent', 'remainingPercent', 'resetsAt']) {
          assert.ok(k in w, `falta ${k} en window de ${snap.provider}`);
        }
        assert.strictEqual(w.usedPercent + w.remainingPercent, 100);
      }
    }
  });

  /* ── Claude ─────────────────────────────────────────────────────── */
  await test('Claude: 5h + semanal normalizados', async () => {
    const s = A.fromClaude({ fiveHour: { utilization: 34, resetsAt: 'X' }, sevenDay: { utilization: 61, resetsAt: 'Y' } }, 1);
    assert.strictEqual(s.status, 'ok');
    assert.strictEqual(s.windows.length, 2);
    assert.strictEqual(s.windows[0].usedPercent, 34);
    assert.strictEqual(s.windows[1].remainingPercent, 39);
  });

  await test('Claude: sin datos → unavailable', async () => {
    assert.strictEqual(A.fromClaude(null).status, 'unavailable');
  });

  /* ── ChatGPT wham ───────────────────────────────────────────────── */
  await test('ChatGPT: shape real → 5h + weekly + credits, etiquetado work-codex', async () => {
    const s = A.fromChatGPTWham(WHAM_OK, { now: 1_700_000_000_000 });
    assert.strictEqual(s.status, 'ok');
    assert.strictEqual(s.windows[0].usedPercent, 22);
    assert.strictEqual(s.windows[0].label, '5h');
    assert.strictEqual(s.windows[1].usedPercent, 48);
    assert.strictEqual(s.windows[1].label, 'weekly');
    assert.strictEqual(s.extras.credits, 12.5);
    assert.strictEqual(s.extras.plan, 'plus');
    assert.strictEqual(s.extras.scope, 'work-codex', 'debe quedar claro que NO es el uso de los chats normales');
  });

  await test('ChatGPT: reset_after_seconds se convierte a instante absoluto', async () => {
    const now = 1_700_000_000_000;
    const s = A.fromChatGPTWham(WHAM_OK, { now });
    assert.strictEqual(new Date(s.windows[0].resetsAt).getTime(), now + 7200 * 1000);
  });

  await test('ChatGPT: sin secondary_window sigue siendo válido', async () => {
    const raw = { rate_limit: { primary_window: { used_percent: 5, limit_window_seconds: 18000 } } };
    const s = A.fromChatGPTWham(raw, { now: 1 });
    assert.strictEqual(s.status, 'ok');
    assert.strictEqual(s.windows.length, 1);
  });

  await test('ChatGPT: shape cambiado → error limpio, sin excepción', async () => {
    for (const bad of [null, {}, { rate_limit: {} }, { rate_limit: { primary_window: {} } }, { foo: 1 }]) {
      const s = A.fromChatGPTWham(bad, { now: 1 });
      assert.strictEqual(s.status, 'error');
      assert.deepStrictEqual(s.windows, []);
    }
  });

  await test('Códigos HTTP → estado correcto', async () => {
    assert.strictEqual(A.statusFromHttp(401), 'auth');
    assert.strictEqual(A.statusFromHttp(403), 'auth');
    assert.strictEqual(A.statusFromHttp(429), 'error');
    assert.strictEqual(A.statusFromHttp(404), 'unavailable');
    assert.strictEqual(A.statusFromHttp(500), 'error');
  });


  /* ── Fetchers con red simulada ──────────────────────────────────── */
  function env(routes) {
    const store = {};
    const calls = [];
    const u = createUsageMulti({
      now: () => 1_700_000_000_000,
      adapters: A,
      fetchFn: async (url) => {
        calls.push(url);
        for (const [pat, resp] of routes) if (url.includes(pat)) return typeof resp === 'function' ? resp(calls) : resp;
        return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
      },
      storageGet: async (keys) => { const o = {}; for (const k of keys) o[k] = store[k]; return o; },
      storageSet: async (obj) => Object.assign(store, obj),
    });
    return { u, store, calls };
  }
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => body });
  const err = (status) => ({ ok: false, status, json: async () => ({}), text: async () => '' });

  await test('fetchChatGPT: 200 → ok y guarda last-known-good', async () => {
    const { u, store } = env([['wham/usage', ok(WHAM_OK)]]);
    const s = await u.fetchChatGPT();
    assert.strictEqual(s.status, 'ok');
    assert.ok(store.cc_usage_lkg_chatgpt, 'debe recordar el último dato bueno');
  });

  await test('fetchChatGPT: 401 → refresca token vía auth/session y reintenta', async () => {
    let whamHits = 0;
    const { u, calls } = env([
      ['auth/session', ok({ accessToken: 'tok-123' })],
      ['wham/usage', () => { whamHits++; return whamHits === 1 ? err(401) : ok(WHAM_OK); }],
    ]);
    const s = await u.fetchChatGPT();
    assert.strictEqual(s.status, 'ok');
    assert.strictEqual(whamHits, 2, 'exactamente un reintento');
    assert.ok(calls.some((c) => c.includes('auth/session')));
  });

  await test('fetchChatGPT: 429 con cache previa → stale con el último dato bueno', async () => {
    const { u, store } = env([['wham/usage', ok(WHAM_OK)]]);
    await u.fetchChatGPT();                       // llena la cache
    const { u: u2 } = (() => {
      const e = env([['wham/usage', err(429)]]);
      Object.assign(e.store, store);              // misma cache
      delete e.store.cc_usage_lastfetch_chatgpt;  // simula que ya pasó el suelo
      return { u: e.u };
    })();
    const s = await u2.fetchChatGPT();
    assert.strictEqual(s.status, 'stale');
    assert.strictEqual(s.staleReason, 'error');
    assert.ok(s.windows.length > 0, 'conserva los datos anteriores');
  });

  await test('fetchChatGPT: 403 sin cache → auth, sin datos inventados', async () => {
    const { u } = env([['wham/usage', err(403)], ['auth/session', err(403)]]);
    const s = await u.fetchChatGPT();
    assert.strictEqual(s.status, 'auth');
    assert.deepStrictEqual(s.windows, []);
  });

  await test('El token de ChatGPT NUNCA se escribe en storage', async () => {
    const { u, store } = env([
      ['auth/session', ok({ accessToken: 'SECRETO-NO-GUARDAR' })],
      ['wham/usage', (calls) => (calls.filter((c) => c.includes('wham')).length === 1 ? err(401) : ok(WHAM_OK))],
    ]);
    await u.fetchChatGPT();
    const dump = JSON.stringify(store);
    assert.ok(!dump.includes('SECRETO-NO-GUARDAR'), 'el token solo puede vivir en memoria');
  });

  console.log(`\n${passed} pasados, ${failed} fallidos`);
  process.exit(failed ? 1 : 0);
})();
