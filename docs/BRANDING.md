# AI Control — Identidad visual

## Nombre
- **Visible al usuario:** «AI Control» (extensión, popup, opciones, notificaciones).
- **Interno:** se conservan los identificadores históricos `claude-control`,
  namespace de mensajes `cc`, claves `CC_*` y `__claudeControl`. Renombrarlos no
  aportaría nada al usuario y rompería compatibilidad con datos ya guardados.

## Colores de proveedor (solo identidad, nunca estado)
| Proveedor | Token | Valor | Origen |
|---|---|---|---|
| Claude | `--provider-claude` | `#D97757` | terracota de Anthropic |
| ChatGPT | `--provider-chatgpt` | `#10A37F` | teal-verde de OpenAI |
| Gemini | `--provider-gemini` | `#4285F4` | azul de Google |

Aparecen **solo** en: pill del proveedor, rail lateral de la fila y barras del
medidor de uso (que es exclusivo de Claude).

## Colores de estado (nunca de marca)
| Estado | Token | Valor | Refuerzo no cromático |
|---|---|---|---|
| COMPLETED | `--state-success` | `#4ADE80` | icono `✓` |
| NEEDS_ATTENTION | `--state-warning` | `#FF6B6B` | icono `⚠` |
| GENERATING / TOOL_RUNNING / SETTLING | `--state-active` | `#c9c9ce` (neutro) | punto que respira |
| IDLE / UNKNOWN | `--state-neutral` | `#5a5a5f` | texto |

### Por qué «activo» no lleva color
Con Claude en naranja y ChatGPT en verde, cualquier color de actividad chocaría
con una marca. La actividad se comunica con **movimiento** (punto pulsante) y
texto. Así el color siempre significa lo mismo: verde = terminado, rojo = te
necesita, marca = quién es.

### Los dos verdes
El verde de éxito `#4ADE80` es claro y brillante; el de ChatGPT `#10A37F` es un
teal oscuro. Nunca coinciden en el mismo elemento (uno va en el pill izquierdo,
otro en el texto derecho) y el éxito siempre lleva `✓` delante, así que el
estado se entiende sin distinguir tonos.

## Dónde vive la paleta
`shared/tokens.css`, importado por popup y opciones. Ningún color hardcodeado
fuera de ahí.
