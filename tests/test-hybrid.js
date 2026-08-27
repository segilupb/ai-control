/*
 * AI Control — tests/test-hybrid.js
 * Ejecutar: node tests/test-hybrid.js
 *
 * Verifica la regla central de la arquitectura híbrida:
 *   NETWORK_COMPLETE es EVIDENCIA, no una transición.
 * Una request terminada NUNCA completa una tarea si el DOM sigue mostrando
 * actividad (stop button, streaming, tool o crecimiento de contenido).
 */
'use strict';
const assert = require('assert');
const fsm = require('../content/state-machine.js');
const net = require('../background/network-signals.js');

const CFG = { settleMs: 4000, minTaskMs: 1500 };

const S = (over = {}) => ({
  activity: Object.assign({ streaming: false, stopButton: false, toolRunning: false, contentGrowing: false }, over.activity || {}),
  attention: Object.assign({ dialog: false, error: false, authWall: false }, over.attention || {}),
  context: Object.assign({ composerReady: true, conversationTitle: 'Test' }, over.context || {}),
  network: Object.assign({ inFlight: 0, completedAt: 0 }, over.network || {}),
  online: over.online !== undefined ? over.online : true,
  confidence: 1,
});

function run(seq, startState) {
  let state = startState || fsm.createState(0);
  let now = 0;
  const events = [];
  for (const [sig, dur, step = 250] of seq) {
    const end = now + dur;
    while (now < end) {
      now += step;
      const r = fsm.step(state, sig, now, CFG);
      state = r.state;
      for (const ev of r.events) events.push({ t: now, ...ev });
    }
  }
  return { state, events, now };
}
const count = (evs, type) => evs.filter((e) => e.type === type).length;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

console.log('Detector híbrido (red + DOM) — AI Control\n');

/* ── Enrutado de URLs ───────────────────────────────────────────────── */
test('Los patrones de red identifican al proveedor correcto', () => {
  assert.strictEqual(net.providerForUrl('https://chatgpt.com/backend-api/f/conversation'), 'chatgpt');
  assert.strictEqual(net.providerForUrl('https://chat.openai.com/backend-api/conversation'), 'chatgpt');
  assert.strictEqual(net.providerForUrl(
    'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x'), 'gemini');
  assert.strictEqual(net.providerForUrl(
    'https://claude.ai/api/organizations/abc-123/chat_conversations/def/completion'), 'claude');
  assert.strictEqual(net.providerForUrl('https://claude.ai/api/organizations'), null);
  assert.strictEqual(net.providerForUrl('https://example.com/foo'), null);
});

test('El rastreador cuenta requests en vuelo por pestaña y avisa al content script', () => {
  const sent = [];
  const ns = net.createNetworkSignals({ now: () => 1000, send: (tabId, m) => sent.push([tabId, m]) });

  ns.onBeforeRequest({ url: 'https://chatgpt.com/backend-api/f/conversation', tabId: 7, requestId: 'r1' });
  ns.onBeforeRequest({ url: 'https://chatgpt.com/backend-api/f/conversation', tabId: 7, requestId: 'r2' });
  assert.strictEqual(ns.state(7).inFlight.size, 2, 'dos requests encadenadas');

  ns.onCompleted({ url: 'https://chatgpt.com/backend-api/f/conversation', tabId: 7, requestId: 'r1', statusCode: 200 });
  assert.strictEqual(ns.state(7).inFlight.size, 1, 'aún queda una viva');

  const last = sent[sent.length - 1][1];
  assert.strictEqual(last.type, 'CC_NET');
  assert.strictEqual(last.phase, 'complete');
  assert.strictEqual(last.inFlight, 1);
});

test('Pestañas distintas no comparten estado de red', () => {
  const ns = net.createNetworkSignals({});
  ns.onBeforeRequest({ url: 'https://claude.ai/api/organizations/x/chat_conversations/y/completion', tabId: 1, requestId: 'a' });
  ns.onBeforeRequest({ url: 'https://claude.ai/api/organizations/x/chat_conversations/y/completion', tabId: 2, requestId: 'b' });
  ns.onCompleted({ url: 'https://claude.ai/api/organizations/x/chat_conversations/y/completion', tabId: 1, requestId: 'a', statusCode: 200 });
  assert.strictEqual(ns.state(1).inFlight.size, 0);
  assert.strictEqual(ns.state(2).inFlight.size, 1);
});

/* ── La regla de oro ────────────────────────────────────────────────── */
test('Request termina pero el DOM sigue generando → NO completa', () => {
  const { events, state } = run([
    [S({ network: { inFlight: 1 } }), 4000],                                  // request viva
    [S({ activity: { streaming: true }, network: { inFlight: 0, completedAt: 1 } }), 12000], // request acabó, DOM sigue
  ]);
  assert.strictEqual(count(events, 'completed'), 0, 'jamás completar con el DOM activo');
  assert.strictEqual(state.name, 'GENERATING');
});

test('Request termina y hay tool corriendo → TOOL_RUNNING, no COMPLETED', () => {
  const { events, state } = run([
    [S({ network: { inFlight: 1 } }), 3000],
    [S({ activity: { toolRunning: true }, network: { inFlight: 0, completedAt: 1 } }), 10000],
  ]);
  assert.strictEqual(count(events, 'completed'), 0);
  assert.strictEqual(state.name, 'TOOL_RUNNING');
});

test('Request termina y el contenido sigue creciendo → NO completa', () => {
  const { events } = run([
    [S({ network: { inFlight: 1 } }), 3000],
    [S({ activity: { contentGrowing: true }, network: { inFlight: 0, completedAt: 1 } }), 8000],
    [S({ activity: { streaming: true } }), 3000],
    [S(), 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1, 'una sola, y al final real');
});

test('Request termina y el DOM está quieto → completa tras la ventana de estabilidad', () => {
  const { events } = run([
    [S({ activity: { streaming: true }, network: { inFlight: 1 } }), 5000],
    [S({ network: { inFlight: 0, completedAt: 1 } }), 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
  const c = events.find((e) => e.type === 'completed');
  assert.ok(c.t >= 9000, 'no antes de settleMs desde que todo quedó quieto');
});

test('Cadena de requests (tool → segunda generación) → una sola notificación', () => {
  const { events } = run([
    [S({ activity: { streaming: true }, network: { inFlight: 1 } }), 6000],   // 1ª generación
    [S({ activity: { toolRunning: true }, network: { inFlight: 0, completedAt: 1 } }), 5000], // tool
    [S({ network: { inFlight: 1 } }), 2000],                                  // 2ª request arranca
    [S({ activity: { streaming: true }, network: { inFlight: 1 } }), 6000],
    [S({ network: { inFlight: 0, completedAt: 2 } }), 6000],                   // fin real
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
  assert.strictEqual(count(events, 'task_started'), 1, 'una sola tarea, no dos');
});

test('Múltiples requests solapadas: no completa hasta que TODAS terminan', () => {
  const { events, state } = run([
    [S({ network: { inFlight: 2 } }), 5000],
    [S({ network: { inFlight: 1, completedAt: 1 } }), 8000],  // una acabó, otra sigue
  ]);
  assert.strictEqual(count(events, 'completed'), 0);
  assert.strictEqual(state.name, 'GENERATING');
});

test('La red puede INICIAR una tarea antes de que el DOM reaccione', () => {
  const { events } = run([[S({ network: { inFlight: 1 } }), 2000]]);
  assert.strictEqual(count(events, 'task_started'), 1, 'la request es la señal más temprana');
});

test('El botón Stop desaparece un instante pero la request sigue → no completa', () => {
  const { events } = run([
    [S({ activity: { stopButton: true }, network: { inFlight: 1 } }), 5000],
    [S({ network: { inFlight: 1 } }), 3000],                 // stop invisible, request viva
    [S({ activity: { stopButton: true }, network: { inFlight: 1 } }), 4000],
    [S({ network: { inFlight: 0, completedAt: 1 } }), 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
});

test('Request con error de red → no completa mientras el DOM siga activo', () => {
  const { events, state } = run([
    [S({ network: { inFlight: 1 } }), 3000],
    [S({ activity: { streaming: true }, network: { inFlight: 0, completedAt: 1 } }), 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 0);
  assert.strictEqual(state.name, 'GENERATING');
});

test('Una sola notificación por tarea aunque lleguen muchos eventos de red', () => {
  const { events } = run([
    [S({ activity: { streaming: true }, network: { inFlight: 1 } }), 4000],
    [S({ network: { inFlight: 0, completedAt: 1 } }), 6000],   // completa aquí
    [S({ network: { inFlight: 0, completedAt: 2 } }), 4000],   // eventos tardíos
    [S({ network: { inFlight: 0, completedAt: 3 } }), 4000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
});

test('Sin señal de red (proveedor sin patrón conocido) la FSM funciona igual que antes', () => {
  const { events } = run([
    [S({ activity: { streaming: true } }), 5000],   // network ausente/0
    [S(), 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1, 'degradación limpia a solo-DOM');
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
