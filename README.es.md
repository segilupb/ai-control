<div align="center">

# AI Control

**Entérate justo cuando tu IA termina — aunque estés en otra aplicación.**

Extensión local-first para Edge, Chrome y cualquier navegador Chromium que vigila tus pestañas de **Claude**, **ChatGPT** y **Gemini** y te avisa cuando una tarea termina de verdad, cuando alguna necesita tu intervención, y cuánta cuota te queda.

[![License: MIT](https://img.shields.io/badge/License-MIT-c45a1a.svg)](LICENSE)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-2b6cb0)
![Tests](https://img.shields.io/badge/tests-133%20passing-2f855a)
![Sin dependencias](https://img.shields.io/badge/dependencias-ninguna-555)

[Instalación](#instalación) · [Cómo detecta](#cómo-detecta) · [Panel de uso](#panel-de-uso) · [Avisos al móvil](#avisos-al-móvil) · [Privacidad](#privacidad)

[English](README.md) · **Español**

</div>

---

## Para qué

Le encargas algo largo a una IA —analizar un repo, refactorizar un módulo, investigar— y te vas a hacer otra cosa. Diez minutos después vuelves y descubres que terminó hace nueve. O peor: se detuvo a los treinta segundos esperando un permiso que nunca viste.

AI Control vigila las pestañas por ti.

- 🔔 **«Claude terminó» / «ChatGPT terminó» / «Gemini terminó»** — salta cuando la tarea acabó *de verdad*, no en una pausa entre herramientas. **Cada IA tiene su propio sonido**, así sabes cuál fue sin mirar.
- ⚠️ **«… necesita tu atención»** — aviso distinto (otro tono, no se auto-oculta) para permisos, confirmaciones, errores o sesión caducada.
- 📊 **Panel de uso** — ventanas de 5 h y semanal de Claude, cuota Work/Codex de ChatGPT, límites actual y semanal de Gemini.
- 🔢 **Badge de un vistazo** — rojo = te esperan, verde = terminadas sin ver, naranja = trabajando.
- 📱 **Avisos al móvil opcionales** — vía [ntfy](https://ntfy.sh), incluido un montaje 100 % local que no toca internet.
- 🌍 **Seis idiomas** — inglés, español, portugués (BR), francés, alemán e italiano. La detección también es multiidioma, no solo la interfaz.

Todo se queda en tu navegador. Sin cuentas, sin analytics, sin servidores.

## Cómo detecta

Casi todas las extensiones de «avísame cuando la IA termine» vigilan que desaparezca el botón de detener y saltan al instante. Eso se rompe en cuanto la IA hace algo interesante: generar → ejecutar una herramienta → pensar → generar → terminar. Cada pausa parece una finalización.

AI Control combina tres fuentes de señal independientes y deja que decida una máquina de estados con **histéresis**:

```
RED (webRequest)         DOM (sondas por proveedor)    CONTENIDO
requests en vuelo        streaming, botón detener,     el último mensaje
por pestaña              indicadores de herramienta    sigue creciendo
        \                        |                        /
         \_______________________|_______________________/
                                 ▼
                     un ActivitySnapshot único
                                 ▼
                   máquina de estados (autoridad)
                                 ▼
                 SETTLING → (4 s estables) → COMPLETED
```

**Una request terminada nunca completa una tarea por sí sola.** Es evidencia, no una transición:

```
la request termina
    ↓  ¿botón detener / streaming visible?  → sí → sigue GENERATING
    ↓  ¿hay una herramienta corriendo?      → sí → TOOL_RUNNING
    ↓  ¿el contenido sigue creciendo?       → sí → GENERATING
    ↓  ¿queda otra request en vuelo?        → sí → GENERATING
    ↓  todo quieto → SETTLING → (4 s) → COMPLETED ✔
```

Otras garantías, todas cubiertas por tests: una request en vuelo *sí* puede iniciar una tarea (es la señal más temprana); los indicadores de herramienta sostienen una tarea pero nunca la inician, así que un spinner suelto no crea tareas fantasma; las tareas de menos de 1,5 s se descartan como parpadeo del DOM; perder la conexión **suspende** la máquina, así que un corte de red jamás se confunde con una tarea terminada; y si algún patrón de red deja de coincidir, la detección degrada limpiamente a solo-DOM.

## Instalación

No está en la Web Store. Se carga desempaquetada, es cosa de un minuto:

1. **[Descarga la última release](../../releases)** y descomprime en una carpeta **permanente** (si la mueves o borras después, la extensión se desactiva).
2. Abre `edge://extensions` (o `chrome://extensions`).
3. Activa el **Modo de desarrollador**.
4. **Cargar desempaquetada** → selecciona la carpeta que contiene `manifest.json`.
5. Ancla la extensión para ver el badge.

> **Windows:** si no aparecen las notificaciones, revisa Configuración → Sistema → **Notificaciones**: tu navegador debe tenerlas permitidas y la **Asistencia de concentración** no debe estar silenciando los avisos mientras usas una app a pantalla completa.

## Panel de uso

| Proveedor | Fuente | Qué obtienes |
|---|---|---|
| **Claude** | API de uso de `claude.ai` | 5 h + semanal, con horas de reset |
| **ChatGPT** | `backend-api/wham/usage` | **Solo la cuota Work/Codex** + créditos — etiquetado como tal, nunca presentado como todo tu uso de ChatGPT |
| **Gemini** | `gemini.google.com/usage` | Límites actual y semanal |

Los tres son endpoints privados sin contrato público. AI Control valida el formato de la respuesta, conserva el último dato bueno y lo marca `desfasado` en vez de mostrar un número inventado, y un fallo en cualquiera de ellos nunca afecta al monitor de tareas.

**Gemini necesita una pestaña de Gemini abierta.** Esa página pinta los porcentajes con JavaScript, así que un fetch normal devuelve un esqueleto vacío. AI Control la lee mediante un iframe oculto same-origin dentro de una pestaña que ya tengas abierta — lo que además hace que use la cuenta correcta automáticamente si tienes varias cuentas de Google. Ver [docs/USAGE-SOURCES.md](docs/USAGE-SOURCES.md).

Si un proveedor muestra *«no publicado»*, normalmente es correcto y no un fallo: ChatGPT solo expone la cuota Work/Codex, y la página de uso de Gemini no existe en todos los planes.

## Avisos al móvil

Desactivados por defecto. Dos modos, ambos documentados paso a paso en **[docs/PHONE-SETUP.es.md](docs/PHONE-SETUP.es.md)**:

- **ntfy.sh** — instalas la app ntfy, generas un topic, te suscribes. Tres minutos.
- **Tu propio servidor en la LAN** — ejecutas el binario de ntfy en tu PC; los avisos van PC → router → móvil sin tocar internet. La guía cubre la regla del firewall, la reserva DHCP, la entrada de tu IP local en `manifest.json`, **el arranque automático en Windows con el Programador de tareas** y una tabla de problemas frecuentes.

> El modo LAN es solo para Android: iOS bloquea la conexión persistente en segundo plano que necesita.

## Privacidad

Local-first es la arquitectura, no un eslogan:

- El **contenido** de las conversaciones no se lee, ni se guarda, ni se transmite. La extensión ve señales de estado y el título de la pestaña, nada más.
- Sin analytics, sin telemetría, sin informes de errores, sin servidores propios.
- Peticiones de red, todas: los endpoints de uso de arriba (autenticados con tu propia sesión del navegador) y el `POST` a ntfy **solo si activas los avisos al móvil**.
- El endpoint de uso de ChatGPT a veces necesita un token. Se obtiene bajo demanda y **vive solo en memoria** — nunca se escribe en almacenamiento. Hay un test que verifica que no acaba en disco.
- El historial guarda solo metadatos —proveedor, título, tiempos, resultado—, máximo 200 entradas, exportable y borrable.

Ver [docs/PRIVACY.md](docs/PRIVACY.md) y [docs/PERMISSIONS.md](docs/PERMISSIONS.md), donde cada permiso está justificado uno a uno.

## Tests

```bash
npm test     # 133 tests en Node puro, sin dependencias ni navegador
```

Cubren la máquina de estados (incluida la secuencia completa `generar → herramienta → pausa → generar → terminar`), el detector híbrido red+DOM, el registro multi-pestaña, la agrupación de notificaciones y el enrutado de clicks, los tres adaptadores de uso con fixtures de respuestas reales más casos 401/403/429/offline/desfasado/formato-cambiado, y la integridad de los idiomas.

Las comprobaciones que dependen del navegador están guionizadas en [docs/TESTING.md](docs/TESTING.md).

## Contribuir

Añadir un idioma es un archivo JSON y una entrada en un array — ver [CONTRIBUTING.md](CONTRIBUTING.md). `node tests/test-i18n.js` falla si a algún idioma le falta una clave o rompe un placeholder.

Si la detección se rompe porque un proveedor rediseña su interfaz, todo lo que hay que editar vive en `content/detector.js`, dentro de `PROVIDERS`. [docs/FRAGILITY.md](docs/FRAGILITY.md) mapea cada punto frágil con lo que hay que cambiar exactamente.

## Limitaciones conocidas

Las honestas, en [docs/LIMITATIONS.md](docs/LIMITATIONS.md). En corto: la detección depende del DOM y los endpoints de cada proveedor, que pueden cambiar sin aviso; el aviso de «terminó» llega ~4 s tarde a propósito para evitar falsos positivos; las fuentes de uso son APIs privadas; el uso de Gemini necesita una pestaña abierta; las ventanas PWA quedan fuera de alcance.

## Créditos

Escrito desde cero tras auditar una docena de extensiones existentes — [docs/LICENSES.md](docs/LICENSES.md) documenta qué se estudió y por qué no se copió código. Los sonidos y los iconos están generados, no tomados de terceros.

Licencia MIT. Sin afiliación con Anthropic, OpenAI ni Google.
