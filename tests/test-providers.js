/*
 * AI Control — tests/test-providers.js
 * Ejecutar: node tests/test-providers.js
 *
 * Quien solo usa una o dos IAs no debe ver bloques vacíos de las demás, ni
 * pagar consultas de red por proveedores que tiene desactivados.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

console.log('Selección de proveedores — AI Control\n');

/* ── Filtrado en el popup (lógica extraída y ejecutada) ─────────────── */
function shownProviders(all) {
  const ORDER = ['claude', 'chatgpt'];
  const enabled = all.enabled || { claude: true, chatgpt: true };
  return ORDER.filter((p) => enabled[p] !== false && all[p]);
}

const snap = (p) => ({ provider: p, status: 'ok', fetchedAt: 1, windows: [
  { id: 'session', label: '5h', usedPercent: 10, remainingPercent: 90, resetsAt: null }] });

test('Ambos activos → se muestran los dos', () => {
  const all = { enabled: { claude: true, chatgpt: true },
                claude: snap('claude'), chatgpt: snap('chatgpt') };
  assert.deepStrictEqual(shownProviders(all), ['claude', 'chatgpt']);
});

test('Solo Claude activo → solo se muestra Claude', () => {
  const all = { enabled: { claude: true, chatgpt: false }, claude: snap('claude') };
  assert.deepStrictEqual(shownProviders(all), ['claude']);
});

test('Solo ChatGPT → Claude no aparece', () => {
  const all = { enabled: { claude: false, chatgpt: true }, chatgpt: snap('chatgpt') };
  assert.deepStrictEqual(shownProviders(all), ['chatgpt']);
});

test('Ninguno activo → lista vacía (el popup oculta el panel entero)', () => {
  const all = { enabled: { claude: false, chatgpt: false } };
  assert.deepStrictEqual(shownProviders(all), []);
});

test('Activo pero sin datos todavía → no rompe, simplemente no se lista', () => {
  const all = { enabled: { claude: true, chatgpt: true }, claude: snap('claude') };
  assert.deepStrictEqual(shownProviders(all), ['claude']);
});

test('Sin campo enabled (instalación antigua) → se muestran todos los que haya', () => {
  const all = { claude: snap('claude'), chatgpt: snap('chatgpt') };
  assert.deepStrictEqual(shownProviders(all), ['claude', 'chatgpt']);
});

/* ── Cableado real: que el ajuste se use de verdad ──────────────────── */
test('El service worker consulta isProviderEnabled antes de pedir uso', () => {
  const sw = read('background/service-worker.js');
  assert.ok(/function isProviderEnabled/.test(sw), 'falta el helper');
  assert.ok(sw.includes("isProviderEnabled('chatgpt')"), 'ChatGPT no comprueba el ajuste');
  assert.ok(sw.includes("isProviderEnabled('claude')"), 'Claude no comprueba el ajuste');
});

test('La alarma periódica no consulta endpoints de IAs desactivadas', () => {
  const sw = read('background/service-worker.js');
  const block = sw.slice(sw.indexOf('USAGE_ALARM) {'), sw.indexOf('USAGE_ALARM) {') + 700);
  assert.ok(block.includes('isProviderEnabled'), 'la alarma refresca sin mirar los ajustes');
});

test('CC_USAGE_ALL devuelve el mapa enabled para que el popup filtre', () => {
  const sw = read('background/service-worker.js');
  const i = sw.indexOf("case 'CC_USAGE_ALL'");
  const block = sw.slice(i, i + 1600);
  assert.ok(/const enabled = \{/.test(block), 'no calcula enabled');
  assert.ok(/out\.enabled|enabled,|\{ enabled \}/.test(block), 'no lo devuelve');
});

test('Una pestaña de una IA desactivada no se registra ni notifica', () => {
  const sw = read('background/service-worker.js');
  const i = sw.indexOf("case 'CC_REGISTER'");
  const block = sw.slice(i, i + 600);
  assert.ok(block.includes('isProviderEnabled'), 'registra sin comprobar el ajuste');
  assert.ok(block.includes('disabled: true'), 'no avisa al content script');
});

test('El content script se detiene cuando su IA está desactivada', () => {
  const c = read('content/content-main.js');
  assert.ok(/function stopEverything/.test(c), 'falta stopEverything');
  assert.ok(c.includes('resp.disabled'), 'no reacciona a la respuesta del SW');
  assert.ok(/if \(disabled\) return;/.test(c), 'sigue evaluando aunque esté desactivado');
});

test('Los ajustes por proveedor viajan a las pestañas al cambiarlos', () => {
  const sw = read('background/service-worker.js');
  assert.ok(sw.includes('providers: s.providers'), 'CC_SETTINGS no incluye providers');
});

test('Opciones expone un interruptor por cada proveedor', () => {
  const h = read('options/options.html');
  for (const id of ['pClaude', 'pChatgpt']) {
    assert.ok(h.includes(`id="${id}"`), `falta el toggle ${id}`);
  }
});

/* ── Buen comportamiento con los proveedores ────────────────────────── */
test('La alarma periódica solo refresca Claude en segundo plano', () => {
  const sw = read('background/service-worker.js');
  const i = sw.indexOf('USAGE_ALARM) {');
  const block = sw.slice(i, i + 600);
  assert.ok(block.includes("isProviderEnabled('claude')"), 'Claude debe refrescarse en segundo plano');
});

test('Gemini está completamente eliminado del proyecto', () => {
  const files = ['background/service-worker.js', 'background/network-signals.js',
                 'background/usage-adapters.js', 'background/usage-multi.js',
                 'content/detector.js', 'popup/popup.js', 'popup/popup.html',
                 'options/options.js', 'options/options.html',
                 'offscreen/offscreen.js', 'manifest.json', 'shared/tokens.css'];
  for (const f of files) {
    assert.ok(!/gemini/i.test(read(f)), `${f} todavía menciona Gemini`);
  }
  const m = JSON.parse(read('manifest.json'));
  assert.ok(!m.permissions.includes('declarativeNetRequest'),
    'el permiso declarativeNetRequest solo existía para Gemini');
  assert.ok(!m.declarative_net_request, 'quedan reglas DNR');
  assert.ok(!fs.existsSync(path.join(ROOT, 'rules.json')), 'rules.json era solo para Gemini');
  assert.ok(!fs.existsSync(path.join(ROOT, 'content/gemini-usage.js')));
});

test('Terminar una tarea solo refresca el uso de Claude', () => {
  const sw = read('background/service-worker.js');
  const i = sw.indexOf('function scheduleUsageRefresh');
  const block = sw.slice(i, i + 500);
  assert.ok(block.includes("provider !== 'claude'"), 'debe descartar todo lo que no sea Claude');
});

test('Existe un suelo de frecuencia para ChatGPT', () => {
  const u = read('background/usage-multi.js');
  assert.ok(/MIN_INTERVAL_MS/.test(u), 'falta el suelo de frecuencia');
  assert.ok(/chatgpt:\s*10\s*\*\s*60/.test(u), 'ChatGPT debe tener suelo de 10 min');
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
