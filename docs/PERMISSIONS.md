# Claude Control — Permisos

Principio: **mínimo imprescindible**. Sin `<all_urls>`, sin `cookies`, sin
`scripting`, sin `webRequest`, sin `history`, sin `management`.

| Permiso | Para qué se usa | Qué pasaría sin él |
|---|---|---|
| `tabs` | Identificar cada pestaña de claude.ai (tabId/windowId/título/URL), enfocarla al hacer click en una notificación o en el popup, y propagar cambios de ajustes a las pestañas vivas | No se podría distinguir entre tus 3 conversaciones ni saltar a la correcta |
| `notifications` | Los avisos nativos de Windows («terminó» / «atención» / umbral de uso) | La función principal desaparece |
| `storage` | `storage.local`: ajustes, historial (máx. 200 entradas de metadatos), cache de uso. `storage.session`: espejo del registro de pestañas para sobrevivir al sleep del service worker | La extensión olvidaría todo cada ~30 s (ciclo de vida MV3) |
| `offscreen` | Documento oculto que reproduce el aviso sonoro (MV3 no permite audio en el service worker) | Sin sonido propio; solo el tono del SO |
| `alarms` | Sweep de pestañas zombi (1/min), refresco de uso (10 min), auto-ocultar notificaciones | Timers con `setTimeout` morirían con el service worker |
| `host_permissions: https://ntfy.sh/*` | (v1.1.0) Solo si activas el aviso al teléfono: enviar el POST del aviso. Con la función apagada no se usa nunca | Sin aviso remoto |
| `optional_host_permissions: http(s)://*/*` | (v1.2.0) SOLO se concede, con tu click en «Autorizar», el origen exacto del servidor ntfy propio que escribas (p. ej. `http://192.168.1.50:8080/*`). Sin servidor propio, no se concede nada | Sin ntfy auto-hospedado |
| `host_permissions: https://claude.ai/*` | (1) Inyectar el content script que observa el estado de la página; (2) los dos GET del monitor de uso con tu sesión | Ni detección ni uso |

Notas:
- El content script se inyecta **solo** en `https://claude.ai/*`. La extensión es
  ciega ante cualquier otra web.
- No se leen cookies mediante API (`credentials: 'include'` deja que el navegador
  las adjunte él mismo, sin exponerlas al código de la extensión).
