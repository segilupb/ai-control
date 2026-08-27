/*
 * Claude Control — tests/test-notifier.js
 * Ejecutar: node tests/test-notifier.js
 * Notificaciones: individual, agrupación <5 s, atención con requireInteraction,
 * routing de clicks por id codificado, auto-clear por alarms, y badge global.
 */
'use strict';
const assert = require('assert');
const { createNotifier } = require('../background/notifier.js');
const badge = require('../background/badge.js');

function makeEnv(settings) {
  let clock = 10000;
  const created = [];   // [id, opts]
  const cleared = [];
  const alarms = [];
  const focused = [];
  const sounds = [];
  const n = createNotifier({
    now: () => clock,
    create: async (id, opts) => { created.push([id, opts]); },
    clear: async (id) => { cleared.push(id); },
    alarmCreate: (name, info) => { alarms.push([name, info]); },
    focusTab: async (tabId) => { focused.push(tabId); },
    playSound: (kind, provider) => { sounds.push([kind, provider]); },
    getSettings: async () => settings || {},
  });
  return { n, created, cleared, alarms, focused, sounds, tick: (ms) => { clock += ms; }, now: () => clock };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

(async () => {
  console.log('Notifier + Badge — Claude Control\n');

  await test('COMPLETED individual: crea 1 notificación con título de conversación', async () => {
    const { n, created, sounds } = makeEnv();
    await n.notifyCompleted({ tabId: 5, conversationTitle: 'Project Alpha', durationMs: 42000,
                              provider: 'claude', providerName: 'Claude' });
    assert.strictEqual(created.length, 1);
    const [id, opts] = created[0];
    assert.ok(id.startsWith('cc|done|5|'));
    assert.strictEqual(opts.title, 'Claude finished');
    assert.ok(opts.message.includes('Project Alpha'));
    assert.deepStrictEqual(sounds, [['done', 'claude']], 'sonido específico de la IA');
    assert.strictEqual(opts.silent, true, 'sonido propio activo ⇒ notificación silenciosa');
  });

  await test('Agrupación: 2 COMPLETED en <5 s → 1 notificación de grupo, individuales limpiadas', async () => {
    const { n, created, cleared, tick } = makeEnv();
    await n.notifyCompleted({ tabId: 1, conversationTitle: 'Project Alpha' });
    tick(2000);
    await n.notifyCompleted({ tabId: 2, conversationTitle: 'Gateway' });
    const group = created.find(([id]) => id.startsWith('cc|group|'));
    assert.ok(group, 'debe existir la notificación de grupo');
    assert.ok(group[1].title.includes('2 tasks'));
    assert.ok(group[1].message.includes('Project Alpha') && group[1].message.includes('Gateway'));
    assert.ok(cleared.some((id) => id.startsWith('cc|done|1|')), 'individual del grupo limpiada');
  });

  await test('Sin agrupación: 2 COMPLETED separados >5 s → 2 individuales', async () => {
    const { n, created, tick } = makeEnv();
    await n.notifyCompleted({ tabId: 1, conversationTitle: 'A' });
    tick(6000);
    await n.notifyCompleted({ tabId: 2, conversationTitle: 'B' });
    const dones = created.filter(([id]) => id.startsWith('cc|done|'));
    const groups = created.filter(([id]) => id.startsWith('cc|group|'));
    assert.strictEqual(dones.length, 2);
    assert.strictEqual(groups.length, 0);
  });

  await test('3 COMPLETED en ráfaga → grupo de 3', async () => {
    const { n, created, tick } = makeEnv();
    await n.notifyCompleted({ tabId: 1, conversationTitle: 'A' });
    tick(1000);
    await n.notifyCompleted({ tabId: 2, conversationTitle: 'B' });
    tick(1000);
    await n.notifyCompleted({ tabId: 3, conversationTitle: 'C' });
    const groups = created.filter(([id]) => id.startsWith('cc|group|'));
    assert.ok(groups.length >= 2, 'el grupo se actualiza');
    assert.ok(groups[groups.length - 1][1].title.includes('3 tasks'));
  });

  await test('NEEDS_ATTENTION: requireInteraction, sonido distinto, sin auto-clear', async () => {
    const { n, created, alarms, sounds } = makeEnv();
    await n.notifyAttention({ tabId: 9, conversationTitle: 'Gateway', reason: 'dialog',
                              provider: 'chatgpt', providerName: 'ChatGPT' });
    const [id, opts] = created[0];
    assert.ok(id.startsWith('cc|attn|9|'));
    assert.strictEqual(opts.requireInteraction, true);
    assert.ok(opts.title.includes('attention'));
    assert.ok(opts.title.includes('ChatGPT'), 'el título debe identificar la IA');
    assert.deepStrictEqual(sounds, [['attention', 'chatgpt']], 'sonido específico de la IA');
    assert.strictEqual(alarms.length, 0, 'las de atención no se auto-limpian');
  });

  await test('Click en cc|done|<tabId> → enfoca ESA pestaña y limpia', async () => {
    const { n, created, focused, cleared } = makeEnv();
    await n.notifyCompleted({ tabId: 7, conversationTitle: 'X' });
    const id = created[0][0];
    await n.handleClick(id);
    assert.deepStrictEqual(focused, [7]);
    assert.ok(cleared.includes(id));
  });

  await test('Click en grupo → enfoca la más reciente', async () => {
    const { n, created, focused, tick } = makeEnv();
    await n.notifyCompleted({ tabId: 1, conversationTitle: 'A' });
    tick(1000);
    await n.notifyCompleted({ tabId: 2, conversationTitle: 'B' });
    const group = created.filter(([id]) => id.startsWith('cc|group|')).pop();
    await n.handleClick(group[0]);
    assert.deepStrictEqual(focused, [2]);
  });

  await test('Click en id ajeno (otra extensión/no cc) → ignorado', async () => {
    const { n, focused } = makeEnv();
    const handled = await n.handleClick('otra-cosa-123');
    assert.strictEqual(handled, false);
    assert.strictEqual(focused.length, 0);
  });

  await test('Auto-clear: programa alarm y handleAlarm limpia la notificación', async () => {
    const { n, created, alarms, cleared } = makeEnv({ autoDismissSeconds: 25 });
    await n.notifyCompleted({ tabId: 4, conversationTitle: 'Y' });
    assert.strictEqual(alarms.length, 1);
    const [alarmName, info] = alarms[0];
    assert.ok(alarmName.startsWith(n.ALARM_PREFIX));
    assert.ok(info.when > 0);
    const handled = await n.handleAlarm(alarmName);
    assert.strictEqual(handled, true);
    assert.ok(cleared.includes(created[0][0]));
  });

  await test('Settings: notifyDone=false → ni notificación ni sonido', async () => {
    const { n, created, sounds } = makeEnv({ notifyDone: false });
    await n.notifyCompleted({ tabId: 1, conversationTitle: 'Z' });
    assert.strictEqual(created.length, 0);
    assert.strictEqual(sounds.length, 0);
  });

  await test('Settings: sound.enabled=false → notificación audible del SO (silent=false)', async () => {
    const { n, created, sounds } = makeEnv({ sound: { enabled: false } });
    await n.notifyCompleted({ tabId: 1, conversationTitle: 'Z' });
    assert.strictEqual(created[0][1].silent, false);
    assert.strictEqual(sounds.length, 0);
  });

  await test('Fallback de título: sin conversationTitle usa "pestaña N"', async () => {
    const { n, created } = makeEnv();
    await n.notifyCompleted({ tabId: 3 });
    assert.ok(created[0][1].message.includes('tab 3'));
  });

  await test('Cada IA dispara SU sonido y su título (no se confunden)', async () => {
    const { n, created, sounds, tick } = makeEnv();
    await n.notifyCompleted({ tabId: 1, conversationTitle: 'A', provider: 'claude', providerName: 'Claude' });
    tick(6000);
    await n.notifyCompleted({ tabId: 2, conversationTitle: 'B', provider: 'chatgpt', providerName: 'ChatGPT' });
    tick(6000);
    await n.notifyCompleted({ tabId: 3, conversationTitle: 'C', provider: 'claude', providerName: 'Claude' });
    assert.deepStrictEqual(sounds, [['done','claude'], ['done','chatgpt'], ['done','claude']]);
    assert.strictEqual(created[0][1].title, 'Claude finished');
    assert.strictEqual(created[1][1].title, 'ChatGPT finished');
    assert.strictEqual(created[2][1].title, 'Claude finished');
  });

  await test('Grupo mixto: la notificación agrupada identifica cada IA', async () => {
    const { n, created, tick } = makeEnv();
    await n.notifyCompleted({ tabId: 1, conversationTitle: 'Audit', provider: 'claude', providerName: 'Claude' });
    tick(1500);
    await n.notifyCompleted({ tabId: 2, conversationTitle: 'Draft', provider: 'chatgpt', providerName: 'ChatGPT' });
    const group = created.filter(([id]) => id.startsWith('cc|group|')).pop();
    assert.ok(group[1].message.includes('Claude: Audit'));
    assert.ok(group[1].message.includes('ChatGPT: Draft'));
  });

  // ── Badge ───────────────────────────────────────────────────────────
  await test('Badge: prioridad rojo > verde > naranja > vacío, número coherente', async () => {
    assert.deepStrictEqual(
      badge.globalBadge({ attention: 2, completed: 5, generating: 9 }),
      { text: '2', color: badge.COLORS.attention }
    );
    assert.deepStrictEqual(
      badge.globalBadge({ attention: 0, completed: 3, generating: 9 }),
      { text: '3', color: badge.COLORS.completed }
    );
    assert.deepStrictEqual(
      badge.globalBadge({ attention: 0, completed: 0, generating: 2 }),
      { text: '2', color: badge.COLORS.generating }
    );
    assert.strictEqual(badge.globalBadge({ attention: 0, completed: 0, generating: 0 }).text, '');
  });

  await test('Badge por pestaña: símbolos por estado', async () => {
    assert.strictEqual(badge.perTabBadge('GENERATING').text, '…');
    assert.strictEqual(badge.perTabBadge('COMPLETED').text, '✓');
    assert.strictEqual(badge.perTabBadge('NEEDS_ATTENTION').text, '!');
    assert.strictEqual(badge.perTabBadge('UNKNOWN').text, '?');
    assert.strictEqual(badge.perTabBadge('IDLE').text, '');
  });

  console.log(`\n${passed} pasados, ${failed} fallidos`);
  process.exit(failed ? 1 : 0);
})();
