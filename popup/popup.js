/*
 * AI Control — popup/popup.js
 * Tareas: lista unificada ordenada por prioridad. Proveedor = rail + pill;
 * estado = icono + texto. Ningún dato depende solo del color.
 * Uso: los tres proveedores con el mismo contrato; este archivo no conoce
 * ninguna API concreta (wham, /usage, api de Claude).
 */
'use strict';

const $ = (id) => document.getElementById(id);
const T = (k, subs) => (window.__ccI18n && window.__ccI18n.t(k, subs)) || null;

const PROVIDERS = {
  claude:  { name: 'Claude' },
  chatgpt: { name: 'ChatGPT' },
  gemini:  { name: 'Gemini' },
};
const PROVIDER_ORDER = ['claude', 'chatgpt', 'gemini'];
const providerOf = (t) => (PROVIDERS[t && t.provider] ? t.provider : 'claude');

const ACTIVE_STATES = ['GENERATING', 'TOOL_RUNNING', 'SETTLING'];

const STATE_KEY = {
  GENERATING: 'stateGenerating', TOOL_RUNNING: 'stateTool', SETTLING: 'stateSettling',
  COMPLETED: 'stateCompleted', NEEDS_ATTENTION: 'stateAttention',
  UNKNOWN: 'stateUnknown', IDLE: 'stateIdle',
};
const STATE_FALLBACK = {
  GENERATING: 'Generating', TOOL_RUNNING: 'Tool running', SETTLING: 'Finishing…',
  COMPLETED: 'Finished', NEEDS_ATTENTION: 'Needs attention',
  UNKNOWN: 'No signal', IDLE: 'Idle',
};
const SHORT_KEY = {
  NEEDS_ATTENTION: ['stateAttentionShort', 'Attention'],
  COMPLETED: ['stateCompletedShort', 'Done'],
  TOOL_RUNNING: ['stateToolShort', 'Tool'],
};
const stateLabel = (s) => T(STATE_KEY[s]) || STATE_FALLBACK[s] || s;
const shortLabel = (s) => (SHORT_KEY[s] ? (T(SHORT_KEY[s][0]) || SHORT_KEY[s][1]) : stateLabel(s));

function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ ns: 'cc', ...msg }, (resp) => {
        void chrome.runtime.lastError;
        resolve(resp || null);
      });
    } catch (_e) { resolve(null); }
  });
}

/* ── Tiempos ───────────────────────────────────────────────────────── */
function rel(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function untilReset(iso) {
  if (!iso) return '';
  const diff = new Date(iso) - Date.now();
  if (Number.isNaN(diff)) return '';
  if (diff <= 0) return T('resetting') || 'resetting…';
  const m = Math.floor(diff / 60000);
  if (m < 60) return T('resetIn', [`${m}m`]) || `resets in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return T('resetIn', [`${h}h ${m % 60}m`]) || `resets in ${h}h`;
  return (T('resetLabel') || 'Reset') + ' ' +
    new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ── Uso multi-proveedor ───────────────────────────────────────────── */
const STATUS_TEXT = {
  stale: ['usageStale', 'stale'],
  auth: ['usageAuth', 'sign in'],
  unavailable: ['usageUnavailable', 'not published'],
  error: ['usageError', 'unavailable'],
};

let lastUsageFetchedAt = null;

function bar(pct, provider) {
  const wrap = document.createElement('span');
  wrap.className = 'ubar';
  const fill = document.createElement('i');
  fill.className = `ufill ${provider}`;
  fill.style.width = `${Math.max(2, Math.min(100, pct))}%`;
  wrap.appendChild(fill);
  return wrap;
}

function windowRow(w, provider) {
  const block = document.createElement('div');
  block.className = 'ublock';

  const row = document.createElement('div');
  row.className = 'urow';

  const label = document.createElement('span');
  label.className = 'ulabel';
  label.textContent = w.label === '5h' ? (T('meter5h') || '5 hours')
    : w.label === 'weekly' ? (T('meterWeek') || 'Week')
    : w.label === 'current' ? (T('meterCurrent') || 'Current')
    : w.label;

  const pct = document.createElement('span');
  pct.className = 'upct mono';
  pct.textContent = `${Math.round(w.usedPercent)}%`;

  row.append(label, bar(w.usedPercent, provider), pct);
  block.append(row);

  const resetText = w.resetsAt ? untilReset(w.resetsAt) : (w.resetText || '');
  if (resetText) {
    const reset = document.createElement('div');
    reset.className = 'ureset mono';
    reset.textContent = resetText;
    block.append(reset);
  }
  return block;
}

function providerUsage(snapshot, providerId) {
  const box = document.createElement('div');
  box.className = 'uprov';

  const head = document.createElement('div');
  head.className = 'uhead';
  const pill = document.createElement('span');
  pill.className = `pill ${providerId}`;
  pill.textContent = PROVIDERS[providerId].name;
  head.appendChild(pill);

  // Alcance: nunca presentar Work/Codex como si fuera todo ChatGPT
  if (snapshot && snapshot.extras && snapshot.extras.scope === 'work-codex') {
    const scope = document.createElement('span');
    scope.className = 'uscope';
    scope.textContent = T('scopeWorkCodex') || 'Work/Codex';
    head.appendChild(scope);
  }

  const status = snapshot ? snapshot.status : 'unavailable';
  if (status !== 'ok') {
    const tag = document.createElement('span');
    tag.className = `ustatus ${status}`;
    const s = STATUS_TEXT[status] || STATUS_TEXT.error;
    tag.textContent = T(s[0]) || s[1];
    head.appendChild(tag);
  }
  box.appendChild(head);

  const windows = (snapshot && snapshot.windows) || [];
  if (windows.length) {
    for (const w of windows) box.appendChild(windowRow(w, providerId));
    if (snapshot.extras && typeof snapshot.extras.credits === 'number') {
      const c = document.createElement('div');
      c.className = 'ureset mono';
      c.textContent = `${T('credits') || 'Credits'}: ${snapshot.extras.credits}`;
      box.appendChild(c);
    }
  } else {
    const note = document.createElement('div');
    note.className = 'unote';
    note.textContent = status === 'auth'
      ? (T('usageAuthHint') || 'Open the site and sign in to read usage.')
      : (T('usageNoneHint') || 'This provider does not publish usage data.');
    box.appendChild(note);
  }
  return box;
}

function renderUsage(all) {
  const host = $('usage-providers');
  const panel = $('usage-panel');
  if (!host || !all) return;
  host.textContent = '';

  // Solo las IAs activadas en Opciones: quien use una sola no debe ver dos
  // bloques vacíos de las otras.
  const enabled = all.enabled || { claude: true, chatgpt: true, gemini: true };
  const shown = PROVIDER_ORDER.filter((p) => enabled[p] !== false && all[p]);

  if (panel) panel.hidden = shown.length === 0;   // sin nada que mostrar, fuera el panel
  if (!shown.length) return;

  for (const p of shown) host.appendChild(providerUsage(all[p], p));

  const stamps = shown.map((p) => all[p] && all[p].fetchedAt).filter(Boolean);
  lastUsageFetchedAt = stamps.length ? Math.max(...stamps) : null;

  // Vista rápida de la cabecera: la primera IA activa que tenga datos.
  let peekText = '';
  for (const p of shown) {
    const w = all[p] && all[p].windows && all[p].windows.find((x) => x.id === 'session');
    if (w) { peekText = `${PROVIDERS[p].name} ${Math.round(w.usedPercent)}%`; break; }
  }
  $('usage-peek').textContent = peekText;
  renderUsageMeta();
}

function renderUsageMeta() {
  $('usage-meta').textContent = lastUsageFetchedAt
    ? (T('updatedAgo', [rel(Date.now() - lastUsageFetchedAt)]) || `updated ${rel(Date.now() - lastUsageFetchedAt)} ago`)
    : '';
}

async function refreshUsage(force) {
  if (force) {
    const btn = $('usage-refresh');
    btn.classList.add('spin');
    await send({ type: 'CC_USAGE_REFRESH_ALL' });
    btn.classList.remove('spin');
  }
  renderUsage(await send({ type: 'CC_USAGE_ALL' }));
}

/* ── Tareas ────────────────────────────────────────────────────────── */
const RANK = {
  NEEDS_ATTENTION: 0, GENERATING: 1, TOOL_RUNNING: 1, SETTLING: 1,
  COMPLETED: 2, UNKNOWN: 3, IDLE: 4,
};

function stateVisual(t) {
  if (t.state === 'NEEDS_ATTENTION') {
    return { cls: 'attn', ico: '⚠', text: shortLabel(t.state), full: stateLabel(t.state) };
  }
  if (t.state === 'COMPLETED') {
    const ago = t.taskEndedAt ? rel(Date.now() - t.taskEndedAt) : '';
    return { cls: 'done', ico: '✓', text: ago || shortLabel(t.state), full: stateLabel(t.state) };
  }
  if (ACTIVE_STATES.includes(t.state)) {
    const since = t.taskStartedAt ? rel(Date.now() - t.taskStartedAt) : '';
    const lbl = shortLabel(t.state);
    return { cls: 'active', ico: '', text: since ? `${lbl} · ${since}` : lbl, full: stateLabel(t.state) };
  }
  if (t.state === 'UNKNOWN') return { cls: 'unknown', ico: '?', text: shortLabel(t.state), full: stateLabel(t.state) };
  return { cls: 'idle', ico: '', text: shortLabel(t.state), full: stateLabel(t.state) };
}

function renderTasks(snapshot) {
  const list = $('tasks');
  const empty = $('tasks-empty');
  const tabs = (snapshot && snapshot.tabs) || [];

  tabs.sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || a.tabId - b.tabId);
  list.textContent = '';
  empty.hidden = tabs.length > 0;

  tabs.forEach((t, i) => {
    const p = providerOf(t);
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.className = `p-${p} is-${(t.state || 'idle').toLowerCase()}`;
    li.title = `${PROVIDERS[p].name} · ${stateLabel(t.state)}${t.url ? '\n' + t.url : ''}`;

    const meta = document.createElement('span');
    meta.className = 't-meta';
    const who = document.createElement('span');
    who.className = `pill ${p}`;
    who.textContent = PROVIDERS[p].name;
    meta.appendChild(who);

    const title = document.createElement('span');
    title.className = 't-title';
    title.textContent = t.conversationTitle || `${PROVIDERS[p].name} · ${i + 1}`;

    const v = stateVisual(t);
    const st = document.createElement('span');
    st.className = `t-state ${v.cls}`;
    if (v.full) st.title = v.full;
    const ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = v.ico;
    const txt = document.createElement('span');
    txt.textContent = v.text;
    st.append(ico, txt);

    li.append(meta, title, st);

    if (t.stale) {
      const note = document.createElement('span');
      note.className = 't-note';
      note.textContent = T('unresponsive') || 'unresponsive — click to open';
      li.appendChild(note);
    }

    const go = async () => { await send({ type: 'CC_FOCUS_TAB', tabId: t.tabId }); window.close(); };
    li.addEventListener('click', go);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    list.appendChild(li);
  });

  renderSummary(snapshot, tabs);
}

function renderSummary(snapshot, tabs) {
  const c = (snapshot && snapshot.counts) || { generating: 0, completed: 0, attention: 0 };
  const box = $('summary');
  box.textContent = '';

  const items = [
    { n: c.attention, cls: 'attention', label: T('sumAttention') || 'attention' },
    { n: c.generating, cls: 'active', label: T('sumActive') || 'active' },
    { n: c.completed, cls: 'ready', label: T('sumReady') || 'ready' },
  ].filter((x) => x.n > 0);

  if (!items.length) {
    box.setAttribute('data-idle', tabs.length
      ? (T('sumAllQuiet') || 'All quiet')
      : (T('sumNoTabs') || 'Nothing being monitored'));
  } else {
    box.removeAttribute('data-idle');
    for (const it of items) {
      const el = document.createElement('span');
      el.className = `sum-item ${it.cls}`;
      const n = document.createElement('span');
      n.className = 'sum-n';
      n.textContent = String(it.n);
      const l = document.createElement('span');
      l.textContent = it.label;
      el.append(n, l);
      box.appendChild(el);
    }
  }

  const bad = tabs.some((t) => t.state === 'UNKNOWN' || t.stale);
  const status = $('hdr-status');
  status.classList.toggle('warn', bad);
  $('status-txt').textContent = bad ? (T('statusCheck') || 'Check') : (T('statusOk') || 'OK');
  status.title = bad
    ? (T('monitorWarn') || 'A tab is unresponsive or the detector does not recognize the page')
    : (T('monitorOk') || 'Monitor running');
}

async function refreshTasks() {
  renderTasks(await send({ type: 'CC_GET_SNAPSHOT' }));
}

/* ── Ajustes rápidos ───────────────────────────────────────────────── */
async function loadToggles() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || {};
  $('t-notify').checked = s.notifyDone !== false;
  $('t-sound').checked = !s.sound || s.sound.enabled !== false;
  if (s.ui && s.ui.usageCollapsed) setUsageCollapsed(true);
}

async function saveToggles() {
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || {};
  s.notifyDone = $('t-notify').checked;
  s.notifyAttention = $('t-notify').checked;
  s.sound = { ...(s.sound || {}), enabled: $('t-sound').checked };
  await chrome.storage.local.set({ settings: s });
}

function setUsageCollapsed(collapsed) {
  $('usage-panel').classList.toggle('collapsed', collapsed);
  $('usage-toggle').setAttribute('aria-expanded', String(!collapsed));
}

async function toggleUsage() {
  const collapsed = !$('usage-panel').classList.contains('collapsed');
  setUsageCollapsed(collapsed);
  const { settings } = await chrome.storage.local.get('settings');
  const s = settings || {};
  s.ui = { ...(s.ui || {}), usageCollapsed: collapsed };
  await chrome.storage.local.set({ settings: s });
}

/* ── Init ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  $('usage-refresh').addEventListener('click', (e) => { e.stopPropagation(); refreshUsage(true); });
  $('usage-toggle').addEventListener('click', toggleUsage);
  $('t-notify').addEventListener('change', saveToggles);
  $('t-sound').addEventListener('change', saveToggles);
  $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  await Promise.all([loadToggles(), refreshUsage(false), refreshTasks()]);
  setInterval(() => { refreshTasks(); renderUsageMeta(); }, 1500);
});
