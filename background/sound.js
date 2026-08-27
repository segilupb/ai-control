/*
 * Claude Control — background/sound.js
 * El service worker no puede reproducir audio en MV3: se delega en un
 * offscreen document (patrón validado en la auditoría, reimplementado).
 * Ventaja clave sobre WebAudio-en-content-script: suena aunque ninguna
 * pestaña de Claude haya recibido interacción del usuario.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.sound = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  let creating = null; // promesa en vuelo para evitar carreras

  async function ensureOffscreen() {
    if (typeof chrome === 'undefined' || !chrome.offscreen) return false;
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length > 0) return true;
    if (!creating) {
      creating = chrome.offscreen
        .createDocument({
          url: 'offscreen/offscreen.html',
          reasons: ['AUDIO_PLAYBACK'],
          justification: 'Reproducir un aviso sonoro cuando Claude termina una tarea o necesita atención',
        })
        .catch(() => {})
        .finally(() => { creating = null; });
    }
    await creating;
    return true;
  }

  /**
   * @param {'done'|'attention'} kind
   * @param {number} volume 0..1
   * @param {'claude'|'chatgpt'} provider — sonido distinto por IA
   */
  async function play(kind, volume, provider) {
    try {
      const ok = await ensureOffscreen();
      if (!ok) return;
      chrome.runtime.sendMessage({
        ns: 'cc', target: 'offscreen', type: 'CC_PLAY',
        kind, volume, provider: provider || 'claude',
      });
    } catch (_e) { /* el audio nunca es crítico */ }
  }

  return { play, ensureOffscreen };
});
