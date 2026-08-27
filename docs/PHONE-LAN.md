# Claude Control — Avisos al teléfono 100 % en tu red local (sin internet)

Objetivo: que el aviso PC → teléfono no salga de vuestro Wi-Fi. La pieza que lo
hace posible es ejecutar el **servidor ntfy** (un solo .exe, open source) en el
mismo PC donde corre la extensión. El teléfono se suscribe a la IP local del PC.

> Nota de contexto: el proyecto original excluía servidores locales (requisito
> de Joel). Este modo es OPCIONAL y convive con el modo ntfy.sh; decidid en
> equipo cuál usar.

> ⚠️ **Android sí, iPhone no.** La app ntfy de Android mantiene una conexión
> permanente en LAN («entrega instantánea»). iOS prohíbe conexiones persistentes
> en segundo plano: con iPhone los avisos locales llegan tarde o nunca — quédate
> con ntfy.sh.

---

## Paso 1 — Servidor ntfy en el PC (Windows 10)

1. Descarga el binario de Windows desde las releases oficiales:
   `https://github.com/binwiederhier/ntfy/releases` → `ntfy_x.y.z_windows_amd64.zip`.
2. Descomprime p. ej. en `C:\ntfy\` (queda `C:\ntfy\ntfy.exe`).
3. Prueba manual — abre PowerShell:
   ```powershell
   C:\ntfy\ntfy.exe serve --listen-http :8080
   ```
   Deja esa ventana abierta de momento. En el navegador del PC abre
   `http://localhost:8080` → debe verse la interfaz web de ntfy.
4. Permite el puerto en el firewall (una vez, PowerShell **como administrador**):
   ```powershell
   New-NetFirewallRule -DisplayName "ntfy local" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
   ```
   (`-Profile Private`: solo en redes marcadas como privadas — asegúrate de que
   vuestro Wi-Fi lo está en Configuración de red.)
5. Arranque automático sin ventana — Programador de tareas:
   - Win+R → `taskschd.msc` → «Crear tarea básica…»
   - Nombre: `ntfy` · Desencadenador: **Al iniciar sesión** · Acción: iniciar
     `C:\ntfy\ntfy.exe` con argumentos `serve --listen-http :8080`
   - En Propiedades de la tarea → General → marca «Ejecutar tanto si el usuario
     inició sesión como si no» si quieres que sobreviva a cierres de sesión, y
     en Configuración desmarca «Detener si se ejecuta más de…».

## Paso 2 — IP fija del PC en el router

La app del teléfono apuntará a la IP del PC; si el router se la cambia, se rompe.
1. Averigua IP y MAC del PC: `ipconfig /all` (p. ej. `192.168.1.50`).
2. En el panel del router (habitualmente `192.168.1.1`): busca **DHCP →
   Reserva de direcciones** (o «Static lease») y fija esa MAC → esa IP.

## Paso 3 — Extensión

> **Importante (Edge):** algunas versiones de Edge no permiten conceder permisos
> de host «bajo demanda» con el botón Autorizar. En ese caso, declara la IP de tu
> PC directamente en `manifest.json` y recarga la extensión:
> ```json
> "host_permissions": [
>   "https://claude.ai/*",
>   "https://ntfy.sh/*",
>   "http://192.168.1.50/*"      ← tu IP, SIN el puerto
> ]
> ```
> El puerto no se pone en el permiso (los match patterns no lo admiten), pero sí
> en el campo Servidor de Opciones (`http://192.168.1.50:8080`).


1. Opciones → «Aviso en el teléfono»:
   - **Servidor**: `http://192.168.1.50:8080` (tu IP real)
   - Pulsa **Autorizar** → Edge te pedirá conceder acceso a ese origen exacto
     (es el único permiso nuevo; ntfy.sh de serie no lo necesita).
   - **Generar** topic si no lo tenías, activa el interruptor.
2. **📱 Enviar prueba** todavía no llegará al móvil (falta el paso 4), pero debe
   marcar «✓ enviado» — significa que el PC alcanzó a su propio servidor.

## Paso 4 — Teléfono (Android)

1. App ntfy → ⚙ Ajustes → **Servidor por defecto** → `http://192.168.1.50:8080`
   (o al suscribirte, «Usar otro servidor»).
2. ➕ Suscribirse a un tema → pega el topic de la extensión.
3. En la suscripción, activa **Entrega instantánea** (crea la conexión
   permanente en LAN) y acepta desactivar la optimización de batería para ntfy
   cuando Android lo pregunte — sin eso, Android mata la conexión.
4. Vuelve a Opciones de la extensión → **📱 Enviar prueba** → ahora sí debe
   sonar el teléfono.

## Comprobación y límites

- Prueba real: tarea larga en Claude, teléfono en el bolsillo, paseo por la
  oficina. El aviso debe llegar en <2 s.
- Fuera del Wi-Fi **no llega nada** (es la gracia y el precio: cero internet).
  Si un día quieres ambos mundos, ntfy soporta que el móvil esté suscrito al
  topic local Y a uno de ntfy.sh a la vez; la extensión solo envía a un servidor,
  así que elegirías por temporadas, o montaríamos doble envío si os hace falta.
- Si el aviso deja de llegar: ① ¿sigue viva la tarea programada del ntfy.exe?
  (`http://localhost:8080` en el PC) ② ¿cambió la IP? (reserva DHCP) ③ ¿Android
  volvió a activar la optimización de batería para ntfy tras una actualización?

## Privacidad en este modo

Mejor imposible: el aviso viaja PC → router → teléfono dentro de vuestra red.
Sin TLS (es HTTP local): cualquiera DENTRO del Wi-Fi con herramientas podría ver
pasar «Una tarea ha terminado» — irrelevante en la práctica; si el Wi-Fi de la
oficina tiene invitados y os importa, ntfy soporta usuarios/contraseña y TLS
(`ntfy serve --help`), pero para este caso de uso es matar moscas a cañonazos.
