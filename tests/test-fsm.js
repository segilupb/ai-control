/*
 * Claude Control — tests/test-fsm.js
 * Ejecutar: node tests/test-fsm.js
 * Simula secuencias temporales de señales contra la FSM pura, cubriendo los
 * casos del brief: 3 (generación larga), 4 (pausa temporal), 5 (herramientas),
 * 6 (intervención), 12 (desconexión), más filtros anti-falso-positivo.
 */
'use strict';
const assert = require('assert');
const fsm = require('../content/state-machine.js');

const CFG = { settleMs: 4000, minTaskMs: 1500 };

// Señales base
const S = (over = {}) => ({
  activity: Object.assign({ streaming: false, stopButton: false, toolRunning: false, contentGrowing: false }, over.activity || {}),
  attention: Object.assign({ dialog: false, error: false, authWall: false }, over.attention || {}),
  context: Object.assign({ composerReady: true, conversationTitle: 'Test' }, over.context || {}),
  online: over.online !== undefined ? over.online : true,
  confidence: over.confidence !== undefined ? over.confidence : 1,
});

const GEN = S({ activity: { streaming: true } });
const TOOL = S({ activity: { toolRunning: true } });
const QUIET = S();

/** Ejecuta una secuencia [ [señales, duraciónMs, pasoMs?], ... ] y recoge eventos. */
function run(seq, startState) {
  let state = startState || fsm.createState(0);
  let now = 0;
  const events = [];
  for (const [sig, durMs, stepMs = 250] of seq) {
    const end = now + durMs;
    while (now < end) {
      now += stepMs;
      const r = fsm.step(state, sig, now, CFG);
      state = r.state;
      for (const ev of r.events) events.push(Object.assign({ t: now }, ev));
    }
  }
  return { state, events, now };
}

const count = (events, type) => events.filter((e) => e.type === type).length;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

console.log('FSM — Claude Control\n');

// ── Caso 1/3: generación normal y generación larga → exactamente 1 notificación al final
test('Caso 3: generación de 5 min → 0 notificaciones durante, 1 al final', () => {
  const { events } = run([
    [GEN, 5 * 60 * 1000],   // 5 minutos generando
    [QUIET, 6000],          // silencio > settleMs
  ]);
  assert.strictEqual(count(events, 'completed'), 1, 'debe completar exactamente una vez');
  const completedAt = events.find((e) => e.type === 'completed').t;
  assert.ok(completedAt > 5 * 60 * 1000, 'la notificación debe llegar después de terminar');
});

// ── Caso 4: pausa temporal más corta que settleMs → sin notificación intermedia
test('Caso 4: pausa de 2 s en mitad de la generación → no completa en la pausa', () => {
  const { events } = run([
    [GEN, 10000],
    [QUIET, 2000],    // pausa < settleMs(4000)
    [GEN, 10000],
    [QUIET, 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1, 'solo una finalización, al final real');
});

test('Caso 4b: dos pausas de 3.5 s → sigue siendo una sola finalización', () => {
  const { events } = run([
    [GEN, 5000], [QUIET, 3500],
    [GEN, 5000], [QUIET, 3500],
    [GEN, 5000], [QUIET, 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
});

// ── Caso 5: tarea larga con herramientas: generar→tool→pausa→generar→tool→fin
test('Caso 5: generar→tool→pensar→generar→tool→fin → 1 sola notificación', () => {
  const { events, state } = run([
    [GEN, 8000],
    [TOOL, 15000],   // herramienta ejecutándose (streaming=false)
    [QUIET, 2500],   // "pensando", silencio breve
    [GEN, 8000],
    [TOOL, 10000],
    [GEN, 3000],
    [QUIET, 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
  assert.strictEqual(state.name, 'IDLE');
});

test('Caso 5b: la señal de herramienta SOSTIENE pero no INICIA una tarea', () => {
  const { events, state } = run([
    [TOOL, 10000],   // spinner suelto sin tarea previa (p.ej. skeleton al cargar)
  ]);
  assert.strictEqual(count(events, 'task_started'), 0, 'un spinner no debe iniciar tarea');
  assert.strictEqual(state.name, 'IDLE');
});

test('Transición GENERATING→TOOL_RUNNING visible durante la herramienta', () => {
  const { events } = run([
    [GEN, 3000],
    [TOOL, 3000],
  ]);
  assert.ok(events.some((e) => e.type === 'state_changed' && e.next === 'TOOL_RUNNING'));
});

// ── Filtro minTaskMs: micro-parpadeos no notifican
test('Anti-falso-inicio: parpadeo de 500 ms → abandoned, nunca completed', () => {
  const { events } = run([
    [GEN, 500],
    [QUIET, 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 0);
  assert.strictEqual(count(events, 'abandoned'), 1);
});

// ── Caso 6: intervención
test('Caso 6: diálogo durante la tarea → needs_attention, sin completed', () => {
  const DIALOG = S({ attention: { dialog: true } });
  const { events, state } = run([
    [GEN, 5000],
    [DIALOG, 3000],
  ]);
  assert.strictEqual(count(events, 'needs_attention'), 1);
  assert.strictEqual(count(events, 'completed'), 0);
  assert.strictEqual(state.name, 'NEEDS_ATTENTION');
});

test('Caso 6b: diálogo resuelto y la tarea sigue → continúa sin re-notificar', () => {
  const DIALOG = S({ attention: { dialog: true } });
  const { events } = run([
    [GEN, 5000],
    [DIALOG, 3000],
    [GEN, 5000],     // usuario aprobó; Claude sigue generando
    [QUIET, 6000],
  ]);
  assert.strictEqual(count(events, 'needs_attention'), 1);
  assert.strictEqual(count(events, 'attention_cleared'), 1);
  assert.strictEqual(count(events, 'completed'), 1);
});

test('Caso 6c: diálogo con la página en reposo (settings del usuario) → ignorado', () => {
  const DIALOG = S({ attention: { dialog: true } });
  const { events, state } = run([
    [DIALOG, 5000],  // el usuario abrió un modal sin tarea en curso
  ]);
  assert.strictEqual(count(events, 'needs_attention'), 0);
  assert.strictEqual(state.name, 'IDLE');
});

test('Caso 6d: error visible → needs_attention aunque no haya tarea', () => {
  const ERR = S({ attention: { error: true } });
  const { events } = run([[ERR, 1000]]);
  assert.strictEqual(count(events, 'needs_attention'), 1);
});

// ── Caso 12: desconexión temporal
test('Caso 12: red caída en mitad de la tarea → jamás completa offline', () => {
  const OFFLINE = S({ online: false });
  const { events, state } = run([
    [GEN, 5000],
    [OFFLINE, 20000],   // 20 s sin red, sin señales
  ]);
  assert.strictEqual(count(events, 'completed'), 0);
  assert.strictEqual(state.name, 'SUSPENDED_NETWORK');
});

test('Caso 12b: reconecta y la generación continúa → completa solo al final real', () => {
  const OFFLINE = S({ online: false });
  const { events } = run([
    [GEN, 5000],
    [OFFLINE, 10000],
    [GEN, 5000],
    [QUIET, 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
});

test('Caso 12c: reconecta y la tarea terminó durante el corte → settle limpio y completa una vez', () => {
  const OFFLINE = S({ online: false });
  const { events } = run([
    [GEN, 5000],
    [OFFLINE, 10000],
    [QUIET, 6000],      // vuelve online, todo quieto → SETTLING nuevo → completed
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
  const evOffline = events.filter((e) => e.type === 'completed' && e.t <= 15000);
  assert.strictEqual(evOffline.length, 0, 'nunca completado durante el corte');
});

// ── UNKNOWN por pérdida de confianza
test('UNKNOWN: 3 evaluaciones sin anclas → UNKNOWN sin notificar; recupera a IDLE', () => {
  const LOST = S({ confidence: 0, context: { composerReady: false } });
  const r1 = run([[GEN, 3000], [LOST, 2000]]);
  assert.strictEqual(r1.state.name, 'UNKNOWN');
  assert.strictEqual(count(r1.events, 'completed'), 0);
  const r2 = run([[QUIET, 1000]], r1.state);
  assert.strictEqual(r2.state.name, 'IDLE');
});

// ── A5: crecimiento de contenido sostiene en SETTLING
test('contentGrowing durante SETTLING → vuelve a GENERATING sin notificar', () => {
  const GROW = S({ activity: { contentGrowing: true } });
  const { events } = run([
    [GEN, 5000],
    [QUIET, 2000],     // entra en SETTLING
    [GROW, 1000],      // el texto sigue creciendo aunque no haya botón stop
    [GEN, 3000],
    [QUIET, 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
});

test('contentGrowing NO inicia tarea desde IDLE', () => {
  const GROW = S({ activity: { contentGrowing: true } });
  const { events, state } = run([[GROW, 5000]]);
  assert.strictEqual(count(events, 'task_started'), 0);
  assert.strictEqual(state.name, 'IDLE');
});

// ── Caso 3 extremo: tool muy largo sin streaming
test('Herramienta de 10 min tras un arranque real → sigue TOOL_RUNNING sin notificar', () => {
  const { events, state } = run([
    [GEN, 3000],
    [TOOL, 10 * 60 * 1000],
  ]);
  assert.strictEqual(count(events, 'completed'), 0);
  assert.strictEqual(state.name, 'TOOL_RUNNING');
});

// ── Bordes adicionales
test('Diálogo apareciendo durante SETTLING → needs_attention, no completed', () => {
  const DIALOG = S({ attention: { dialog: true } });
  const { events, state } = run([
    [GEN, 5000],
    [QUIET, 2000],    // SETTLING
    [DIALOG, 3000],
  ]);
  assert.strictEqual(count(events, 'needs_attention'), 1);
  assert.strictEqual(count(events, 'completed'), 0);
  assert.strictEqual(state.name, 'NEEDS_ATTENTION');
});

test('Corte de red desde IDLE → suspende y vuelve a IDLE sin eventos de tarea', () => {
  const OFFLINE = S({ online: false });
  const { events, state } = run([
    [QUIET, 2000],
    [OFFLINE, 5000],
    [QUIET, 2000],
  ]);
  assert.strictEqual(count(events, 'completed') + count(events, 'needs_attention'), 0);
  assert.strictEqual(state.name, 'IDLE');
});

test('Herramienta reapareciendo durante SETTLING → sostiene la tarea', () => {
  const { events } = run([
    [GEN, 5000],
    [QUIET, 2000],   // SETTLING
    [TOOL, 5000],    // la herramienta sigue: no completar
    [QUIET, 6000],
  ]);
  assert.strictEqual(count(events, 'completed'), 1);
  const c = events.find((e) => e.type === 'completed');
  assert.ok(c.t > 12000, 'completa solo tras la herramienta');
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
