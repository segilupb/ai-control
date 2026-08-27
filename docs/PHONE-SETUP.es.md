# Avisos en el teléfono con ntfy — guía completa

AI Control puede enviar una notificación a tu móvil cuando una IA termina una
tarea o necesita tu atención. Viene **desactivado** y hay dos modos:

| Modo | Por dónde viaja el aviso | ¿Funciona fuera de tu Wi-Fi? | Montaje |
|---|---|---|---|
| **A — ntfy.sh** | Por el servidor público de ntfy.sh | ✅ Sí | 3 minutos |
| **B — Tu propio servidor en la LAN** | PC → router → móvil, sin salir de tu red | ❌ No | ~15 minutos |

> **Android funciona perfecto. iOS no.** La app de Android mantiene una conexión
> permanente, que es lo que hace instantáneo el modo LAN. iOS bloquea las
> conexiones en segundo plano: en iPhone usa solo el modo A, y espera algo de
> retraso.

---

## Modo A — ntfy.sh (el fácil)

1. **Móvil:** instala **ntfy** desde Play Store (gratis, sin cuenta).
2. **Extensión:** Opciones → *Aviso en el teléfono (ntfy)*
   - Servidor: `https://ntfy.sh` (el que viene por defecto)
   - Pulsa **Generar** para crear un topic secreto (ej. `ai-control-x7km2p...`)
   - Activa **Enviar avisos a mi teléfono**
3. **Móvil:** app ntfy → **+** → *Suscribirse a un tema* → pega el topic exacto.
4. **Extensión:** pulsa **📱 Enviar prueba al teléfono**. Debe vibrar en segundos.

### Nota de privacidad
Esta es la única excepción opt-in al diseño local-first: el aviso pasa por los
servidores de ntfy.sh. Por defecto solo se envía un genérico *«Una tarea ha
terminado»*; incluir el título de la conversación es un interruptor **aparte**,
y el contenido de las conversaciones no se envía nunca, con ninguna
configuración.

Tu topic es tu dirección: **quien lo conozca puede leer tus avisos.** Usa el
aleatorio que genera la extensión, no inventes uno corto.

---

## Modo B — Tu propio servidor en la LAN (nada sale de tu red)

Ejecutas el servidor de ntfy en tu PC. El móvil habla directamente con él por
Wi-Fi. Sin internet de por medio.

### B1. Arrancar el servidor (Windows)

1. Descarga el binario de Windows desde
   [releases de ntfy](https://github.com/binwiederhier/ntfy/releases) →
   `ntfy_x.y.z_windows_amd64.zip`.
2. Descomprímelo en una carpeta permanente, p. ej. `C:\ntfy\` → debes tener
   `C:\ntfy\ntfy.exe`.
3. Pruébalo. Abre PowerShell:
   ```powershell
   C:\ntfy\ntfy.exe serve --listen-http 0.0.0.0:8080
   ```
   Deja esa ventana abierta y entra en `http://localhost:8080` desde el mismo PC.
   Deberías ver la interfaz web de ntfy.

> **`0.0.0.0:8080` importa.** Poner solo `:8080` puede dejar el servidor
> escuchando únicamente en localhost, y el móvil dará *tiempo de espera agotado*.

### B2. Abrir el puerto en el firewall

PowerShell **como administrador**, una sola vez:

```powershell
New-NetFirewallRule -DisplayName "ntfy local" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

Después comprueba que tu red está clasificada como **Privada** (si no, la regla
no se aplica):

```powershell
Get-NetConnectionProfile
```

Si `NetworkCategory` dice `Public`, cámbialo en Configuración de Windows → Red →
tu conexión → Perfil de red → **Privada**.

### B3. Averiguar la IP del PC y fijarla

```powershell
ipconfig | findstr IPv4
```

Apunta la dirección (ej. `192.168.1.50`). Luego, en el **panel del router**
(normalmente `192.168.1.1`), busca **DHCP → Reserva de direcciones** y asocia esa
IP a tu PC. Sin esto, el router puede darle otra IP y los avisos dejan de llegar
sin avisar.

### B4. Verificar desde el móvil

En el móvil (mismo Wi-Fi), abre el navegador y entra en `http://TU-IP:8080`.
Si ves la interfaz de ntfy, el camino de red funciona. Si da tiempo de espera,
repasa B1 (¿está escuchando de verdad?), B2 (firewall/perfil) y confirma que
ambos están en la misma red.

### B5. Permitir la dirección local en la extensión

Los navegadores Chromium no permiten pedir permiso para direcciones locales
arbitrarias en caliente, así que añade la tuya a `manifest.json` y recarga la
extensión:

```json
"host_permissions": [
  "https://claude.ai/*",
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
  "https://gemini.google.com/*",
  "https://ntfy.sh/*",
  "http://192.168.1.50/*"        ← tu IP, SIN el puerto
]
```

> El patrón del permiso **no** lleva puerto (los match patterns de Chrome no lo
> admiten), pero el campo Servidor de Opciones **sí** debe llevarlo.

### B6. Configurar y probar

- Opciones → Servidor: `http://192.168.1.50:8080` (tu IP, **con** puerto)
- Pulsa **Generar** para el topic y activa **Enviar avisos a mi teléfono**
- Móvil → app ntfy → ⚙ Ajustes → **Servidor por defecto** → `http://192.168.1.50:8080`
- Móvil → **+** → Suscribirse a un tema → pega el topic
- Dentro de la suscripción, activa **Entrega instantánea** y acepta la exención
  de optimización de batería cuando Android lo pida. Sin eso, Android mata la
  conexión y los avisos dejan de llegar.
- Extensión → **📱 Enviar prueba al teléfono**

---

## Automatizar el arranque en Windows (y olvidarte)

Tal cual está, ntfy muere al cerrar la ventana de PowerShell. Se arregla con el
Programador de tareas:

1. **Win+R** → `taskschd.msc` → Enter
2. Panel derecho → **Crear tarea…** (no «básica»: necesitas las opciones completas)

**Pestaña General**
- Nombre: `ntfy`
- ✅ **Ejecutar tanto si el usuario inició sesión como si no** ← esto oculta la ventana
- ✅ No almacenar la contraseña

**Desencadenadores** → Nuevo → Iniciar la tarea: **Al iniciar sesión** → Aceptar

**Acciones** → Nueva
- Acción: Iniciar un programa
- Programa: `C:\ntfy\ntfy.exe`
- Argumentos: `serve --listen-http 0.0.0.0:8080`

**Condiciones**
- ❌ Desmarca *Iniciar la tarea solo si el equipo está conectado a la corriente*
  (portátiles)

**Configuración**
- ❌ **Desmarca «Detener la tarea si se ejecuta durante más de 3 días»** ←
  imprescindible, o Windows mata el servidor a los 3 días
- ✅ Si la tarea ya se está ejecutando: **No iniciar una instancia nueva**

3. Aceptar e introducir tu contraseña de Windows.

### Verificar sin reiniciar
Cierra la ventana de PowerShell donde corre ntfy, click derecho en la tarea
`ntfy` → **Ejecutar**. Comprueba:

```powershell
netstat -an | findstr 8080
```

`0.0.0.0:8080 ... LISTENING` significa que corre sin ventana. Una línea como
`192.168.1.50:8080  192.168.1.8:39790  ESTABLISHED` significa que **tu móvil está
conectado ahora mismo** — ese es el estado ideal.

Por último, reinicia el PC y repite el comando para confirmar que sobrevive.

---

## Problemas frecuentes

| Síntoma | Causa probable |
|---|---|
| `netstat` no muestra nada en 8080 | El servidor no corre: se cerró la ventana o la tarea programada no arrancó |
| La prueba dice «enviado» pero no llega nada | El móvil no está suscrito, topic incorrecto, o entrega instantánea / batería desactivadas |
| El navegador del móvil da tiempo de espera en `http://IP:8080` | Falta la regla de firewall, el perfil de red es Público, o el servidor solo escucha en localhost |
| Funcionaba y dejó de hacerlo tras reiniciar | El router dio otra IP al PC → pon la reserva DHCP (B3) |
| Una extensión VPN del navegador intercepta direcciones locales | Excluye tu rango LAN en la VPN, o usa el modo A |
| Los avisos paran tras una actualización de Android | Se reactivó la optimización de batería para ntfy |
