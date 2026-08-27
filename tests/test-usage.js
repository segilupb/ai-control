/*
 * Claude Control — tests/test-usage.js
 * Ejecutar: node tests/test-usage.js
 * Usage Monitor con fetch simulado: descubrimiento de org, cache y frescura,
 * invalidación ante 401/404 con reintento único, shape desconocido sin crash,
 * umbrales con anti-repetición por cruce.
 */
'use strict';
const assert = require('assert');
const { createUsageMonitor } = require('../background/usage.js');

const ORGS_OK = [
  { uuid: 'org-sin-chat', capabilities: ['api'] },
  { uuid: 'org-chat-123', capabilities: ['chat', 'api'] },
];
const USAGE_OK = {
  five_hour: { utilization: 68, resets_at: '2026-08-25T12:00:00Z' },
  seven_day: { utilization: 41, resets_at: '2026-08-28T23:30:00Z' },
};

function resp(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function makeEnv(routes, settings) {
  const store = {};
  let clock = 1_000_000;
  const calls = [];
  const notifications = [];
  const u = createUsageMonitor({
    now: () => clock,
    fetchFn: async (url) => {
      calls.push(url);
      for (const [pattern, handler] of routes) {
        if (url.includes(pattern)) return typeof handler === 'function' ? handler(url, calls) : handler;
      }
      return resp(500, {});
    },
    storageGet: async (keys) => {
      const out = {};
      for (const k of keys) out[k] = store[k];
      return out;
    },
    storageSet: async (obj) => Object.assign(store, obj),
    notifyThreshold: (p) => notifications.push(p),
    getSettings: async () => settings || {},
  });
  return { u, store, calls, notifications, tick: (ms) => { clock += ms; } };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

(async () => {
  console.log('Usage Monitor — Claude Control\n');

  await test('Descubrimiento: elige la org con capability chat y cachea el orgId', async () => {
    const { u, store, calls } = makeEnv([
      ['/organizations/org-chat-123/usage', resp(200, USAGE_OK)],
      ['/organizations', resp(200, ORGS_OK)],
    ]);
    const r = await u.refresh();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(store.cc_usage_orgId, 'org-chat-123');
    assert.strictEqual(r.data.fiveHour.utilization, 68);
    assert.strictEqual(r.data.sevenDay.remaining, 59);
    assert.ok(calls.some((c) => c.endsWith('/organizations')));
  });

  await test('Cache de frescura: segunda llamada <5 min no toca la red', async () => {
    const { u, calls, tick } = makeEnv([
      ['/organizations/org-chat-123/usage', resp(200, USAGE_OK)],
      ['/organizations', resp(200, ORGS_OK)],
    ]);
    await u.refresh();
    const callsAfterFirst = calls.length;
    tick(2 * 60 * 1000);
    const r2 = await u.refresh();
    assert.strictEqual(r2.fromCache, true);
    assert.strictEqual(calls.length, callsAfterFirst, 'sin peticiones nuevas');
  });

  await test('force=true salta el cache', async () => {
    const { u, calls, tick } = makeEnv([
      ['/organizations/org-chat-123/usage', resp(200, USAGE_OK)],
      ['/organizations', resp(200, ORGS_OK)],
    ]);
    await u.refresh();
    const n = calls.length;
    tick(1000);
    const r = await u.refresh({ force: true });
    assert.strictEqual(r.fromCache, false);
    assert.ok(calls.length > n);
  });

  await test('orgId muerto (404) → invalida, redescubre y reintenta UNA vez con éxito', async () => {
    let usageHits = 0;
    const { u, store } = makeEnv([
      ['/organizations/org-vieja/usage', resp(404, {})],
      ['/organizations/org-chat-123/usage', () => { usageHits++; return resp(200, USAGE_OK); }],
      ['/organizations', resp(200, ORGS_OK)],
    ]);
    store.cc_usage_orgId = 'org-vieja'; // cache envenenado
    const r = await u.refresh();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(store.cc_usage_orgId, 'org-chat-123');
    assert.strictEqual(usageHits, 1);
  });

  await test('Sesión caducada (401 persistente) → error accionable, sin bucles', async () => {
    const { u, calls } = makeEnv([
      ['/usage', resp(401, {})],
      ['/organizations', resp(401, {})],
    ]);
    const r = await u.refresh();
    assert.strictEqual(r.ok, false);
    assert.ok(/inicia sesión|organización/i.test(r.error));
    assert.ok(calls.length <= 3, `máximo descubrimiento+reintento, hubo ${calls.length}`);
  });

  await test('Shape desconocido (cambio de Anthropic) → error limpio, sin crash', async () => {
    const { u, store } = makeEnv([
      ['/organizations/org-chat-123/usage', resp(200, { totally: 'different' })],
      ['/organizations', resp(200, ORGS_OK)],
    ]);
    const r = await u.refresh();
    assert.strictEqual(r.ok, false);
    assert.ok(/formato desconocido/i.test(r.error));
    assert.ok(store.cc_usage_error, 'el error queda registrado para el popup');
  });

  await test('Shape parcial: solo five_hour presente → sigue siendo usable', async () => {
    const { u } = makeEnv([
      ['/organizations/org-chat-123/usage', resp(200, { five_hour: { utilization: 90.4, resets_at: 'x' } })],
      ['/organizations', resp(200, ORGS_OK)],
    ]);
    const r = await u.refresh();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.data.fiveHour.utilization, 90.4);
    assert.strictEqual(r.data.sevenDay, null);
  });

  await test('Utilization fuera de rango → recortada a [0,100]', async () => {
    const { u } = makeEnv([
      ['/organizations/org-chat-123/usage', resp(200, { five_hour: { utilization: 250 }, seven_day: { utilization: -5 } })],
      ['/organizations', resp(200, ORGS_OK)],
    ]);
    const r = await u.refresh();
    assert.strictEqual(r.data.fiveHour.utilization, 100);
    assert.strictEqual(r.data.sevenDay.utilization, 0);
  });

  await test('Umbral: cruza 80% → 1 notificación; sigue arriba → NO repite; baja y vuelve a cruzar → re-notifica', async () => {
    let util = 85;
    const routes = [
      ['/organizations/org-chat-123/usage', () => resp(200, { five_hour: { utilization: util, resets_at: 'x' } })],
      ['/organizations', resp(200, ORGS_OK)],
    ];
    const { u, notifications, tick } = makeEnv(routes);

    await u.refresh({ force: true });
    assert.strictEqual(notifications.length, 1);
    assert.strictEqual(notifications[0].kind, 'session');

    tick(6 * 60 * 1000);
    await u.refresh({ force: true });      // sigue en 85
    assert.strictEqual(notifications.length, 1, 'no repite mientras siga arriba');

    util = 30;                              // reset de la ventana de 5 h
    tick(6 * 60 * 1000);
    await u.refresh({ force: true });
    assert.strictEqual(notifications.length, 1);

    util = 92;                              // vuelve a cruzar
    tick(6 * 60 * 1000);
    await u.refresh({ force: true });
    assert.strictEqual(notifications.length, 2, 're-notifica tras re-armarse');
  });

  await test('thresholdsEnabled=false → nunca notifica umbrales', async () => {
    const { u, notifications } = makeEnv(
      [
        ['/organizations/org-chat-123/usage', resp(200, { five_hour: { utilization: 99 } })],
        ['/organizations', resp(200, ORGS_OK)],
      ],
      { usage: { thresholdsEnabled: false } }
    );
    await u.refresh({ force: true });
    assert.strictEqual(notifications.length, 0);
  });

  await test('getState: expone dato, error y frescura para el popup', async () => {
    const { u, tick } = makeEnv([
      ['/organizations/org-chat-123/usage', resp(200, USAGE_OK)],
      ['/organizations', resp(200, ORGS_OK)],
    ]);
    await u.refresh();
    let st = await u.getState();
    assert.ok(st.data && st.data.fiveHour);
    assert.strictEqual(st.stale, false);
    tick(6 * 60 * 1000);
    st = await u.getState();
    assert.strictEqual(st.stale, true, 'tras 6 min el dato se marca viejo');
  });

  console.log(`\n${passed} pasados, ${failed} fallidos`);
  process.exit(failed ? 1 : 0);
})();
