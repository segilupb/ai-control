# AI Control — Cómo se decide que una tarea terminó

## Señales que alimentan la FSM

```
NETWORK (webRequest)     DOM (detector)          CONTENIDO
requests en vuelo        streaming, stop,        crece el último
por pestaña              tool, diálogos          mensaje
        \                     |                      /
         \____________________|_____________________/
                              ▼
                   ActivitySnapshot único
                              ▼
                      FSM (autoridad)
                              ▼
              SETTLING (ventana de estabilidad)
                              ▼
                         COMPLETED
```

## Reglas exactas

**Una request terminada NO completa nada.** Solo deja de sostener la tarea.
La secuencia real es:

```
request termina
    ↓  ¿stop button / streaming?  → sí → GENERATING
    ↓  ¿tool corriendo?           → sí → TOOL_RUNNING
    ↓  ¿el contenido crece?       → sí → GENERATING
    ↓  ¿otra request en vuelo?    → sí → GENERATING
    ↓  todo quieto → SETTLING → (4s estables) → COMPLETED
```

**Una request en vuelo SÍ puede iniciar la tarea**: es la señal más temprana,
llega antes de que el DOM reaccione. Por eso `netInFlight > 0` cuenta como
señal de arranque, igual que el botón stop.

**Las señales de herramienta y de crecimiento nunca inician** una tarea, solo
la sostienen: así un spinner suelto no crea tareas fantasma.

## Patrones de red vigilados
| Proveedor | Patrón |
|---|---|
| ChatGPT | `chatgpt.com/backend-api/f/conversation`, `/backend-api/conversation` |
| Gemini | `.../BardFrontendService/StreamGenerate*` |
| Claude | `claude.ai/api/organizations/*/chat_conversations/*/completion` |

Si un patrón deja de coincidir (cambio de endpoint), la detección **degrada
automáticamente a solo-DOM**, que es como funcionaba antes. Hay un test que lo
verifica.

## Fragilidades que siguen existiendo
1. **Los selectores DOM** de ChatGPT y Gemini no están verificados en vivo.
2. **Los endpoints de red** pueden cambiar de ruta sin aviso.
3. **Una herramienta silenciosa** (sin indicador visible ni request) más larga
   que la ventana de estabilidad seguiría produciendo un aviso temprano. La red
   reduce mucho este riesgo pero no lo elimina.
4. **El parser de Gemini /usage** depende del HTML de esa página.
5. **`webRequest`** en MV3 es de solo observación: si Chrome lo restringiera
   más, quedaría el modo solo-DOM.
