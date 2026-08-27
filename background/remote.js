/*
 * Claude Control — background/remote.js
 * Aviso en el teléfono vía ntfy (https://ntfy.sh): POST simple a un topic
 * secreto al que la app del móvil está suscrita.
 *
 * EXCEPCIÓN DOCUMENTADA AL LOCAL-FIRST (docs/PRIVACY.md):
 *  - Apagado por defecto (opt-in explícito en Opciones).
 *  - Por defecto el mensaje NO incluye el título de la conversación, solo un
 *    texto genérico. Incluir el título es un segundo opt-in.
 *  - El topic es un secreto aleatorio largo: quien no lo conozca no puede leer.
 *  - Jamás se envía contenido de conversaciones (este módulo ni lo recibe).
 *
 * Factory con dependencias inyectadas → testeable en Node (tests/test-remote.js).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.__claudeControlBg = root.__claudeControlBg || {};
  root.__claudeControlBg.createRemote = api.createRemote;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_REMOTE = Object.freeze({
    enabled: false,
    server: 'https://ntfy.sh',
    topic: '',
    includeTitle: false,
    onDone: true,
    onAttention: true,
  });

  const TEXT = {
    done: { title: 'Claude finished', generic: 'A task has finished', tags: 'white_check_mark', priority: 'default',
            i18nTitle: 'notifDone', i18nGeneric: 'remoteDoneBody' },
    attention: { title: 'Claude needs your attention', generic: 'Your intervention is required', tags: 'warning', priority: 'high',
                 i18nTitle: 'notifAttention', i18nGeneric: 'remoteAttentionBody' },
    test: { title: 'Claude Control', generic: 'Test OK: alerts will arrive here', tags: 'bell', priority: 'default',
            i18nTitle: 'extName', i18nGeneric: 'remoteTestBody' },
  };

  function createRemote(deps) {
    const d = Object.assign(
      {
        fetchFn: null,               // (url, init) → Promise<Response-like>
        getSettings: async () => ({}),
        t: () => null,
      },
      deps || {}
    );

    async function cfg() {
      const s = (await d.getSettings()) || {};
      return { ...DEFAULT_REMOTE, ...(s.remote || {}) };
    }

    /**
     * Las cabeceras HTTP solo admiten Latin-1: un título con tildes hace que
     * fetch lance TypeError. Se limpian los acentos SOLO en la cabecera; el
     * cuerpo va en UTF-8 y conserva los caracteres originales.
     */
    function asciiHeader(s) {
      return String(s)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')   // quita diacríticos
        .replace(/[^\x20-\x7E]/g, '');     // deja solo ASCII imprimible
    }

    /** Construye la petición (puro: testeable sin red). */
    function buildRequest(remote, kind, conversationTitle, providerName) {
      const base = TEXT[kind];
      if (!base) return null;
      const who = providerName || 'Claude';
      const t = {
        ...base,
        title: kind === 'done'
          ? `${who} ${d.t('finishedWord') || 'finished'}`
          : kind === 'attention'
            ? `${who} ${d.t('needsAttentionWord') || 'needs your attention'}`
            : (d.t(base.i18nTitle) || base.title),
        generic: d.t(base.i18nGeneric) || base.generic,
      };
      const server = (remote.server || DEFAULT_REMOTE.server).replace(/\/+$/, '');
      const body = remote.includeTitle && conversationTitle ? conversationTitle : t.generic;
      return {
        url: `${server}/${remote.topic}`,
        init: {
          method: 'POST',
          headers: {
            Title: asciiHeader(t.title),
            Priority: t.priority,
            Tags: (providerName ? asciiHeader(providerName).toLowerCase() + ',' : '') + t.tags,
          },
          body,   // UTF-8: aquí sí van tildes sin problema
        },
      };
    }

    /**
     * @param {'done'|'attention'|'test'} kind
     * @param {string|null} conversationTitle
     * @returns {Promise<{sent:boolean, reason?:string, status?:number}>}
     */
    async function send(kind, conversationTitle, providerName) {
      const remote = await cfg();
      if (kind !== 'test') {
        if (!remote.enabled) return { sent: false, reason: 'disabled' };
        if (kind === 'done' && !remote.onDone) return { sent: false, reason: 'off-done' };
        if (kind === 'attention' && !remote.onAttention) return { sent: false, reason: 'off-attention' };
      }
      if (!remote.topic || remote.topic.length < 8) {
        return { sent: false, reason: 'no-topic' };
      }

      const req = buildRequest(remote, kind, conversationTitle, providerName);
      if (!req) return { sent: false, reason: 'bad-kind' };

      try {
        const fn = d.fetchFn || ((u, i) => fetch(u, i));
        const res = await fn(req.url, req.init);
        return { sent: !!res.ok, status: res.status, reason: res.ok ? undefined : `http-${res.status}` };
      } catch (e) {
        // Causas típicas: servidor apagado, IP incorrecta, o bloqueo CORS/permiso.
        return { sent: false, reason: `network: ${e && e.message ? e.message : 'sin detalle'}` };
      }
    }

    /** Topic secreto aleatorio: legible pero imposible de adivinar. */
    function generateTopic(randomBytes) {
      const bytes = randomBytes ||
        (typeof crypto !== 'undefined' && crypto.getRandomValues
          ? crypto.getRandomValues(new Uint8Array(16))
          : Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)));
      let s = '';
      const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // sin caracteres ambiguos
      for (const b of bytes) s += alphabet[b % alphabet.length];
      return `claude-ctrl-${s}`;
    }

    return { send, buildRequest, generateTopic, asciiHeader, DEFAULT_REMOTE };
  }

  return { createRemote };
});
