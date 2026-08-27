# Claude Control — Arquitectura (diseño Fase 2)

> Nota v1.0.0: la PWA se retiró del alcance el 2026-08-25; ignorar sus menciones. Todo lo demás se implementó tal cual. Ver docs/LIMITATIONS.md.

Decisiones de contexto confirmadas por el propietario del proyecto:
- Navegador objetivo: **Microsoft Edge** (Chrome/Chromium como compatibilidad secundaria).
- La PWA de Claude está instalada **en el mismo Edge** donde vivirá la extensión → misma instancia de navegador, mismos content scripts. Si algo fallara en modo PWA, el fallback aceptado es usar Claude en pestaña normal.
- Windows 10, notificaciones nativas vía Chromium.

---

## 1. Vista general de módulos

```
┌────────────────────────────────────────────────────────────────┐
│                     SERVICE WORKER (background)                 │
│                                                                 │
│  tabRegistry ── mapa tabId → TabState (fuente de verdad)        │
│  notifier ──── notificaciones nativas + agrupación + clicks     │
│  badge ─────── badge global y por pestaña                       │
│  soundPlayer ─ puente al offscreen document                     │
│  history ───── historial ligero en storage.local                │
│  usage ─────── Módulo B: fetch de /api/organizations/…/usage    │
│  alarms ────── chequeos periódicos de usage + housekeeping      │
└───────────────────────▲────────────────────────────────────────┘
                        │ chrome.runtime messages (contrato §5)
┌───────────────────────┴────────────────────────────────────────┐
│              CONTENT SCRIPT (uno por pestaña/PWA claude.ai)     │
│                                                                 │
│  detector.js ──── capa de señales (versionada, intercambiable)  │
│  stateMachine.js ─ FSM con histéresis (§3)                      │
│  reporter.js ───── envía transiciones al SW, responde pings     │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐
│ popup.html   │   │ options.html │   │ offscreen.html (audio)   │
│ estado vivo  │   │ ajustes      │   │ reproduce sonidos MV3    │
└──────────────┘   └──────────────┘   └──────────────────────────┘
```

Principio rector: **el content script observa y decide el estado de SU pestaña; el service worker agrega, notifica y persiste.** Ninguna pestaña conoce a las demás.

## 2. Estructura de archivos

```
claude-control/
├── manifest.json
├── background/
│   ├── service-worker.js      # entry: wiring de listeners
│   ├── tab-registry.js        # mapa de pestañas + persistencia
│   ├── notifier.js            # notificaciones + agrupación + onClicked global
│   ├── badge.js
│   ├── sound.js               # gestión del offscreen document
│   ├── history.js
│   └── usage.js               # Módulo B completo
├── content/
│   ├── detector.js            # SOLO selectores y señales (§4) — LO ÚNICO que
│   │                          #   se toca si Claude cambia su DOM
│   ├── state-machine.js       # FSM pura, sin DOM (testeable en aislamiento)
│   └── content-main.js        # orquesta detector + FSM + mensajería
├── offscreen/
│   ├── offscreen.html
│   └── offscreen.js
├── popup/
│   ├── popup.html / popup.css / popup.js
├── options/
│   ├── options.html / options.css / options.js
├── sounds/                    # generados propios (sin assets de terceros)
├── icons/
├── docs/
│   ├── ARCHITECTURE.md, PERMISSIONS.md, PRIVACY.md, LICENSES.md
│   ├── TESTING.md             # procedimientos de los 12 casos
│   └── FRAGILITY.md           # puntos frágiles + qué cambios de Claude rompen qué
└── README.md
```

MV3 con módulos ES (`"type": "module"` en el service worker; el content script se empaqueta concatenado o con imports estáticos — sin bundler: los tres archivos de content se declaran en orden en el manifest y comparten un namespace `window.__claudeControl`).

## 3. Máquina de estados (corazón del Módulo A)

### Estados

| Estado | Significado | Badge por pestaña |
|---|---|---|
| `IDLE` | Sin tarea en curso | (vacío) |
| `GENERATING` | Claude está emitiendo texto (streaming) | `…` naranja |
| `TOOL_RUNNING` | Herramienta/artefacto/búsqueda en ejecución | `…` naranja |
| `SETTLING` | Cesó toda actividad; esperando ventana de estabilidad | `…` naranja (interno, no visible como distinto) |
| `COMPLETED` | Fin real de la tarea → notificar 🔔 | `✓` verde |
| `NEEDS_ATTENTION` | Diálogo/permiso/error que requiere al usuario → notificar ⚠️ | `!` rojo |
| `UNKNOWN` | El detector no reconoce el DOM (Claude cambió la UI) | `?` gris |

### Transiciones

```
IDLE ──actividad──────────────► GENERATING | TOOL_RUNNING
GENERATING ⇄ TOOL_RUNNING       (alternan libremente durante tareas largas)
GENERATING|TOOL_RUNNING ──sin señales de actividad──► SETTLING
SETTLING ──actividad reaparece──► GENERATING | TOOL_RUNNING   (¡sin notificar!)
SETTLING ──estable T_settle──────► COMPLETED  → notify(done) → IDLE
cualquiera ──señal de intervención──► NEEDS_ATTENTION → notify(attention)
NEEDS_ATTENTION ──diálogo desaparece──► re-evaluar (GENERATING/…/IDLE)
cualquiera ──detector sin señales válidas N veces──► UNKNOWN (sin notificar)
```

### Histéresis (la pieza que ningún repo auditado tiene)

- `T_settle` por defecto **4000 ms** (configurable 2–10 s): SETTLING solo promociona a COMPLETED si durante toda la ventana **ninguna** señal de actividad reaparece. Cada reaparición reinicia el ciclo sin efectos secundarios.
- Regla anti-falso-inicio: una tarea solo es "notificable" si estuvo ≥ `T_min_task` (default 1500 ms) en GENERATING/TOOL_RUNNING acumulado. Evita notificar por parpadeos del DOM al cargar la página o navegar entre chats.
- Regla de desconexión (Caso 12): si la señal desaparece porque el documento pierde conectividad (evento `offline` / overlay de reconexión de claude.ai), la FSM entra en `SUSPENDED_NETWORK` (sub-estado de UNKNOWN) y **no** promociona a COMPLETED hasta volver `online` + re-evaluación limpia.
- Navegación SPA (cambio de conversación en la misma pestaña): reset completo de la FSM; una tarea abandonada no notifica.

### Por qué SETTLING como estado explícito y no un simple debounce
Un debounce mezcla "medición" con "decisión". Con SETTLING explícito: (a) el popup puede mostrar honestamente "finalizando…"; (b) la telemetría local del historial registra cuántas veces una tarea "casi terminó" (útil para calibrar T_settle); (c) los tests unitarios de la FSM cubren la transición sin DOM real.

## 4. Capa de detección (detector.js) — señales, no selectores sueltos

El detector expone una única función pura respecto al DOM:

```js
detect() → {
  activity:   { streaming: bool, stopButton: bool, toolRunning: bool },
  attention:  { dialog: bool, error: bool, authWall: bool },
  context:    { conversationTitle: string|null, composerReady: bool },
  confidence: 0..1,          // proporción de sondas que devolvieron respuesta coherente
  detectorVersion: 'YYYY.MM.DD'
}
```

### Sondas de ACTIVIDAD (cualquiera ⇒ hay tarea en curso)

| # | Sonda | Fuente | Fragilidad |
|---|---|---|---|
| A1 | `[data-is-streaming="true"]` | atributo propio de la app | Baja — la más fiable conocida |
| A2 | Botón stop por `aria-label` — lista multi-idioma: `stop`, `detener`, `parar`, `interrumpir` (substring, case-insensitive) | semántica de accesibilidad | Media (idioma) |
| A3 | `button[data-testid*="stop" i]` | testids internos | Media |
| A4 | Indicadores de herramienta: elementos `[aria-busy="true"]`, spinners/estado "Ejecutando/Running/Searching" dentro de tarjetas de tool-use o artefactos, barra de progreso `[role="progressbar"]` dentro del hilo | DOM de tool-use | Media-alta → por eso A4 **solo mantiene** TOOL_RUNNING, nunca inicia una tarea por sí sola |
| A5 | Crecimiento de contenido: hash barato (longitud + último bloque) del último mensaje del hilo; si crece entre muestreos ⇒ actividad | contenido | Baja como confirmación, alta como única señal → solo confirmatoria |

Clasificación GENERATING vs TOOL_RUNNING: A1/A2/A3 ⇒ GENERATING; solo-A4 ⇒ TOOL_RUNNING. La distinción es informativa (popup/historial); ambas bloquean COMPLETED por igual.

### Sondas de INTERVENCIÓN

| # | Sonda | Ejemplos que cubre |
|---|---|---|
| I1 | `[role="dialog"], [role="alertdialog"]` visible con ≥1 botón de acción y sin señal de actividad | permisos de herramienta, confirmaciones, selección |
| I2 | Banner/bloque de error visible en el hilo (texto de error + botón reintentar) | fallos de generación |
| I3 | Redirección/panel de login o verificación | sesión caducada |

I1 tiene supresión: diálogos abiertos por el propio usuario (settings, perfil) no cuentan si la FSM estaba en IDLE.

### Reglas de robustez
- Todos los selectores viven en un objeto `PROBES` con `detectorVersion` — cambiar el DOM de Claude = editar un archivo.
- Prohibido: clases utilitarias (`animate-pulse`, `class*="stop"`) como señal primaria (falsos positivos demostrados en la auditoría de 01).
- Visibilidad verificada (`getComputedStyle` display/visibility/opacity) antes de aceptar cualquier sonda.
- `confidence`: si el detector no encuentra ni composer ni hilo (`context.composerReady=false` y 0 sondas coherentes) durante 3 evaluaciones seguidas ⇒ UNKNOWN. El popup lo muestra como "detector desactualizado" en vez de mentir.

### Programación de evaluaciones (rendimiento)
- MutationObserver sobre el contenedor principal (fallback `document.body`) con `attributeFilter: ['data-is-streaming','aria-label','aria-busy','data-testid','disabled','aria-disabled','role']` + `childList/subtree`.
- Coalescencia: las mutaciones solo marcan `dirty=true`; un scheduler evalúa como máximo **cada 250 ms** si dirty, y como latido de seguridad cada **2 s** en estados activos y **10 s** en IDLE (backoff). Nada de dos timers paralelos siempre activos como en 01.
- Pestaña oculta: los MutationObserver siguen funcionando en background; los latidos pasan a mínimos (los timers en pestañas ocultas se degradan a ≥1/min en Chromium, suficiente porque el observer sigue reaccionando a mutaciones reales).

## 5. Contrato de mensajes

Content → SW (todos incluyen `detectorVersion`):
- `CC_REGISTER {url, title, conversationTitle}` — al inyectarse y en cada navegación SPA.
- `CC_STATE {prev, next, since, conversationTitle, taskStartedAt}` — solo en transiciones reales.
- `CC_HEARTBEAT {state}` — cada 30 s en estados activos (permite al SW detectar pestañas zombis).

SW → Content:
- `CC_QUERY` → responde el estado actual (para popup vía SW).
- `CC_RESET` — fuerza re-evaluación (botón en popup).

Popup → SW: `CC_GET_SNAPSHOT`, `CC_FOCUS_TAB {tabId}`, `CC_SETTINGS_UPDATE {…}`, `CC_USAGE_REFRESH`.

Un único `chrome.notifications.onClicked` global; el `notificationId` codifica el destino: `cc|done|<tabId>` / `cc|attn|<tabId>` / `cc|group|<ts>` (grupo → abre el popup no, enfoca la ventana del más reciente). Corrige la fuga de listeners detectada en 01.

## 6. Registro de pestañas (tab-registry)

```js
TabState = {
  tabId, windowId, url, title,
  conversationTitle,        // best-effort: document.title sin sufijo "- Claude"
  state, since,             // estado FSM y timestamp
  taskStartedAt, taskEndedAt, lastActivityAt,
  detectorVersion
}
```

- Volátil en memoria + espejo en `chrome.storage.session` (sobrevive al sleep del SW, muere con el navegador — correcto: las pestañas también mueren). `storage.local` solo para settings e historial.
- Limpieza: `tabs.onRemoved` borra la entrada (fuga corregida respecto a 01); `tabs.onReplaced` migra; heartbeat perdido >90 s en estado activo ⇒ marcar `stale`, re-ping, y si no responde, degradar a UNKNOWN.
- Reinicio del navegador (Caso 11): al `onStartup`, el registro arranca vacío y los content scripts reinyectados se re-registran solos. El historial persiste; los estados en vivo no se inventan.
- **PWA**: la ventana de la app de Edge aparece en `chrome.tabs.query` como una pestaña con su `windowId` propio. El registro no la distingue (no necesita hacerlo); `focusTab` = `tabs.update(active)+windows.update(focused)` funciona igual para ventana normal y ventana app. Se marca `isAppWindow` (vía `chrome.windows.get(windowId).type === 'app'|'popup'`) solo para mostrarlo en el popup con un icono distinto. Todo ello queda en ⚠️ hasta ejecutar el procedimiento de prueba de la Fase F; fallback acordado: modo pestaña.

## 7. Notificaciones

- `COMPLETED` → título: `Claude terminó`, cuerpo: título de conversación (fallback: "Conversación en <dominio> · pestaña N"), botón implícito de click → focus.
- `NEEDS_ATTENTION` → `⚠️ Claude necesita tu atención` + motivo breve (permiso/error/sesión), `requireInteraction: true` (no se auto-oculta), sonido distinto.
- Agrupación: si ≥2 COMPLETED llegan en <5 s ⇒ una notificación "Claude terminó N tareas" (lista de títulos en el cuerpo); clicks posteriores usan el popup para elegir.
- Auto-clear con `chrome.alarms` de un disparo (no `setTimeout` en SW — fallo detectado en 01).
- `silent: true` en la notificación nativa cuando el sonido propio está activo (evita doble sonido).

## 8. Sonido

- Offscreen document (patrón validado de 01, reimplementado): el SW garantiza su existencia con `chrome.runtime.getContexts` y le envía `{type:'CC_PLAY', sound, volume}`.
- Sonidos: 2 archivos propios generados por script (done: acorde ascendente; attention: doble tono descendente) + volumen 0–100 + ON/OFF global y por tipo. Sin dependencia de gesto de usuario (ventaja clave sobre el WebAudio-en-content de 02).

## 9. Badge

- Prioridad de color global: rojo (N needs-attention) > verde (N completed sin ver) > naranja (N activas) > vacío. El número siempre corresponde al color mostrado — regla simple y no ambigua.
- Badge por pestaña además del global (Chromium lo soporta con `tabId`), como en 01.

## 10. Historial

`storage.local.history` — array circular máx. 200 entradas: `{conversationTitle, startedAt, endedAt, durationMs, outcome: 'completed'|'attention'|'abandoned', detectorVersion}`. Nada de contenido de mensajes. Export JSON desde options. 

## 11. Módulo B — Usage

- Reimplementación limpia del mecanismo verificado en la auditoría:
  1. `GET https://claude.ai/api/organizations` (credentials: include) → org con capability `chat` → cache `orgId` en storage.local.
  2. `GET …/organizations/{orgId}/usage` → `{five_hour:{utilization,resets_at}, seven_day:{utilization,resets_at}}`.
- Invalidación: 401/403/404 ⇒ borrar orgId cacheado, reintentar descubrimiento 1 vez, si falla marcar `usage.error` con mensaje accionable ("abre claude.ai e inicia sesión").
- `chrome.alarms` cada 10 min (configurable 5–60) + refresh manual + refresh al abrir popup si el dato tiene >5 min.
- Umbrales opcionales de notificación (80 % por defecto, anti-repetición por cruce como en 03).
- **Documentación de riesgo (FRAGILITY.md):** endpoint privado, sin contrato; campos pueden renombrarse; el parser valida el shape y degrada a "no disponible" sin romper el Módulo A (aislamiento total entre módulos). Fallback último: enlace directo a claude.ai/settings/usage. Nunca scraping automático (descartado en auditoría).

## 12. Permisos (mínimos justificados)

```json
"permissions": ["tabs", "notifications", "storage", "offscreen", "alarms"],
"host_permissions": ["https://claude.ai/*"]
```
- `tabs`: identificar/enfocar pestañas y leer título/URL de claude.ai. Sin `<all_urls>`, sin `cookies`, sin `scripting`, sin `webRequest`. PERMISSIONS.md explicará cada uno.

## 13. Settings (options + espejo rápido en popup)

`{ notifyDone, notifyAttention, sound:{enabled, volume, doneSound, attnSound}, settleMs, minTaskMs, usage:{enabled, intervalMin, thresholds}, badgeMode, historyEnabled }` en `storage.local` (no sync: contiene nada sensible pero es config de máquina única).

## 14. Popup (wireframe)

```
CLAUDE CONTROL                       ⚙
─ USAGE ─────────────────────────────
 5 h    ████████░░ 68 %   reset 2 h 14 m
 Semana █████░░░░░ 41 %   reset vie 23:30
 Actualizado hace 3 min          [↻]
─ TAREAS ────────────────────────────
 🟡 Project Alpha migración      Generando · 08:31
 🟠 API gateway        ⚠ Necesita atención     ← click = focus
 🟢 Auditoría extensiones   Terminó hace 24 s
 (fila gris si UNKNOWN: "detector desactualizado")
─────────────────────────────────────
 ✓ Notificaciones  ✓ Sonido  · Historial ›
```

## 15. Mapa fases de implementación ↔ casos de test

| Fase | Entrega | Casos que valida |
|---|---|---|
| C | detector + FSM en 1 pestaña | 1, 3, 4, 5, 12 |
| D | tab-registry multi-tab | 2, 8 |
| E | notificaciones + sonido + badge | 1, 6, 7 |
| F | verificación PWA (procedimiento manual) | 9, 10 |
| G | usage | — |
| H/I | popup, options, historial | — |
| J | pasada completa 1–12 + reinicio navegador | 11 y regresión total |

La FSM (`state-machine.js`) es una función pura `(estado, señales, ahora) → estado'` sin tocar DOM ni chrome.*: se entrega con una batería de tests en Node que simulan las secuencias de los Casos 3, 4, 5 y 12 (incluida la secuencia "generar→tool→pausa→generar→fin" de tu escenario de tareas largas).

## 16. Clasificación de compatibilidad (regla final del brief)

| Área | Estado |
|---|---|
| Edge + pestañas normales | ⚠️ razonablemente compatible → pasa a ✅ tras Fase J en tu máquina |
| Chrome | ⚠️ (APIs idénticas; prueba de humo en Fase J) |
| 3 pestañas simultáneas | ⚠️ → validado en Fase D con procedimiento del Caso 2 |
| PWA Edge (misma instancia) | ❓ requiere prueba manual (procedimiento en Fase F); fallback acordado: modo pestaña |
| Windows 10 notificaciones | ⚠️ (depende de "Notificaciones y acciones" de Windows habilitado para Edge — se documenta en README) |
| Endpoint de usage | ⚠️ funcional hoy, frágil por diseño (privado); degradación limpia implementada |
