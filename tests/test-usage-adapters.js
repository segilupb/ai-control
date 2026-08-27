/*
 * AI Control — tests/test-usage-adapters.js
 * Ejecutar: node tests/test-usage-adapters.js
 *
 * Fixtures con el shape REAL de cada fuente (verificado contra los repos
 * auditados) + casos de degradación: campos ausentes, shape cambiado,
 * 401/403/429, offline, cache stale y ventana ya reseteada.
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

const GEMINI_HTML_OK = `<html><head><title>Usage</title></head><body>
  <section data-test-id="gxu-currently"><p>41% used</p><p>Resets in 3 hours</p></section>
  <section data-test-id="gxu-weekly"><p>18% used</p><p>Resets Monday</p></section>
</body></html>`;

const GEMINI_HTML_NOSELECTORS = `<html><head><title>Usage</title></head><body>
  <div><span>Current usage</span><span>63% used</span><span>Resets in 2 hours</span></div>
  <div><span>Weekly limit</span><span>12% used</span><span>Resets Sunday</span></div>
</body></html>`;

/* Textos reales de la página en español (captura del usuario, plan Pro):
   «Uso actual … 11% usado … Se restablece a la(s) 1:29 a.m.»
   «Límite semanal … Se restablece el 2 sept a la(s) 3:29 p.m. … 2% usado» */
const GEMINI_HTML_ES = `<html><head><title>Límites de uso</title></head><body>
  <section><h2>Uso actual</h2><span>11% usado</span><p>Se restablece a la(s) 1:29 a.m.</p></section>
  <section><h2>Límite semanal</h2><p>Se restablece el 2 sept a la(s) 3:29 p.m.</p><span>2% usado</span></section>
</body></html>`;

const GEMINI_HTML_LOGIN = `<html><head><title>Sign in - Google Accounts</title></head>
  <body><input type="password"></body></html>`;

/* Parser HTML mínimo para Node (sin dependencias): suficiente para los
   selectores y el recorrido de texto que usa el adaptador. */
function tinyParse(html) {
  const nodes = [];
  const titleM = html.match(/<title>([^<]*)<\/title>/i);
  const hasPassword = /type=["']password["']/i.test(html);

  const tagRe = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g;
  function build(src, parent) {
    let m;
    const re = new RegExp(tagRe.source, 'g');
    while ((m = re.exec(src))) {
      const [, tag, attrs, inner] = m;
      const el = {
        tagName: tag.toUpperCase(),
        _attrs: attrs,
        _inner: inner,
        parentElement: parent,
        children: [],
        get textContent() { return inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); },
        querySelectorAll: (sel) => nodes.filter((n) => n !== el && matches(n, sel) && isDesc(n, el)),
        querySelector: (sel) => nodes.find((n) => n !== el && matches(n, sel) && isDesc(n, el)) || null,
      };
      nodes.push(el);
      if (parent) parent.children.push(el);
      build(inner, el);
    }
  }
  function isDesc(node, ancestor) {
    let p = node.parentElement;
    while (p) { if (p === ancestor) return true; p = p.parentElement; }
    return false;
  }
  function matches(el, sel) {
    const parts = sel.split(',').map((s) => s.trim());
    return parts.some((s) => {
      const attr = s.match(/^\[([\w-]+)=["']([^"']+)["']\]$/);
      if (attr) return new RegExp(`${attr[1]}=["']${attr[2]}["']`).test(el._attrs);
      const cls = s.match(/^\.([\w-]+)$/);
      if (cls) return new RegExp(`class=["'][^"']*\\b${cls[1]}\\b`).test(el._attrs);
      return el.tagName === s.toUpperCase();
    });
  }
  build(html, null);
  const body = nodes.find((n) => n.tagName === 'BODY') || null;
  return {
    title: titleM ? titleM[1] : '',
    body,
    querySelector: (sel) => (sel === 'input[type="password"]' ? (hasPassword ? {} : null)
      : nodes.find((n) => matches(n, sel)) || null),
    querySelectorAll: (sel) => nodes.filter((n) => matches(n, sel)),
  };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.error(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

(async () => {
  console.log('Adaptadores de uso (Claude · ChatGPT · Gemini) — AI Control\n');

  /* ── Contrato común ─────────────────────────────────────────────── */
  await test('Los tres adaptadores devuelven el MISMO contrato', async () => {
    const snaps = [
      A.fromClaude({ fiveHour: { utilization: 34, resetsAt: '2026-01-01T00:00:00Z' },
                     sevenDay: { utilization: 61, resetsAt: '2026-01-05T00:00:00Z' } }, 1000),
      A.fromChatGPTWham(WHAM_OK, { now: 1000 }),
      A.parseGeminiDocument(tinyParse(GEMINI_HTML_OK), { now: 1000 }),
    ];
    for (const s of snaps) {
      for (const k of ['provider', 'source', 'status', 'fetchedAt', 'windows', 'extras']) {
        assert.ok(k in s, `falta ${k} en ${s.provider}`);
      }
      for (const w of s.windows) {
        for (const k of ['id', 'label', 'usedPercent', 'remainingPercent', 'resetsAt']) {
          assert.ok(k in w, `falta ${k} en window de ${s.provider}`);
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

  await test('ChatGPT: porcentajes fuera de rango se recortan', async () => {
    const s = A.fromChatGPTWham({ rate_limit: { primary_window: { used_percent: 350 } } }, { now: 1 });
    assert.strictEqual(s.windows[0].usedPercent, 100);
  });

  /* ── Gemini ─────────────────────────────────────────────────────── */
  await test('Gemini: selectores directos → current + weekly', async () => {
    const s = A.parseGeminiDocument(tinyParse(GEMINI_HTML_OK), { now: 1 });
    assert.strictEqual(s.status, 'ok');
    assert.strictEqual(s.windows.find((w) => w.id === 'session').usedPercent, 41);
    assert.strictEqual(s.windows.find((w) => w.id === 'weekly').usedPercent, 18);
  });

  await test('Gemini: sin los selectores conocidos → fallback textual funciona', async () => {
    const s = A.parseGeminiDocument(tinyParse(GEMINI_HTML_NOSELECTORS), { now: 1 });
    assert.strictEqual(s.status, 'ok');
    const weekly = s.windows.find((w) => w.id === 'weekly');
    assert.ok(weekly && weekly.usedPercent === 12, 'clasifica el 12% como semanal por contexto');
  });

  await test('Gemini EN ESPAÑOL: «11% usado» y «Límite semanal» se parsean bien', async () => {
    const s = A.parseGeminiDocument(tinyParse(GEMINI_HTML_ES), { now: 1 });
    assert.strictEqual(s.status, 'ok');
    const cur = s.windows.find((w) => w.id === 'session');
    const wk = s.windows.find((w) => w.id === 'weekly');
    assert.ok(cur, 'debe encontrar el uso actual');
    assert.strictEqual(cur.usedPercent, 11);
    assert.ok(wk, 'debe encontrar el límite semanal');
    assert.strictEqual(wk.usedPercent, 2);
  });

  await test('Gemini: «Se restablece a la(s)…» se reconoce como texto de reset', async () => {
    const s = A.parseGeminiDocument(tinyParse(GEMINI_HTML_ES), { now: 1 });
    const cur = s.windows.find((w) => w.id === 'session');
    assert.ok(cur.resetText && /restablece/i.test(cur.resetText), `resetText: ${cur.resetText}`);
  });

  await test('Gemini: variantes de idioma del porcentaje', async () => {
    const cases = [
      ['<html><body><div>Current</div><div>34% used</div></body></html>', 34],
      ['<html><body><div>Actual</div><div>56 % utilizado</div></body></html>', 56],
      ['<html><body><div>Aktuell</div><div>78% verwendet</div></body></html>', 78],
    ];
    for (const [html, expected] of cases) {
      const s = A.parseGeminiDocument(tinyParse(html), { now: 1 });
      assert.strictEqual(s.status, 'ok', html);
      assert.strictEqual(s.windows[0].usedPercent, expected, html);
    }
  });

  await test('Gemini: página de login → status auth (no error)', async () => {
    const s = A.parseGeminiDocument(tinyParse(GEMINI_HTML_LOGIN), { now: 1 });
    assert.strictEqual(s.status, 'auth');
  });

  await test('Gemini: HTML sin porcentajes → unavailable', async () => {
    const s = A.parseGeminiDocument(tinyParse('<html><body><p>Nothing here</p></body></html>'), { now: 1 });
    assert.strictEqual(s.status, 'unavailable');
  });

  await test('Gemini: documento nulo → error, sin excepción', async () => {
    assert.strictEqual(A.parseGeminiDocument(null, { now: 1 }).status, 'error');
  });

  /* ── Estados HTTP y frescura ────────────────────────────────────── */
  await test('Códigos HTTP → estado correcto', async () => {
    assert.strictEqual(A.statusFromHttp(401), 'auth');
    assert.strictEqual(A.statusFromHttp(403), 'auth');
    assert.strictEqual(A.statusFromHttp(429), 'error');
    assert.strictEqual(A.statusFromHttp(404), 'unavailable');
    assert.strictEqual(A.statusFromHttp(500), 'error');
  });

  await test('markStale: dato viejo o ventana ya reseteada → stale', async () => {
    const now = 1_700_000_000_000;
    const fresh = A.fromChatGPTWham(WHAM_OK, { now });
    assert.strictEqual(A.markStale(fresh, now).status, 'ok');
    assert.strictEqual(A.markStale(fresh, now + 31 * 60 * 1000).status, 'stale', 'más de 30 min');

    const expired = A.fromClaude({ fiveHour: { utilization: 10, resetsAt: new Date(now - 1000).toISOString() } }, now);
    assert.strictEqual(A.markStale(expired, now).status, 'stale', 'ventana ya reseteada');
  });

  /* ── Fetchers con red simulada ──────────────────────────────────── */
  function env(routes) {
    const store = {};
    const calls = [];
    const u = createUsageMulti({
      now: () => 1_700_000_000_000,
      adapters: A,
      parseHTML: tinyParse,
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

  await test('fetchGemini: HTML válido → ok', async () => {
    const { u } = env([['gemini.google.com/usage', ok(GEMINI_HTML_OK)]]);
    const s = await u.fetchGemini();
    assert.strictEqual(s.status, 'ok');
    assert.strictEqual(s.windows[0].usedPercent, 41);
  });

  await test('Gemini multi-cuenta: el índice cambia la URL (/u/N/usage)', async () => {
    const { u, calls } = env([['gemini.google.com', ok(GEMINI_HTML_OK)]]);
    await u.fetchGemini({ accountIndex: 0 });
    assert.ok(calls[0].startsWith('https://gemini.google.com/usage'), calls[0]);
    await u.fetchGemini({ accountIndex: 2 });
    assert.ok(calls[1].startsWith('https://gemini.google.com/u/2/usage'), calls[1]);
    assert.strictEqual(u.geminiUsageUrl(1), 'https://gemini.google.com/u/1/usage');
    assert.strictEqual(u.geminiUsageUrl('auto'), 'https://gemini.google.com/usage');
  });

  await test('Gemini: índices altos (9, 12) construyen la URL correcta', async () => {
    const { u, calls } = env([['gemini.google.com', ok(GEMINI_HTML_OK)]]);
    assert.strictEqual(u.geminiUsageUrl(9), 'https://gemini.google.com/u/9/usage');
    assert.strictEqual(u.geminiUsageUrl(12), 'https://gemini.google.com/u/12/usage');
    await u.fetchGemini({ accountIndex: 9 });
    assert.ok(calls[0].includes('/u/9/usage'), calls[0]);
  });

  await test('Gemini: índice inválido cae al comportamiento por defecto', async () => {
    const { u } = env([['gemini.google.com', ok(GEMINI_HTML_OK)]]);
    for (const bad of ['abc', -1, null, undefined, 1.5]) {
      assert.strictEqual(u.geminiUsageUrl(bad), 'https://gemini.google.com/usage');
    }
  });

  await test('Gemini: el índice usado queda registrado en extras', async () => {
    const { u } = env([['gemini.google.com', ok(GEMINI_HTML_OK)]]);
    const s = await u.fetchGemini({ accountIndex: 1 });
    assert.strictEqual(s.extras.accountIndex, 1);
  });

  await test('fetchGemini: redirección a login → auth', async () => {
    const { u } = env([['gemini.google.com/usage', ok('<html><head><title>Sign in</title></head><body>accounts.google.com</body></html>')]]);
    const s = await u.fetchGemini();
    assert.strictEqual(s.status, 'auth');
  });

  await test('Offline (fetch lanza) → error sin romper nada', async () => {
    const u = createUsageMulti({
      now: () => 1, adapters: A, parseHTML: tinyParse,
      fetchFn: async () => { throw new Error('offline'); },
      storageGet: async () => ({}), storageSet: async () => {},
    });
    assert.strictEqual((await u.fetchChatGPT()).status, 'error');
    assert.strictEqual((await u.fetchGemini()).status, 'error');
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
