/*
 * Claude Control — options/options.js
 * Guardado instantáneo (debounce 300 ms) en storage.local; el SW propaga
 * settleMs/minTaskMs a los content scripts vivos y el resto lo lee al vuelo.
 */
'use strict';

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  notifyDone: true,
  notifyAttention: true,
  autoDismissSeconds: 25,
  sound: { enabled: true, volume: 0.7 },
  settleMs: 4000,
  minTaskMs: 1500,
  usage: { thresholdsEnabled: true, thresholds: { session: 80, weekly: 80 } },
  historyEnabled: true,
  remote: { enabled: false, server: 'https://ntfy.sh', topic: '', includeTitle: false, onDone: true, onAttention: true },
  providers: { claude: true, chatgpt: true },
};

let settings = structuredClone(DEFAULTS);
let saveTimer = null;

// ── Carga / guardado ──────────────────────────────────────────────────
async function load() {
  const { settings: st } = await chrome.storage.local.get('settings');
  settings = deepMerge(structuredClone(DEFAULTS), st || {});
  render();
}

function deepMerge(base, over) {
  for (const k of Object.keys(over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) {
      base[k] = deepMerge(base[k] || {}, over[k]);
    } else if (over[k] !== undefined) {
      base[k] = over[k];
    }
  }
  return base;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ settings });
    const s = $('saved');
    s.hidden = false;
    s.style.opacity = '1';
    setTimeout(() => { s.style.opacity = '0'; }, 1200);
  }, 300);
}

// ── Render de controles ───────────────────────────────────────────────
function render() {
  $('notifyDone').checked = settings.notifyDone;
  $('notifyAttention').checked = settings.notifyAttention;
  $('autoDismissSeconds').value = settings.autoDismissSeconds;
  $('soundEnabled').checked = settings.sound.enabled;
  $('soundVolume').value = Math.round(settings.sound.volume * 100);
  $('settleMs').value = settings.settleMs;
  $('minTaskMs').value = settings.minTaskMs;
  $('thresholdsEnabled').checked = settings.usage.thresholdsEnabled;
  $('thSession').value = settings.usage.thresholds.session;
  $('thWeekly').value = settings.usage.thresholds.weekly;
  $('historyEnabled').checked = settings.historyEnabled;
  $('pClaude').checked = settings.providers.claude !== false;
  $('pChatgpt').checked = settings.providers.chatgpt !== false;
  $('remoteEnabled').checked = settings.remote.enabled;
  $('remoteServer').value = settings.remote.server || 'https://ntfy.sh';
  updateServerStatus();
  $('remoteTopic').value = settings.remote.topic;
  $('remoteIncludeTitle').checked = settings.remote.includeTitle;
  $('remoteOnDone').checked = settings.remote.onDone;
  $('remoteOnAttention').checked = settings.remote.onAttention;
  labels();
}

function labels() {
  const ad = Number($('autoDismissSeconds').value);
  $('autoDismissLabel').textContent = ad === 0
    ? 'Desactivado: la notificación se queda hasta que la cierres'
    : `~${ad} s (aproximado: Windows la recoge al Centro de actividades por su cuenta)`;
  $('volumeLabel').textContent = `${$('soundVolume').value}%`;
  $('settleLabel').textContent = `${(Number($('settleMs').value) / 1000).toFixed(1)} s`;
  $('minTaskLabel').textContent = `${(Number($('minTaskMs').value) / 1000).toFixed(2)} s`;
  $('thSessionLabel').textContent = `${$('thSession').value}%`;
  $('thWeeklyLabel').textContent = `${$('thWeekly').value}%`;
}

// ── Bindings ──────────────────────────────────────────────────────────
function bind() {
  $('notifyDone').addEventListener('change', (e) => { settings.notifyDone = e.target.checked; save(); });
  $('notifyAttention').addEventListener('change', (e) => { settings.notifyAttention = e.target.checked; save(); });
  $('autoDismissSeconds').addEventListener('input', (e) => {
    settings.autoDismissSeconds = Number(e.target.value); labels(); save();
  });
  $('soundEnabled').addEventListener('change', (e) => { settings.sound.enabled = e.target.checked; save(); });
  $('soundVolume').addEventListener('input', (e) => {
    settings.sound.volume = Number(e.target.value) / 100; labels(); save();
  });
  $('settleMs').addEventListener('input', (e) => { settings.settleMs = Number(e.target.value); labels(); save(); });
  $('minTaskMs').addEventListener('input', (e) => { settings.minTaskMs = Number(e.target.value); labels(); save(); });
  $('thresholdsEnabled').addEventListener('change', (e) => { settings.usage.thresholdsEnabled = e.target.checked; save(); });
  $('thSession').addEventListener('input', (e) => { settings.usage.thresholds.session = Number(e.target.value); labels(); save(); });
  $('thWeekly').addEventListener('input', (e) => { settings.usage.thresholds.weekly = Number(e.target.value); labels(); save(); });
  $('historyEnabled').addEventListener('change', (e) => { settings.historyEnabled = e.target.checked; save(); });

  // Toggles por proveedor
  $('pClaude').addEventListener('change', (e) => { settings.providers.claude = e.target.checked; save(); });
  $('pChatgpt').addEventListener('change', (e) => { settings.providers.chatgpt = e.target.checked; save(); });

  // Prueba de sonido por IA (cada una suena distinto)
  document.querySelectorAll('[data-sound]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      playTest('done', btn.getAttribute('data-sound'));
    });
  });
  $('testAttention').addEventListener('click', () => playTest('attention', 'claude'));

  $('remoteEnabled').addEventListener('change', (e) => { settings.remote.enabled = e.target.checked; save(); });
  $('remoteServer').addEventListener('input', (e) => {
    settings.remote.server = e.target.value.trim() || 'https://ntfy.sh';
    save(); updateServerStatus();
  });
  $('authServer').addEventListener('click', authorizeServer);
  $('remoteTopic').addEventListener('input', (e) => { settings.remote.topic = e.target.value.trim(); save(); });
  $('remoteIncludeTitle').addEventListener('change', (e) => { settings.remote.includeTitle = e.target.checked; save(); });
  $('remoteOnDone').addEventListener('change', (e) => { settings.remote.onDone = e.target.checked; save(); });
  $('remoteOnAttention').addEventListener('change', (e) => { settings.remote.onAttention = e.target.checked; save(); });
  $('genTopic').addEventListener('click', async () => {
    const r = await sendMsg('CC_REMOTE_GEN_TOPIC');
    if (r && r.topic) { settings.remote.topic = r.topic; $('remoteTopic').value = r.topic; save(); }
  });
  $('remoteTest').addEventListener('click', async () => {
    const out = $('remoteTestResult');
    out.textContent = 'enviando…';
    // guardar lo pendiente antes de probar
    clearTimeout(saveTimer);
    await chrome.storage.local.set({ settings });
    const r = await sendMsg('CC_REMOTE_TEST');
    out.textContent = r && r.sent
      ? '✓ enviado — mira el teléfono'
      : `✗ no enviado (${(r && r.reason) || 'sin respuesta'})`;
    out.style.color = r && r.sent ? 'var(--green)' : 'var(--red)';
  });

  $('exportHistory').addEventListener('click', exportHistory);
  $('clearHistory').addEventListener('click', clearHistory);
}

function playTest(kind, provider) {
  const p = ['claude', 'chatgpt'].includes(provider) ? provider : 'claude';
  const a = new Audio(`../sounds/${p}-${kind}.wav`);
  a.volume = settings.sound.volume;
  a.play().catch(() => {});
}

// ── Historial ─────────────────────────────────────────────────────────
function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

const TT = (k) => (window.__ccI18n && window.__ccI18n.t(k)) || null;
const OUTCOME = {
  completed: ['outcomeCompleted', 'Finished', 'oc-completed'],
  attention: ['outcomeAttention', 'Attention', 'oc-attention'],
  abandoned: ['outcomeAbandoned', 'Abandoned', 'oc-abandoned'],
};

// ── Servidor personalizado: permiso solo para SU origen exacto ────────
function serverOriginPattern() {
  try {
    const u = new URL(settings.remote.server || 'https://ntfy.sh');
    // Los match patterns de las extensiones NO admiten puerto: usar hostname.
    return `${u.protocol}//${u.hostname}/*`;
  } catch (_e) { return null; }
}

async function updateServerStatus() {
  const el = $('serverStatus');
  const pat = serverOriginPattern();
  if (!pat) { el.textContent = '✗ URL no válida'; el.style.color = 'var(--red)'; return; }
  if (pat === 'https://ntfy.sh/*') {
    el.textContent = '✓ ntfy.sh — autorizado de serie';
    el.style.color = 'var(--green)';
    $('authServer').style.display = 'none';
    return;
  }
  $('authServer').style.display = '';
  let granted = false;
  try { granted = await chrome.permissions.contains({ origins: [pat] }); } catch (_e) {}
  el.textContent = granted
    ? `✓ autorizado (${pat})`
    : 'Permiso no concedido — ntfy suele funcionar igual; pulsa «Enviar prueba» para comprobarlo';
  el.style.color = granted ? 'var(--green)' : 'var(--dim)';
}

async function authorizeServer() {
  const el = $('serverStatus');
  const pat = serverOriginPattern();
  if (!pat) {
    el.textContent = '✗ URL no válida — usa el formato http://IP:PUERTO';
    el.style.color = 'var(--red)';
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [pat] });
    if (!granted) {
      el.textContent = 'Permiso no concedido. ntfy suele aceptar peticiones del navegador igualmente: pulsa «Enviar prueba».';
      el.style.color = 'var(--dim)';
      return;
    }
  } catch (e) {
    // Edge no siempre permite pedir hosts opcionales. No es bloqueante:
    // ntfy responde con CORS abierto, así que el envío suele funcionar igual.
    el.textContent = 'Tu Edge no permite pedir este permiso, pero no suele hacer falta: pulsa «Enviar prueba».';
    el.style.color = 'var(--dim)';
    return;
  }
  updateServerStatus();
}

function sendMsg(type) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ ns: 'cc', type }, (r) => {
      void chrome.runtime.lastError;
      resolve(r || null);
    });
  });
}

let cachedHistory = [];

async function loadHistory() {
  const resp = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ ns: 'cc', type: 'CC_HISTORY_GET' }, (r) => {
      void chrome.runtime.lastError;
      resolve(r || { entries: [] });
    });
  });
  cachedHistory = resp.entries || [];
  const body = $('histBody');
  body.textContent = '';
  $('histEmpty').hidden = cachedHistory.length > 0;
  $('histTable').style.display = cachedHistory.length ? '' : 'none';

  for (const e of cachedHistory.slice(0, 50)) {
    const tr = document.createElement('tr');
    const o = OUTCOME[e.outcome];
    const label = o ? (TT(o[0]) || o[1]) : e.outcome;
    const cls = o ? o[2] : '';
    const PROV = { claude: 'Claude', chatgpt: 'ChatGPT' };
    const ICON = { completed: '✓', attention: '⚠', abandoned: '·' };

    // Proveedor como pill (mismo lenguaje visual que el popup)
    const tdProv = document.createElement('td');
    tdProv.className = 'prov-cell';
    if (PROV[e.provider]) {
      const pill = document.createElement('span');
      pill.className = `pill ${e.provider}`;
      pill.textContent = PROV[e.provider];
      tdProv.appendChild(pill);
    } else {
      tdProv.textContent = '—';
    }
    tr.appendChild(tdProv);

    // Resultado con icono + texto (nunca solo color)
    const tdOut = document.createElement('td');
    const wrap = document.createElement('span');
    wrap.className = `oc ${cls}`;
    wrap.textContent = `${ICON[e.outcome] || ''} ${label}${e.reason ? ` (${e.reason})` : ''}`.trim();
    tdOut.appendChild(wrap);

    const rest = [
      ['name', e.conversationTitle || TT('untitled') || '(untitled)'],
      [null, tdOut],
      ['', fmtDur(e.durationMs)],
      ['mono', new Date(e.at).toLocaleString()],
    ];
    for (const [c, val] of rest) {
      if (c === null) { tr.appendChild(val); continue; }
      const td = document.createElement('td');
      if (c) td.className = c;
      td.textContent = val;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function exportHistory() {
  const blob = new Blob([JSON.stringify(cachedHistory, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `claude-control-historial-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearHistory() {
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ ns: 'cc', type: 'CC_HISTORY_CLEAR' }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
  loadHistory();
}

// ── Init ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  $('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  bind();
  await load();
  await loadHistory();
});
