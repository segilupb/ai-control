/*
 * Claude Control — background/service-worker.js
 * Cableado del registro multi-tab con las APIs reales de Chrome/Edge.
 * En la Fase D las finalizaciones/atenciones solo se registran en consola;
 * la Fase E conecta notifier + badge + sonido a los mismos eventos.
 */
importScripts(
  'tab-registry.js', 'notifier.js', 'badge.js', 'sound.js', 'usage.js',
  'history.js', 'remote.js', 'usage-adapters.js', 'usage-multi.js',
  'network-signals.js'
);

const {
  createTabRegistry, createNotifier, badge, sound, createUsageMonitor,
  createHistory, createRemote, usageAdapters, createUsageMulti,
  createNetworkSignals,
} = globalThis.__claudeControlBg;

// ── Settings (storage.local, con defaults) ────────────────────────────
const DEFAULT_SETTINGS = {
  notifyDone: true,
  notifyAttention: true,
  autoDismissSeconds: 25,
  sound: { enabled: true, volume: 0.7 },
  settleMs: 4000,
  minTaskMs: 1500,
  usage: { thresholdsEnabled: true, thresholds: { session: 80, weekly: 80 } },
  historyEnabled: true,
  providers: { claude: true, chatgpt: true },
  remote: { enabled: false, server: 'https://ntfy.sh', topic: '', includeTitle: false, onDone: true, onAttention: true },
};
let settingsCache = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  try {
    const { settings } = await chrome.storage.local.get('settings');
    settingsCache = {
      ...DEFAULT_SETTINGS,
      ...(settings || {}),
      sound: { ...DEFAULT_SETTINGS.sound, ...((settings || {}).sound || {}) },
    };
  } catch (_e) { /* defaults */ }
  return settingsCache;
}
loadSettings();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) loadSettings();
});

// ── Dependencias reales ───────────────────────────────────────────────
const registry = createTabRegistry({
  now: () => Date.now(),
  storageGet: async (key) => {
    const data = await chrome.storage.session.get(key);
    return data ? data[key] : null;
  },
  storageSet: async (key, val) => {
    await chrome.storage.session.set({ [key]: val });
  },
  ping: async (tabId) => {
    try {
      return await chrome.tabs.sendMessage(tabId, { ns: 'cc', type: 'CC_QUERY' });
    } catch (_e) {
      return null;
    }
  },
});

const ready = registry.restore();

// ── Notifier con dependencias reales ──────────────────────────────────
const notifier = createNotifier({
  now: () => Date.now(),
  create: (id, opts) => chrome.notifications.create(id, {
    ...opts,
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
  }).catch((e) => { console.warn('[CC] notificación falló:', e && e.message); }),
  clear: (id) => chrome.notifications.clear(id),
  alarmCreate: (name, info) => chrome.alarms.create(name, info),
  focusTab: (tabId) => focusTab(tabId),
  playSound: (kind, provider) => sound.play(kind, settingsCache.sound.volume, provider),
  getSettings: () => loadSettings(),
  t: (key, subs) => { try { return chrome.i18n.getMessage(key, subs) || null; } catch (_e) { return null; } },
  iconDone: 'icons/icon128.png',
  iconAttention: 'icons/icon128.png',
});

// ── Usage Monitor (Módulo B, aislado del Módulo A) ────────────────────
const usage = createUsageMonitor({
  now: () => Date.now(),
  fetchFn: (url) => fetch(url, { credentials: 'include' }),
  storageGet: (keys) => chrome.storage.local.get(keys),
  storageSet: (obj) => chrome.storage.local.set(obj),
  getSettings: () => loadSettings(),
  notifyThreshold: ({ kind, utilization, resetsAt }) => {
    const T = (k, s) => { try { return chrome.i18n.getMessage(k, s) || null; } catch (_e) { return null; } };
    const label = kind === 'session'
      ? (T('windowSession') || '5-hour window')
      : (T('windowWeekly') || 'weekly limit');
    chrome.notifications.create(`cc|usage|${kind}|${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: T('usageNotifTitle') || 'Claude usage',
      message: (T('usageNotifBody', [String(Math.round(utilization)), label]) ||
                `You have reached ${Math.round(utilization)}% of your ${label}.`) +
        (resetsAt ? `\n${T('resetLabel') || 'Reset'}: ${new Date(resetsAt).toLocaleString()}` : ''),
      priority: 1,
    }).catch((e) => { console.warn('[CC] notificación de uso falló:', e && e.message); });
  },
});

const USAGE_ALARM = 'cc_usage_refresh';
const USAGE_PERIOD_MIN = 15;   // menos frecuencia = menos ruido para el proveedor

// ── Historial ligero (sin contenido de conversaciones) ────────────────
const history = createHistory({
  now: () => Date.now(),
  storageGet: (keys) => chrome.storage.local.get(keys),
  storageSet: (obj) => chrome.storage.local.set(obj),
  isEnabled: async () => (await loadSettings()).historyEnabled !== false,
});

// ── Uso de ChatGPT (Work/Codex vía wham) ──────────────────────────────
const usageMulti = createUsageMulti({
  now: () => Date.now(),
  fetchFn: (url, init) => fetch(url, init),
  adapters: usageAdapters,
  storageGet: (keys) => chrome.storage.local.get(keys),
  storageSet: (obj) => chrome.storage.local.set(obj),
  uiLanguage: () => { try { return chrome.i18n.getUILanguage() || 'en-US'; } catch (_e) { return 'en-US'; } },
});

/**
 * ¿Está activada esta IA en Opciones? Quien solo use una o dos no debería ver
 * bloques vacíos de las demás.
 */
async function isProviderEnabled(provider) {
  if (!provider) return true;
  const s = await loadSettings();
  const p = s.providers || {};
  return p[provider] !== false;
}


// ── Señales de red: EVIDENCIA para la FSM, nunca notificación directa ──
const networkSignals = createNetworkSignals({
  now: () => Date.now(),
  send: async (tabId, message) => {
    try { await chrome.tabs.sendMessage(tabId, message); } catch (_e) { /* pestaña sin content script */ }
  },
});
networkSignals.attach(chrome);

// ── Aviso remoto al teléfono (ntfy, opt-in) ───────────────────────────
const remote = createRemote({
  fetchFn: (url, init) => fetch(url, init),
  getSettings: () => loadSettings(),
  t: (key, subs) => { try { return chrome.i18n.getMessage(key, subs) || null; } catch (_e) { return null; } },
});

// ── Hooks: registry → notifier + badge ────────────────────────────────
/**
 * Refresco de uso tras terminar una tarea.
 *
 * SOLO Claude, y a propósito: su endpoint es un JSON ligero y barato.
 * ChatGPT se deja fuera porque su cuota se mueve despacio y no compensa
 * consultar su endpoint tras cada tarea.
 */
const usageRefreshTimers = {};
function scheduleUsageRefresh(provider) {
  if (provider !== 'claude' || usageRefreshTimers[provider]) return;
  usageRefreshTimers[provider] = setTimeout(() => {
    usageRefreshTimers[provider] = null;
    usage.refresh({ force: true }).catch(() => {});
  }, 1500);
}

registry.on('completed', ({ tabId, tab, durationMs }) => {
  scheduleUsageRefresh(tab.provider);
  console.log('[CC]', (tab.providerName || '?'), 'COMPLETED', tabId, tab.conversationTitle, `${Math.round(durationMs / 1000)}s`);
  notifier.notifyCompleted({
    tabId, conversationTitle: tab.conversationTitle, durationMs,
    provider: tab.provider, providerName: tab.providerName,
  });
  remote.send('done', tab.conversationTitle, tab.providerName);
  history.add({
    provider: tab.provider,
    conversationTitle: tab.conversationTitle,
    outcome: 'completed',
    durationMs,
    startedAt: tab.taskEndedAt ? tab.taskEndedAt - durationMs : null,
    endedAt: tab.taskEndedAt,
    detectorVersion: tab.detectorVersion,
  });
});
registry.on('attention', ({ tabId, tab, reason }) => {
  console.log('[CC]', (tab.providerName || '?'), 'NEEDS_ATTENTION', tabId, tab.conversationTitle, reason);
  notifier.notifyAttention({
    tabId, conversationTitle: tab.conversationTitle, reason,
    provider: tab.provider, providerName: tab.providerName,
  });
  remote.send('attention', tab.conversationTitle, tab.providerName);
  history.add({
    provider: tab.provider,
    conversationTitle: tab.conversationTitle,
    outcome: 'attention',
    reason,
    detectorVersion: tab.detectorVersion,
  });
});
registry.on('change', () => {
  badge.apply(registry.counts(), registry.snapshot());
});

// Un ÚNICO listener global de clicks de notificación (el id codifica el destino).
chrome.notifications.onClicked.addListener((notifId) => {
  notifier.handleClick(notifId);
});

// ── Mensajes de content scripts y popup ───────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.ns !== 'cc') return;

  (async () => {
   try {
    await ready;
    const tabId = sender.tab && sender.tab.id;
    const windowId = sender.tab && sender.tab.windowId;

    switch (msg.type) {
      // — desde content scripts —
      case 'CC_REGISTER': {
        // Si la IA está desactivada, se responde 'disabled' y el content
        // script se detiene: sin observers, sin timers, sin notificaciones.
        if (msg.provider && !(await isProviderEnabled(msg.provider))) {
          if (tabId != null) registry.remove(tabId);
          sendResponse({ ok: true, disabled: true });
          break;
        }
        if (tabId != null) registry.register(tabId, windowId, msg);
        sendResponse({ ok: true });
        break;
      }
      case 'CC_STATE':
        if (tabId != null) registry.applyState(tabId, windowId, msg);
        sendResponse({ ok: true });
        break;
      case 'CC_COMPLETED':
        if (tabId != null) registry.applyCompleted(tabId, msg);
        sendResponse({ ok: true });
        break;
      case 'CC_ATTENTION':
        if (tabId != null) registry.applyAttention(tabId, msg);
        sendResponse({ ok: true });
        break;
      case 'CC_ATTENTION_CLEARED':
      case 'CC_TASK_STARTED':
      case 'CC_ABANDONED':
        // CC_STATE ya trae la transición correspondiente; estos son informativos.
        if (tabId != null) registry.heartbeat(tabId, null);
        sendResponse({ ok: true });
        break;
      case 'CC_HEARTBEAT':
        if (tabId != null) registry.heartbeat(tabId, msg);
        sendResponse({ ok: true });
        break;

      // — desde el popup —
      case 'CC_GET_SNAPSHOT':
        sendResponse({ tabs: registry.snapshot(), counts: registry.counts() });
        break;
      case 'CC_USAGE_ALL': {
        const enabled = {
          claude: await isProviderEnabled('claude'),
          chatgpt: await isProviderEnabled('chatgpt'),
        };
        // Claude (fuente propia) + ChatGPT, ambos con el mismo contrato.
        const out = { enabled };

        if (enabled.claude) {
          const claudeState = await usage.getState();
          out.claude = claudeState.error && !claudeState.data
            ? { provider: 'claude', source: 'claude-api', status: 'error', windows: [], error: claudeState.error }
            : usageAdapters.fromClaude(claudeState.data, claudeState.fetchedAt);
          if (claudeState.stale) usage.refresh().catch(() => {});
        }
        if (enabled.chatgpt) {
          const snap = await usageMulti.cached('chatgpt');
          out.chatgpt = snap || { provider: 'chatgpt', source: 'wham', status: 'unavailable', windows: [] };
          if (!snap || snap.status !== 'ok') usageMulti.fetchChatGPT().catch(() => {});   // respeta el suelo
        }
        sendResponse(out);
        break;
      }
      case 'CC_USAGE_REFRESH_ALL': {
        const res = { ok: true };
        if (await isProviderEnabled('claude')) res.claude = (await usage.refresh({ force: true })).ok;
        if (await isProviderEnabled('chatgpt')) res.chatgpt = (await usageMulti.fetchChatGPT({ force: true })).status;
        sendResponse(res);
        break;
      }
      case 'CC_USAGE_GET': {
        // Devuelve lo cacheado ya, y si está viejo refresca en segundo plano.
        const state = await usage.getState();
        sendResponse(state);
        if (state.stale) usage.refresh().catch(() => {});
        break;
      }
      case 'CC_SOUND_TEST': {
        sound.play(msg.kind === 'attention' ? 'attention' : 'done',
                   settingsCache.sound.volume, msg.provider);
        sendResponse({ ok: true });
        break;
      }
      case 'CC_REMOTE_TEST': {
        const r = await remote.send('test', null);
        sendResponse(r);
        break;
      }
      case 'CC_REMOTE_GEN_TOPIC':
        sendResponse({ topic: remote.generateTopic() });
        break;
      case 'CC_HISTORY_GET':
        sendResponse({ entries: await history.list() });
        break;
      case 'CC_HISTORY_CLEAR':
        await history.clear();
        sendResponse({ ok: true });
        break;
      case 'CC_USAGE_REFRESH': {
        const r = await usage.refresh({ force: true });
        sendResponse(r);
        break;
      }
      case 'CC_FOCUS_TAB':
        await focusTab(msg.tabId);
        sendResponse({ ok: true });
        break;
      case 'CC_RESET_TAB':
        try {
          await chrome.tabs.sendMessage(msg.tabId, { ns: 'cc', type: 'CC_RESET' });
        } catch (_e) { /* pestaña sin content script */ }
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: 'tipo desconocido' });
    }
   } catch (e) {
    // Nunca dejar al emisor sin respuesta: eso producía «sin respuesta».
    console.error('[CC] error procesando', msg && msg.type, e);
    try { sendResponse({ ok: false, sent: false, reason: `sw-error: ${e && e.message}` }); } catch (_e) {}
   }
  })();

  return true; // respuestas asíncronas
});

// ── Ciclo de vida de pestañas ─────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  const t = registry.get(tabId);
  if (t && (t.state === 'GENERATING' || t.state === 'TOOL_RUNNING' || t.state === 'SETTLING')) {
    history.add({
      conversationTitle: t.conversationTitle,
      outcome: 'abandoned',
      startedAt: t.taskStartedAt,
      detectorVersion: t.detectorVersion,
    });
  }
  registry.remove(tabId);
  networkSignals.forget(tabId);
});
chrome.tabs.onReplaced.addListener((added, removed) => registry.replace(added, removed));

// El usuario enfocó una pestaña → si estaba en COMPLETED, marcar como vista.
chrome.tabs.onActivated.addListener(({ tabId }) => registry.markSeen(tabId));
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab && tab.id != null) registry.markSeen(tab.id);
  } catch (_e) { /* noop */ }
});

// ── Enfocar pestaña o ventana-PWA ─────────────────────────────────────
async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    registry.markSeen(tabId);
  } catch (_e) { /* la pestaña ya no existe */ }
}

// ── Sweep de zombis con chrome.alarms (no setInterval: el SW duerme) ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('cc_stale_sweep', { periodInMinutes: 1 });
  chrome.alarms.create(USAGE_ALARM, { periodInMinutes: USAGE_PERIOD_MIN });
  usage.refresh().catch(() => {});
});
chrome.runtime.onStartup.addListener(async () => {
  // Verificar/recrear alarmas (patrón robusto adoptado de la auditoría de 04).
  if (!(await chrome.alarms.get('cc_stale_sweep'))) {
    chrome.alarms.create('cc_stale_sweep', { periodInMinutes: 1 });
  }
  if (!(await chrome.alarms.get(USAGE_ALARM))) {
    chrome.alarms.create(USAGE_ALARM, { periodInMinutes: USAGE_PERIOD_MIN });
  }
  usage.refresh().catch(() => {});
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Auto-clear de notificaciones (nombres con prefijo del notifier).
  if (await notifier.handleAlarm(alarm.name)) return;
  if (alarm.name === USAGE_ALARM) {
    // Solo Claude en segundo plano: endpoint JSON ligero.
    // ChatGPT se lee al abrir el popup (con suelo de frecuencia), para no
    // machacar su servidor en segundo plano.
    isProviderEnabled('claude').then((on) => on && usage.refresh().catch(() => {}));
    return;
  }
  if (alarm.name !== 'cc_stale_sweep') return;
  await ready;
  registry.sweepStale();
});

// Propagar cambios de settleMs/minTaskMs a los content scripts vivos.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const s = changes.settings.newValue || {};
  try {
    const tabs = await chrome.tabs.query({ url: [
      'https://claude.ai/*', 'https://chatgpt.com/*',
      'https://chat.openai.com/*',
    ] });
    for (const t of tabs) {
      chrome.tabs.sendMessage(t.id, {
        ns: 'cc', type: 'CC_SETTINGS',
        settleMs: s.settleMs, minTaskMs: s.minTaskMs,
        providers: s.providers || {},
      }).catch(() => {});
    }
  } catch (_e) { /* noop */ }
});

// Exponer para las fases F–I (mismo contexto de SW).
globalThis.__claudeControlBg.registry = registry;
globalThis.__claudeControlBg.focusTab = focusTab;
globalThis.__claudeControlBg.notifier = notifier;
globalThis.__claudeControlBg.usage = usage;
