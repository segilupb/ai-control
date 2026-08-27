# Claude Control — Privacidad

**Qué se procesa y dónde se queda:**

| Dato | Dónde vive | Sale del navegador |
|---|---|---|
| Estado de cada pestaña (generando/terminó/atención) | Memoria + `storage.session` | ❌ |
| Título de la conversación (del `document.title`) | Notificaciones e historial local | ❌ |
| Historial de tareas (título, tiempos, resultado; máx. 200) | `storage.local` | ❌ |
| Ajustes | `storage.local` | ❌ |
| % de uso y horas de reset | `storage.local` (cache) | ❌ |

**Qué NO se hace, nunca:**
- Leer, almacenar o transmitir el **contenido** de tus conversaciones.
- Peticiones a servidores propios o de terceros: **cero**. Sin Firebase, sin
  analytics, sin telemetría, sin crash-reporting.
- Tokens o credenciales: no se piden, no se guardan, no se tocan.

**Excepción opt-in — Aviso en el teléfono (v1.1.0):** si TÚ lo activas en
Opciones, cada finalización/atención envía un POST a `ntfy.sh` (servicio
open-source de notificaciones push) con un topic secreto aleatorio. Contenido
por defecto: solo «Una tarea ha terminado» / «Se requiere tu intervención» —
el título de la conversación solo viaja si activas ese segundo interruptor, y
el contenido de las conversaciones no viaja jamás (el módulo ni lo recibe).
Apagado de fábrica; verificado por test que apagado no genera ninguna petición.
Alternativa 100 % local: servidor ntfy propio en la LAN (docs/PHONE-LAN.md) —
en ese modo ni siquiera esta excepción existe: nada sale de vuestra red.

**El resto de red que existe:** dos GET a `https://claude.ai/api/...` (organización
y uso) autenticados por el propio navegador con tu sesión ya iniciada, cada 10
minutos o al pulsar ↻. Puedes verificarlo: DevTools del service worker → Network.
