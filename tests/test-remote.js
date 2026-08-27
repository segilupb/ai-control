/*
 * Claude Control — tests/test-remote.js
 * Ejecutar: node tests/test-remote.js
 */
'use strict';
const assert = require('assert');
const { createRemote } = require('../background/remote.js');

function makeEnv(remoteSettings) {
  const calls = [];
  const r = createRemote({
    fetchFn: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; },
    getSettings: async () => ({ remote: remoteSettings }),
  });
  return { r, calls };
}

const TOPIC = 'claude-ctrl-abc12345';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

(async () => {
  console.log('Remote (ntfy) — Claude Control\n');

  await test('Apagado por defecto: sin settings no envía nada', async () => {
    const { r, calls } = makeEnv(undefined);
    const res = await r.send('done', 'Project Alpha');
    assert.strictEqual(res.sent, false);
    assert.strictEqual(res.reason, 'disabled');
    assert.strictEqual(calls.length, 0);
  });

  await test('Habilitado sin topic válido → no envía (no-topic)', async () => {
    const { r, calls } = makeEnv({ enabled: true, topic: 'x' });
    const res = await r.send('done', null);
    assert.strictEqual(res.reason, 'no-topic');
    assert.strictEqual(calls.length, 0);
  });

  await test('done: mensaje GENÉRICO por defecto — el título de la conversación NO viaja', async () => {
    const { r, calls } = makeEnv({ enabled: true, topic: TOPIC });
    const res = await r.send('done', 'Migración Project Alpha con datos privados');
    assert.strictEqual(res.sent, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, `https://ntfy.sh/${TOPIC}`);
    assert.strictEqual(calls[0].init.body, 'A task has finished');
    assert.ok(!JSON.stringify(calls[0]).includes('Project Alpha'), 'el título no debe aparecer en ninguna parte');
    assert.strictEqual(calls[0].init.headers.Title, 'Claude finished');
  });

  await test('includeTitle=true (segundo opt-in) → sí incluye el título', async () => {
    const { r, calls } = makeEnv({ enabled: true, topic: TOPIC, includeTitle: true });
    await r.send('done', 'Auditoría');
    assert.strictEqual(calls[0].init.body, 'Auditoría');
  });

  await test('attention: Priority high y tag warning', async () => {
    const { r, calls } = makeEnv({ enabled: true, topic: TOPIC });
    await r.send('attention', null);
    assert.strictEqual(calls[0].init.headers.Priority, 'high');
    assert.strictEqual(calls[0].init.headers.Tags, 'warning');
    assert.strictEqual(calls[0].init.body, 'Your intervention is required');
  });

  await test('Toggles granulares: onDone=false bloquea done pero no attention', async () => {
    const { r, calls } = makeEnv({ enabled: true, topic: TOPIC, onDone: false });
    const a = await r.send('done', null);
    const b = await r.send('attention', null);
    assert.strictEqual(a.sent, false);
    assert.strictEqual(b.sent, true);
    assert.strictEqual(calls.length, 1);
  });

  await test('test: funciona aunque enabled=false (para el botón de prueba)', async () => {
    const { r, calls } = makeEnv({ enabled: false, topic: TOPIC });
    const res = await r.send('test', null);
    assert.strictEqual(res.sent, true);
    assert.ok(calls[0].init.body.includes('Test'));
  });

  await test('Servidor con barra final → URL limpia', async () => {
    const { r, calls } = makeEnv({ enabled: true, topic: TOPIC, server: 'https://ntfy.sh///' });
    await r.send('done', null);
    assert.strictEqual(calls[0].url, `https://ntfy.sh/${TOPIC}`);
  });

  await test('Servidor LAN personalizado: la petición va a la IP local', async () => {
    const { r, calls } = makeEnv({ enabled: true, topic: TOPIC, server: 'http://192.168.1.50:8080' });
    const res = await r.send('done', null);
    assert.strictEqual(res.sent, true);
    assert.strictEqual(calls[0].url, `http://192.168.1.50:8080/${TOPIC}`);
  });

  await test('Fallo de red → sent:false sin excepción', async () => {
    const r = createRemote({
      fetchFn: async () => { throw new Error('offline'); },
      getSettings: async () => ({ remote: { enabled: true, topic: TOPIC } }),
    });
    const res = await r.send('done', null);
    assert.strictEqual(res.sent, false);
    assert.ok(res.reason.startsWith('network'), 'motivo network con detalle: ' + res.reason);
  });

  await test('REGRESIÓN: las cabeceras nunca llevan caracteres no-ASCII (rompían fetch)', async () => {
    // Idioma base (inglés): ya es ASCII
    const { r, calls } = makeEnv({ enabled: true, topic: TOPIC });
    await r.send('done', null);
    await r.send('attention', null);
    assert.strictEqual(calls[0].init.headers.Title, 'Claude finished');
    assert.strictEqual(calls[1].init.headers.Title, 'Claude needs your attention');

    // Idioma con acentos (es/fr/de/pt): la cabecera DEBE limpiarse
    const acc = [];
    const localized = createRemote({
      fetchFn: async (url, init) => { acc.push({ url, init }); return { ok: true, status: 200 }; },
      getSettings: async () => ({ remote: { enabled: true, topic: TOPIC } }),
      t: (k) => ({ finishedWord: 'terminó', needsAttentionWord: 'necesita tu atención' })[k] || null,
    });
    await localized.send('done', null, 'Claude');
    await localized.send('attention', null, 'ChatGPT');
    assert.strictEqual(acc[0].init.headers.Title, 'Claude termino');
    assert.strictEqual(acc[1].init.headers.Title, 'ChatGPT necesita tu atencion');

    for (const c of [...calls, ...acc]) {
      for (const [k, v] of Object.entries(c.init.headers)) {
        assert.ok(/^[\x20-\x7E]*$/.test(v), `cabecera ${k} con carácter inválido: ${v}`);
      }
    }
  });

  await test('El CUERPO sí conserva tildes y título original (va en UTF-8)', async () => {
    const { r, calls } = makeEnv({ enabled: true, topic: TOPIC, includeTitle: true });
    await r.send('done', 'Migración auditoría ñandú');
    assert.strictEqual(calls[0].init.body, 'Migración auditoría ñandú');
  });

  await test('asciiHeader: limpia acentos y emoji, respeta ASCII', async () => {
    const { r } = makeEnv();
    assert.strictEqual(r.asciiHeader('Atención ⚠️ señor'), 'Atencion  senor');
    assert.strictEqual(r.asciiHeader('Plain ASCII 123'), 'Plain ASCII 123');
  });

  await test('El aviso al teléfono identifica la IA (título y tags)', async () => {
    const { r, calls } = makeEnv({ enabled: true, topic: TOPIC });
    await r.send('done', null, 'ChatGPT');
    await r.send('attention', null, 'ChatGPT');
    assert.strictEqual(calls[0].init.headers.Title, 'ChatGPT finished');
    assert.ok(calls[0].init.headers.Tags.startsWith('chatgpt,'), `tags: ${calls[0].init.headers.Tags}`);
    assert.strictEqual(calls[1].init.headers.Title, 'ChatGPT needs your attention');
    assert.ok(calls[1].init.headers.Tags.startsWith('chatgpt,'));
  });

  await test('generateTopic: prefijo, longitud y unicidad razonable', async () => {
    const { r } = makeEnv();
    const t1 = r.generateTopic();
    const t2 = r.generateTopic();
    assert.ok(t1.startsWith('claude-ctrl-'));
    assert.ok(t1.length >= 24);
    assert.notStrictEqual(t1, t2);
  });

  console.log(`\n${passed} pasados, ${failed} fallidos`);
  process.exit(failed ? 1 : 0);
})();
