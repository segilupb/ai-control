/*
 * Claude Control — tests/test-history.js
 * Ejecutar: node tests/test-history.js
 */
'use strict';
const assert = require('assert');
const { createHistory } = require('../background/history.js');

function makeEnv(enabled = true) {
  const store = {};
  let clock = 1000;
  const h = createHistory({
    now: () => clock,
    storageGet: async (keys) => { const o = {}; for (const k of keys) o[k] = store[k]; return o; },
    storageSet: async (obj) => Object.assign(store, obj),
    isEnabled: async () => enabled,
  });
  return { h, store, tick: (ms) => { clock += ms; } };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

(async () => {
  console.log('History — Claude Control\n');

  await test('add + list: más reciente primero, sin contenido de conversación', async () => {
    const { h, tick } = makeEnv();
    await h.add({ conversationTitle: 'A', outcome: 'completed', durationMs: 60000 });
    tick(1000);
    await h.add({ conversationTitle: 'B', outcome: 'attention', reason: 'dialog' });
    const list = await h.list();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].conversationTitle, 'B');
    assert.strictEqual(list[1].outcome, 'completed');
    const keys = Object.keys(list[0]);
    assert.ok(!keys.includes('content') && !keys.includes('messages'), 'solo metadatos');
  });

  await test('Buffer circular: nunca supera MAX_ENTRIES (200)', async () => {
    const { h, tick } = makeEnv();
    for (let i = 0; i < 230; i++) { await h.add({ conversationTitle: `T${i}`, outcome: 'completed' }); tick(10); }
    const list = await h.list();
    assert.strictEqual(list.length, h.MAX_ENTRIES);
    assert.strictEqual(list[0].conversationTitle, 'T229', 'se conservan las más recientes');
    assert.strictEqual(list[h.MAX_ENTRIES - 1].conversationTitle, 'T30');
  });

  await test('historyEnabled=false → add es no-op', async () => {
    const { h } = makeEnv(false);
    const r = await h.add({ conversationTitle: 'X', outcome: 'completed' });
    assert.strictEqual(r, null);
    assert.strictEqual((await h.list()).length, 0);
  });

  await test('clear vacía el historial', async () => {
    const { h } = makeEnv();
    await h.add({ conversationTitle: 'A', outcome: 'completed' });
    await h.clear();
    assert.strictEqual((await h.list()).length, 0);
  });

  console.log(`\n${passed} pasados, ${failed} fallidos`);
  process.exit(failed ? 1 : 0);
})();
