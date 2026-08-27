/*
 * Claude Control — tests/test-registry.js
 * Ejecutar: node tests/test-registry.js
 * Verifica el registro multi-tab con storage y ping falsos:
 * Caso 2 (3 pestañas independientes), Caso 8 (pestaña inactiva sigue
 * monitorizada vía mensajes), limpieza onRemoved, zombis, persistencia.
 */
'use strict';
const assert = require('assert');
const { createTabRegistry } = require('../background/tab-registry.js');

function makeDeps() {
  const store = {};
  let clock = 1000;
  const pings = {};
  return {
    deps: {
      now: () => clock,
      storageGet: async (k) => store[k] ?? null,
      storageSet: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
      ping: async (tabId) => (tabId in pings ? pings[tabId] : null),
    },
    store,
    pings,
    tick: (ms) => { clock += ms; },
    nowRef: () => clock,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

(async () => {
  console.log('Tab Registry — Claude Control\n');

  await test('Caso 2: tres pestañas con estados independientes', async () => {
    const { deps } = makeDeps();
    const r = createTabRegistry(deps);
    r.register(1, 10, { url: 'https://claude.ai/chat/a', title: 'A - Claude', conversationTitle: 'Project Alpha' });
    r.register(2, 10, { url: 'https://claude.ai/chat/b', title: 'B - Claude', conversationTitle: 'Gateway' });
    r.register(3, 20, { url: 'https://claude.ai/chat/c', title: 'C - Claude', conversationTitle: 'Auditoría' });

    r.applyState(1, 10, { next: 'GENERATING', at: 1 });
    r.applyState(2, 10, { next: 'NEEDS_ATTENTION', at: 2, attentionReason: 'dialog' });
    // La 3 sigue IDLE

    assert.strictEqual(r.get(1).state, 'GENERATING');
    assert.strictEqual(r.get(2).state, 'NEEDS_ATTENTION');
    assert.strictEqual(r.get(3).state, 'IDLE');

    // Completar la 1 no toca a las demás
    r.applyCompleted(1, { at: 100, durationMs: 5000 });
    assert.strictEqual(r.get(1).state, 'COMPLETED');
    assert.strictEqual(r.get(2).state, 'NEEDS_ATTENTION');
    assert.strictEqual(r.get(3).state, 'IDLE');

    const c = r.counts();
    assert.deepStrictEqual(
      { g: c.generating, d: c.completed, a: c.attention },
      { g: 0, d: 1, a: 1 }
    );
  });

  await test('Eventos: completed y attention emiten con el tab correcto', async () => {
    const { deps } = makeDeps();
    const r = createTabRegistry(deps);
    const got = [];
    r.on('completed', (p) => got.push(['completed', p.tabId, p.tab.conversationTitle]));
    r.on('attention', (p) => got.push(['attention', p.tabId, p.reason]));

    r.register(7, 1, { url: 'u', title: 't', conversationTitle: 'Migración' });
    r.applyState(7, 1, { next: 'GENERATING', at: 1 });
    r.applyCompleted(7, { at: 2, durationMs: 9000 });
    r.register(8, 1, { url: 'u2', title: 't2', conversationTitle: 'Gateway' });
    r.applyAttention(8, { reason: 'error' });

    assert.deepStrictEqual(got, [
      ['completed', 7, 'Migración'],
      ['attention', 8, 'error'],
    ]);
  });

  await test('markSeen: enfocar una pestaña COMPLETED la devuelve a IDLE; otras intactas', async () => {
    const { deps } = makeDeps();
    const r = createTabRegistry(deps);
    r.register(1, 1, { url: 'u', title: 't' });
    r.register(2, 1, { url: 'u', title: 't' });
    r.applyState(1, 1, { next: 'GENERATING', at: 1 });
    r.applyCompleted(1, { at: 2 });
    r.applyState(2, 1, { next: 'GENERATING', at: 1 });

    r.markSeen(1);
    assert.strictEqual(r.get(1).state, 'IDLE');
    assert.strictEqual(r.get(1).completedUnseen, false);
    assert.strictEqual(r.get(2).state, 'GENERATING', 'markSeen no debe tocar otras pestañas');

    // markSeen sobre una pestaña activa no la resetea
    r.markSeen(2);
    assert.strictEqual(r.get(2).state, 'GENERATING');
  });

  await test('onRemoved limpia la entrada y counts no cuenta fantasmas', async () => {
    const { deps } = makeDeps();
    const r = createTabRegistry(deps);
    r.register(1, 1, { url: 'u', title: 't' });
    r.applyState(1, 1, { next: 'GENERATING', at: 1 });
    r.remove(1);
    assert.strictEqual(r.get(1), null);
    assert.strictEqual(r.counts().total, 0);
    assert.strictEqual(r.counts().generating, 0);
  });

  await test('onReplaced migra el estado al nuevo tabId', async () => {
    const { deps } = makeDeps();
    const r = createTabRegistry(deps);
    r.register(5, 1, { url: 'u', title: 't', conversationTitle: 'X' });
    r.applyState(5, 1, { next: 'TOOL_RUNNING', at: 1 });
    r.replace(9, 5);
    assert.strictEqual(r.get(5), null);
    assert.strictEqual(r.get(9).state, 'TOOL_RUNNING');
    assert.strictEqual(r.get(9).conversationTitle, 'X');
  });

  await test('Zombi: activa sin heartbeat >90 s y sin respuesta al ping → UNKNOWN/stale', async () => {
    const { deps, tick } = makeDeps();
    const r = createTabRegistry(deps);
    r.register(1, 1, { url: 'u', title: 't' });
    r.applyState(1, 1, { next: 'GENERATING', at: 1 });
    tick(r.STALE_AFTER_MS + 1000);
    await r.sweepStale();
    assert.strictEqual(r.get(1).state, 'UNKNOWN');
    assert.strictEqual(r.get(1).stale, true);
  });

  await test('Zombi con ping vivo: adopta el estado real del content script', async () => {
    const { deps, tick, pings } = makeDeps();
    const r = createTabRegistry(deps);
    r.register(1, 1, { url: 'u', title: 't' });
    r.applyState(1, 1, { next: 'GENERATING', at: 1 });
    pings[1] = { state: 'TOOL_RUNNING', conversationTitle: 'Sigue viva' };
    tick(r.STALE_AFTER_MS + 1000);
    await r.sweepStale();
    assert.strictEqual(r.get(1).state, 'TOOL_RUNNING');
    assert.strictEqual(r.get(1).stale, false);
  });

  await test('Heartbeat mantiene fresca una pestaña activa (Caso 8: pestaña en background)', async () => {
    const { deps, tick } = makeDeps();
    const r = createTabRegistry(deps);
    r.register(1, 1, { url: 'u', title: 't' });
    r.applyState(1, 1, { next: 'GENERATING', at: 1 });
    tick(60 * 1000);
    r.heartbeat(1, { state: 'GENERATING' });
    tick(60 * 1000); // 120 s desde applyState pero 60 s desde heartbeat
    await r.sweepStale();
    assert.strictEqual(r.get(1).state, 'GENERATING', 'con heartbeats nunca degrada');
  });

  await test('Persistencia: serializa a storage y restaura tras "sleep" del SW', async () => {
    const { deps, store } = makeDeps();
    const r1 = createTabRegistry(deps);
    r1.register(1, 1, { url: 'u', title: 't', conversationTitle: 'Persistente' });
    r1.applyState(1, 1, { next: 'GENERATING', at: 1 });
    await sleep(700); // supera el debounce de persistencia

    const r2 = createTabRegistry(deps); // "nuevo SW" con el mismo storage
    await r2.restore();
    assert.ok(r2.get(1), 'la entrada debe restaurarse');
    assert.strictEqual(r2.get(1).conversationTitle, 'Persistente');
    assert.strictEqual(r2.get(1).state, 'GENERATING');
    assert.ok(store.cc_tab_registry, 'el espejo existe en storage');
  });

  await test('Re-registro (recarga/navegación SPA) resetea a IDLE sin eventos de tarea', async () => {
    const { deps } = makeDeps();
    const r = createTabRegistry(deps);
    let completedFired = 0;
    r.on('completed', () => completedFired++);
    r.register(1, 1, { url: 'a', title: 't' });
    r.applyState(1, 1, { next: 'GENERATING', at: 1 });
    r.register(1, 1, { url: 'b', title: 't2' }); // navegó a otra conversación
    assert.strictEqual(r.get(1).state, 'IDLE');
    assert.strictEqual(completedFired, 0, 'una tarea abandonada no notifica');
  });

  console.log(`\n${passed} pasados, ${failed} fallidos`);
  process.exit(failed ? 1 : 0);
})();
