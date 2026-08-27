# Claude Control — Puntos frágiles y qué cambios de Claude romperían qué

## 1. Endpoint de uso (Módulo B) — FRÁGIL POR DISEÑO
- `GET https://claude.ai/api/organizations` y `GET …/organizations/{id}/usage`
  son **API privada sin contrato**. Anthropic puede renombrar campos
  (`five_hour`, `seven_day`, `utilization`, `resets_at`), cambiar la auth o
  eliminarlos sin aviso.
- Mitigación implementada: validación de shape (`parseUsage`), invalidación de
  orgId ante 401/403/404 con UN reintento, degradación a "no disponible" con
  mensaje accionable. El Módulo A (tareas) es 100 % independiente y nunca se ve
  afectado.
- Si se rompe: el popup mostrará el error; fallback manual = abrir
  claude.ai/settings/usage. Prohibido reintroducir scraping automático.

## 2. Sonda A1 `data-is-streaming` (Módulo A)
- La señal más fiable de generación. Si Claude la renombra, quedan A2/A3
  (botón stop) como primarias. Editar `content/detector.js → PROBES.streaming`.

## 3. Aria-labels del botón Stop (A2)
- Dependen del idioma de la UI. Cubiertos: en/es. Si usas claude.ai en otro
  idioma, añade la palabra a `PROBES.stopAriaWords`.

## 4. Señales de herramienta (A4)
- Heurísticas (`aria-busy`, `role=progressbar`, texto en tarjetas). Un rediseño
  de artefactos/tool-use puede silenciarlas: el efecto sería completar cuando
  una herramienta silenciosa siga corriendo (mitigado por settleMs) o mantener
  TOOL_RUNNING de más (mitigado por el sweep de zombis). Ajustar
  `PROBES.toolRunning` / `toolTextWords`.

## 5. Diálogos de intervención (I1)
- `role=dialog|alertdialog` es estándar ARIA; robusto. El riesgo son diálogos
  no-ARIA custom → no se detectarían (fallo silencioso: sin notificación ⚠️).

## 6. Título de conversación
- Derivado de `document.title` quitando el sufijo "- Claude". Si cambia el
  formato, la notificación usará el fallback "pestaña N". Cosmético.

## 7. Auto-clear de notificaciones
- `chrome.alarms` tiene mínimo efectivo (~30 s) en Chromium. El auto-clear es
  aproximado; en Windows el toast se recoge solo al Centro de actividades.

## 8. PWA — FUERA DE ALCANCE (decisión del propietario, 2026-08-25)
- El uso será siempre en pestañas normales de Edge/Chrome. El código no hace
  nada específico de PWA (el campo isAppWindow del registro queda sin uso).
  Si algún día se quisiera reactivar: el punto a verificar es el focus de la
  ventana de app desde una notificación.
