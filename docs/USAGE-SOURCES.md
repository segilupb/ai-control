# AI Control — Fuentes de uso: qué es oficial y qué es estimado

| Bloque en el popup | Fuente | Tipo | Fiabilidad |
|---|---|---|---|
| **Claude** 5h + Semana | `GET claude.ai/api/organizations/{id}/usage` | **Oficial remoto** | Alta — es el dato que usa la propia web |
| **ChatGPT · Work/Codex** 5h + Semana + Créditos | `GET chatgpt.com/backend-api/wham/usage` | **Oficial remoto** | Alta, pero **solo cubre la cuota Work/Codex**, NO los chats normales |
| **Gemini** Actual + Semana | `GET gemini.google.com/usage` + parseo HTML | **Oficial remoto** | Media — el dato es oficial, el parseo es frágil |

Todo lo que se muestra procede de la fuente oficial de cada proveedor. No hay
estimaciones en el panel.

## Por qué no hay contador local de prompts
Se implementó y se retiró en la v3.1. Mezclaba una estimación propia con datos
oficiales en el mismo panel y restaba claridad. Además, como estimación era
débil: no conoce tu límite real, no pesa igual un prompt corto que uno de
razonamiento largo, y no ve lo que envíes desde el móvil u otro navegador. Un
número que parece oficial sin serlo es peor que no mostrar nada.

## Cuándo un proveedor dirá «no disponible»
- **ChatGPT**: el endpoint cubre solo la cuota **Work/Codex**. Si no usas Codex,
  no habrá datos y eso es correcto, no un fallo.
- **Gemini**: depende de que `gemini.google.com/usage` exista para tu cuenta.
- Cualquiera de los tres: sesión caducada → `inicia sesión`.

## Credenciales
- **Claude y Gemini**: solo cookies de sesión del navegador (`credentials: include`).
  La extensión nunca lee ni almacena cookies.
- **ChatGPT**: el endpoint acepta cookie, pero a veces exige `Bearer`. El token
  se obtiene de `/api/auth/session` y **vive solo en memoria del service
  worker** — nunca se escribe en storage. Al dormir el SW se pierde y se vuelve
  a pedir. Hay un test que verifica que el token no acaba en disco.

## Degradación
Cada fuente conserva su **último dato bueno**. Si falla (401/403/429, shape
cambiado, offline), se muestra el dato anterior marcado `DESFASADO` en vez de
dejar el panel vacío o inventar un número. Si no hay dato previo, se muestra el
motivo (`inicia sesión`, `no disponible`) sin cifras.

Ninguna de estas fuentes es un contrato público: pueden cambiar sin aviso.
El monitor de tareas es independiente y nunca se ve afectado.

## Gemini: por qué hace falta un iframe
La página `gemini.google.com/usage` **pinta los porcentajes con JavaScript**.
Un `fetch` del HTML devuelve el esqueleto sin los valores, así que el parseo
directo falla aunque tú veas los números en pantalla.

Por eso AI Control usa dos vías, en este orden:
1. **fetch** del HTML (barato, sin efectos secundarios). Si trae valores, listo.
2. **iframe oculto** dentro de una pestaña de Gemini que ya tengas abierta:
   ahí el JavaScript sí se ejecuta y el DOM sí tiene los porcentajes. El iframe
   se crea bajo demanda, se lee y se destruye; nunca queda nada en la página.

El iframe necesita la regla de `rules.json`, que quita `X-Frame-Options` y
`Content-Security-Policy` **solo** para la ruta `gemini.google.com/(u/N/)?usage`
y solo en sub-frames. Ninguna otra web se ve afectada.

**Consecuencia práctica:** para que Gemini muestre datos debes tener una
pestaña de Gemini abierta (la de la cuenta correcta). El iframe hereda esa
cuenta automáticamente, así que con varias cuentas de Google no hay que
configurar nada más.

## Buen comportamiento con los proveedores (rate limiting)
Consultar endpoints privados obliga a ser prudente. AI Control:

- Refresca el uso **cada 15 minutos**, no más.
- Ante un **429** o ante la página de «tráfico inusual» de Google, entra en
  **enfriamiento de 45 minutos**: deja de preguntar por completo en vez de
  insistir, que es lo que agrava un bloqueo.
- La búsqueda de cuenta de Gemini prueba primero el **iframe** de una pestaña
  abierta (cero tráfico extra) y solo si falla recorre índices, con **2 s de
  pausa** entre intentos y un máximo de 6.
- Nunca reintenta en bucle: cada fuente hace como mucho un reintento por ciclo.

### Si Google muestra «tráfico inusual»
Casi siempre es una **VPN**: muchos usuarios comparten la misma IP de salida y
Google la marca. Se reconoce porque el aviso muestra dos direcciones distintas
que no coinciden entre sí. Soluciones, por orden: desactivar la VPN unos
minutos, cambiar de servidor, o excluir `google.com` del túnel. La extensión
detecta ese aviso y se calla durante 45 minutos por su cuenta.

### Cuánto se consulta cada fuente (v3.5)
| Fuente | En segundo plano | Al abrir el popup | Suelo mínimo |
|---|---|---|---|
| Claude (JSON ligero) | cada 15 min + al terminar una tarea | si el dato tiene >5 min | — |
| ChatGPT (JSON) | ❌ nunca | si el dato no está fresco | 10 min |
| **Gemini (página completa)** | ❌ **nunca** | si el dato no está fresco | **30 min** |

Gemini se lee cargando su página en un iframe, que es una operación cara y muy
visible para Google. Por eso quedó **fuera del refresco periódico y del refresco
al terminar una tarea**: solo se lee al abrir el popup, como mucho cada 30
minutos, o cuando pulsas ↻ (acción explícita, salta el suelo).

Si aun así aparece un aviso de «tráfico inusual» de Google, desactiva Gemini en
Opciones → Servicios de IA: eso corta todas las peticiones a Google de raíz.
