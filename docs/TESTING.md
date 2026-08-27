# Claude Control — Procedimiento de pruebas

## Parte 1 — Tests automatizados (lógica)

```bash
node tests/test-fsm.js && node tests/test-registry.js && \
node tests/test-notifier.js && node tests/test-usage.js && node tests/test-history.js
```

Esperado: `21 / 10 / 14 / 11 / 4 pasados, 0 fallidos` (60 en total). Estos tests
cubren la lógica de los Casos 2, 3, 4, 5, 6, 8 y 12 simulando las secuencias de
señales; la Parte 2 verifica esa misma lógica contra el DOM real.

## Parte 2 — Pruebas manuales en Edge (Windows 10)

Preparación: extensión cargada (README), icono anclado, DevTools del service
worker abierto (edge://extensions → «service worker») para ver los logs `[CC]`.

### Caso 1 — Conversación normal termina
1. Pregunta algo sencillo a Claude.
2. **Esperado:** ~4 s después de que pare de escribir (ventana de estabilidad):
   notificación «Claude terminó» + título de la conversación, sonido, badge
   verde. Click en la notificación → enfoca esa pestaña y el badge se limpia.

### Caso 2 — Tres conversaciones simultáneas
1. Abre 3 pestañas de claude.ai y lanza una tarea distinta en cada una,
   escalonadas (~30 s entre ellas).
2. Abre el popup: 3 filas con estados y cronómetros independientes.
3. **Esperado:** 3 notificaciones (o grupo si coinciden en <5 s), cada una
   enfocando su pestaña. En el SW: tres tabId distintos. Ningún estado se mezcla.

### Caso 3 — Generación larga
1. Pide una tarea de varios minutos (p. ej. un análisis extenso).
2. **Esperado:** ninguna notificación mientras genera; badge naranja; una única
   notificación al final real.

### Caso 4 — Pausa temporal
1. Durante una tarea larga, observa las micro-pausas del streaming (o
   provócalas con una tarea que "piense" entre secciones).
2. **Esperado:** pausas < 4 s jamás notifican. El popup puede mostrar
   «Finalizando…» y volver a «Generando» — eso es SETTLING haciendo su trabajo.

### Caso 5 — Tarea con herramientas
1. Pide algo que use herramientas encadenadas (analizar un repo, ejecutar
   código, buscar) con generación entre medias.
2. **Esperado:** cero notificaciones en las transiciones generar→herramienta→
   generar; el popup alterna «Generando»/«Herramienta»; una sola notificación
   al final del todo.

### Caso 6 — Intervención
1. Provoca un diálogo de permiso/confirmación (p. ej. una acción de conector) o
   un error de generación.
2. **Esperado:** «⚠️ Claude necesita tu atención» con el motivo, sonido distinto,
   badge rojo, y la notificación NO se auto-oculta. Al resolverlo y continuar la
   tarea: sin re-aviso, y el «terminó» llega solo al final.

### Caso 7 — Otra aplicación en primer plano
1. Lanza una tarea y vete a VS Code/Photoshop a pantalla completa.
2. **Esperado:** el toast de Windows aparece por encima igualmente. Si no:
   Configuración → Notificaciones (ver README) y desactiva Asistencia de
   concentración.

### Caso 8 — Pestaña en segundo plano
1. Lanza una tarea y cámbiate a otra pestaña del navegador ≥2 min.
2. **Esperado:** la monitorización continúa (heartbeats de 30 s mantienen viva
   la entrada; el sweep de zombis no la degrada) y la notificación llega igual.

### Caso 11 — Reinicio del navegador
1. Con una tarea en curso, cierra Edge por completo y reábrelo.
2. **Esperado:** sin notificaciones fantasma de la sesión anterior; al recargar
   claude.ai las pestañas se re-registran solas; el historial y los ajustes
   persisten (el estado en vivo, correctamente, no).

### Caso 12 — Corte de conexión
1. En mitad de una tarea, desconecta el Wi-Fi 10–20 s y reconéctalo.
2. **Esperado:** ningún «terminó» durante el corte (estado suspendido). Tras
   reconectar: si la tarea sigue, continúa; si terminó de verdad, el aviso llega
   tras una ventana de estabilidad nueva completa.

### Extra — Monitor de uso
1. Popup → sección Uso: porcentajes y cuenta atrás coherentes con
   claude.ai/settings/usage. ↻ fuerza refresco.
2. Cierra sesión en claude.ai y pulsa ↻: error accionable («abre claude.ai e
   inicia sesión») y las tareas siguen monitorizándose.

### Extra — Historial
1. Tras varios casos: Opciones → Historial. Entradas con resultado correcto
   (Terminó/Atención/Abandonada al cerrar una pestaña activa). Exportar JSON
   descarga el archivo; Vaciar lo limpia.

## Si un caso falla
Diagnóstico en la consola de la pestaña de claude.ai:
```js
__claudeControl.detector.detect()
```
Compara las señales con lo que ves en pantalla y ajusta `content/detector.js →
PROBES` (docs/FRAGILITY.md indica qué sonda gobierna cada comportamiento).
