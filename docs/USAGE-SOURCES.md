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
