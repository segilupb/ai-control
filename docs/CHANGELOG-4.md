# v4.0.0 — Gemini eliminado

Gemini se retira por completo del proyecto. Motivo: leer su uso obligaba a
cargar la página `/usage` entera dentro de un iframe, lo que requería el permiso
`declarativeNetRequest` para desactivar cabeceras de seguridad de Google y
generaba un patrón de tráfico que Google marcaba como «tráfico inusual»,
bloqueando la cuenta afectada.

## Qué se eliminó
- Proveedor `gemini` del detector, patrones de red y adaptadores de uso.
- `content/gemini-usage.js` (lectura por iframe) y `rules.json`.
- **Permiso `declarativeNetRequest`** y sus reglas: existían solo para esto.
- Permiso de host `https://gemini.google.com/*`.
- Selector de cuenta de Google, sonda de índices y sonidos de Gemini.

## Ganancia colateral
La extensión pide ahora **menos permisos** y no modifica cabeceras de seguridad
de ningún sitio. Para quien la instale desde GitHub, eso es una lista de
permisos notablemente más corta y fácil de auditar.

## Qué queda
Claude y ChatGPT, con todo lo demás intacto: detección híbrida red+DOM, sonidos
distintos por IA, panel de uso, notificaciones, avisos al móvil e historial.
