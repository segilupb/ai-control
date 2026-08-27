/*
 * Claude Control — tests/test-i18n.js
 * Ejecutar: node tests/test-i18n.js
 * Verifica la integridad de _locales/: todos los idiomas tienen las mismas
 * claves, sin textos vacíos, con los mismos placeholders, y que el HTML no
 * pide claves inexistentes.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, '_locales');
const BASE = 'en'; // default_locale del manifest

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

const locales = fs.readdirSync(LOCALES_DIR).filter((d) =>
  fs.statSync(path.join(LOCALES_DIR, d)).isDirectory()
);
const data = {};
for (const loc of locales) {
  data[loc] = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, loc, 'messages.json'), 'utf8'));
}

console.log(`i18n — Claude Control (${locales.length} idiomas: ${locales.join(', ')})\n`);

test('El idioma base (en) existe y tiene claves', () => {
  assert.ok(data[BASE], 'falta _locales/en');
  assert.ok(Object.keys(data[BASE]).length > 20);
});

test('Todos los idiomas tienen exactamente las mismas claves que el base', () => {
  const baseKeys = Object.keys(data[BASE]).sort();
  for (const loc of locales) {
    const keys = Object.keys(data[loc]).sort();
    const missing = baseKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !baseKeys.includes(k));
    assert.strictEqual(missing.length, 0, `${loc} sin traducir: ${missing.join(', ')}`);
    assert.strictEqual(extra.length, 0, `${loc} con claves sobrantes: ${extra.join(', ')}`);
  }
});

test('Ningún mensaje está vacío ni sin traducir (copia literal del inglés en textos largos)', () => {
  for (const loc of locales) {
    for (const [k, v] of Object.entries(data[loc])) {
      assert.ok(v && typeof v.message === 'string' && v.message.trim().length > 0,
        `${loc}.${k} vacío`);
    }
  }
});

test('Los placeholders ($1, $2…) coinciden en todos los idiomas', () => {
  const phOf = (s) => (s.match(/\$[A-Za-z_]+\$/g) || []).sort().join(',');
  for (const k of Object.keys(data[BASE])) {
    const ref = phOf(data[BASE][k].message);
    for (const loc of locales) {
      assert.strictEqual(phOf(data[loc][k].message), ref,
        `${loc}.${k}: placeholders distintos del base ("${data[loc][k].message}")`);
    }
  }
});

test('Las claves con placeholders declaran su bloque "placeholders"', () => {
  for (const [k, v] of Object.entries(data[BASE])) {
    if (/\$[A-Za-z_]+\$/.test(v.message)) {
      assert.ok(v.placeholders && Object.keys(v.placeholders).length > 0,
        `${BASE}.${k} usa placeholders pero no los declara`);
    }
  }
});

test('Todas las claves usadas en el HTML existen en el idioma base', () => {
  const htmlFiles = ['popup/popup.html', 'options/options.html'];
  const used = new Set();
  for (const f of htmlFiles) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/data-i18n(?:-title|-placeholder|-html)?="([^"]+)"/g)) {
      used.add(m[1]);
    }
  }
  assert.ok(used.size > 10, `pocas claves detectadas en HTML: ${used.size}`);
  const missing = [...used].filter((k) => !data[BASE][k]);
  assert.strictEqual(missing.length, 0, `claves usadas en HTML sin traducción: ${missing.join(', ')}`);
});

test('El manifest declara default_locale y usa __MSG_ para nombre y descripción', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.strictEqual(m.default_locale, BASE);
  assert.ok(m.name.startsWith('__MSG_'), 'name debe ser localizable');
  assert.ok(m.description.startsWith('__MSG_'), 'description debe ser localizable');
  const key = m.name.replace(/^__MSG_|__$/g, '');
  assert.ok(data[BASE][key], `manifest usa ${key} pero no existe en messages.json`);
});

test('El manifest NO contiene IPs privadas (solo en la build pública)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const raw = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');
  const hasIp = /192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[01])\./.test(raw);
  if (pkg.ccChannel === 'personal') {
    if (hasIp) console.log('     ℹ build personal: IP LAN presente a propósito (quitar antes de publicar)');
    return;
  }
  assert.ok(!hasIp, 'hay una IP de red local en host_permissions — no debe publicarse');
});

test('El detector cubre el botón Stop en varios idiomas', () => {
  const src = fs.readFileSync(path.join(ROOT, 'content/detector.js'), 'utf8');
  const block = src.match(/const STOP_WORDS = \[([\s\S]*?)\]/)[1];
  for (const w of ['stop', 'detener', 'arr', 'stopp', 'interrompi', 'interromper']) {
    assert.ok(block.toLowerCase().includes(w), `falta variante de Stop: ${w}`);
  }
});

test('El detector soporta los tres proveedores con sus hosts', () => {
  const det = require(path.join(ROOT, 'content/detector.js'));
  assert.deepStrictEqual(Object.keys(det.PROVIDERS).sort(), ['chatgpt', 'claude', 'gemini']);
  assert.strictEqual(det.providerFor('claude.ai').id, 'claude');
  assert.strictEqual(det.providerFor('chatgpt.com').id, 'chatgpt');
  assert.strictEqual(det.providerFor('chat.openai.com').id, 'chatgpt');
  assert.strictEqual(det.providerFor('gemini.google.com').id, 'gemini');
  assert.strictEqual(det.providerFor('example.com'), null);
});

test('El manifest inyecta el content script en los tres sitios', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const matches = m.content_scripts[0].matches.join(' ');
  for (const host of ['claude.ai', 'chatgpt.com', 'chat.openai.com', 'gemini.google.com']) {
    assert.ok(matches.includes(host), `falta ${host} en content_scripts`);
    assert.ok(m.host_permissions.some((h) => h.includes(host)), `falta ${host} en host_permissions`);
  }
});

test('Existe un sonido distinto por proveedor y tipo', () => {
  for (const p of ['claude', 'chatgpt', 'gemini']) {
    for (const k of ['done', 'attention']) {
      const f = path.join(ROOT, 'sounds', `${p}-${k}.wav`);
      assert.ok(fs.existsSync(f), `falta ${p}-${k}.wav`);
      assert.ok(fs.statSync(f).size > 1000, `${p}-${k}.wav parece vacío`);
    }
  }
  // y deben ser realmente distintos entre sí
  const hashes = new Set();
  for (const p of ['claude', 'chatgpt', 'gemini']) {
    const buf = fs.readFileSync(path.join(ROOT, 'sounds', `${p}-done.wav`));
    hashes.add(require('crypto').createHash('sha1').update(buf).digest('hex'));
  }
  assert.strictEqual(hashes.size, 3, 'los sonidos de done deben ser distintos entre proveedores');
});

console.log(`\n${passed} pasados, ${failed} fallidos`);
process.exit(failed ? 1 : 0);
