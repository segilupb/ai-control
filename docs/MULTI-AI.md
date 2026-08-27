# Claude Control v2 — Multi-IA (versión personal de Sergio)

## Qué monitoriza ahora

| IA | Sitios | Color | Sonido «terminó» | Uso/límites |
|---|---|---|---|---|
| Claude | claude.ai | Naranja `#E8973F` | Acorde ASCENDENTE, 1.5 s | ✅ 5 h + semanal |
| ChatGPT | chatgpt.com, chat.openai.com | Azul `#3B82F6` | Dos notas SECAS, 1.0 s | ❌ no hay API pública |
| Gemini | gemini.google.com | Morado Google `#A142F4` | Arpegio DESCENDENTE, 1.2 s | ❌ no hay API pública |

Los tres sonidos tienen perfiles opuestos a propósito (sube / seco / baja) para
distinguirlos sin mirar la pantalla. Cada IA tiene también su propio sonido de
«necesita atención». Pruébalos en Opciones → Servicios de IA → «Probar sonido».

## Notificaciones
- Título con el nombre de la IA: «ChatGPT terminó», «⚠️ Gemini necesita tu atención».
- Si terminan varias a la vez, el aviso agrupado indica de quién es cada una.
- El aviso al teléfono (ntfy) también identifica la IA en el título y en los tags,
  así que en el móvil ves de un vistazo cuál fue.

## Ajustes nuevos
- Opciones → **Servicios de IA**: activar/desactivar cada sitio por separado.
- Historial: columna «IA» con el color de cada una.

## ⚠️ Verificación pendiente (importante)
Los detectores de **ChatGPT y Gemini** están escritos con las señales conocidas
de su DOM, pero NO están verificados en vivo como el de Claude. Procedimiento:

1. Abre chatgpt.com, lanza una respuesta larga y, mientras genera, en la consola
   de esa pestaña (F12):
   ```js
   __claudeControl.detector.detect()
   ```
2. Comprueba que `activity.streaming` o `activity.stopButton` sea `true`
   mientras escribe, y `false` cuando termina.
3. Repite en gemini.google.com.
4. Si alguna señal no responde, dime qué devuelve el comando y ajusto
   `PROVIDERS.<ia>` en `content/detector.js` — es el único archivo a tocar.

Mientras tanto, el service worker registra cada evento con la IA delante:
`[CC] ChatGPT COMPLETED 12 "Landing page" 48s`.

## Nota de la versión personal
`manifest.json` incluye `http://192.168.31.11/*` (tu servidor ntfy en LAN) y
`package.json` lleva `"ccChannel": "personal"`. Antes de publicar en GitHub hay
que quitar esa IP y poner el canal en `public` — el test de i18n lo verifica.
