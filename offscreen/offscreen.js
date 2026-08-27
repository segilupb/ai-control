/*
 * Claude Control — offscreen/offscreen.js
 * Reproduce el sonido correspondiente al PROVEEDOR y al tipo de aviso.
 * Cada IA tiene un timbre distinto para poder distinguirlas sin mirar.
 */
'use strict';

const PROVIDERS = ['claude', 'chatgpt', 'gemini'];

function fileFor(provider, kind) {
  const p = PROVIDERS.includes(provider) ? provider : 'claude';
  const k = kind === 'attention' ? 'attention' : 'done';
  return `../sounds/${p}-${k}.wav`;
}

// Perfiles del fallback sintetizado (mismo carácter que los WAV)
const TONES = {
  claude:  { done: [523.25, 659.25, 783.99, 1046.5], attention: [880, 660, 880] },
  chatgpt: { done: [587.33, 880.0],                  attention: [740, 587.33, 740] },
  gemini:  { done: [987.77, 783.99, 587.33],         attention: [622.25, 830.61, 622.25] },
};

let current = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.ns !== 'cc' || msg.target !== 'offscreen') return;
  if (msg.type === 'CC_PLAY') {
    play(msg.provider, msg.kind === 'attention' ? 'attention' : 'done', clampVolume(msg.volume));
  }
});

function clampVolume(v) {
  const n = typeof v === 'number' ? v : 0.7;
  return Math.min(1, Math.max(0, n));
}

function play(provider, kind, volume) {
  try {
    if (current) { current.pause(); current.currentTime = 0; }
    current = new Audio(fileFor(provider, kind));
    current.volume = volume;
    current.play().catch(() => fallbackTone(provider, kind, volume));
  } catch (_e) {
    fallbackTone(provider, kind, volume);
  }
}

function fallbackTone(provider, kind, volume) {
  try {
    const set = TONES[provider] || TONES.claude;
    const freqs = set[kind] || set.done;
    const dur = kind === 'attention' ? 0.22 : 0.18;
    const ctx = new AudioContext();
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = provider === 'chatgpt' ? 'triangle' : 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * dur);
      gain.gain.linearRampToValueAtTime(volume * 0.4, ctx.currentTime + i * dur + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * dur + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * dur);
      osc.stop(ctx.currentTime + i * dur + dur + 0.05);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch (_e) { /* noop */ }
}
