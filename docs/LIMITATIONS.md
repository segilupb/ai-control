# Claude Control — Limitaciones conocidas (v1.0.0)

1. **El detector depende del DOM de claude.ai.** Es la naturaleza del enfoque
   (no existe API pública de estado). Mitigado con señales redundantes,
   preferencia por atributos `data-*`/ARIA, capa `PROBES` centralizada y
   degradación honesta a UNKNOWN. Ver FRAGILITY.md.
2. **Latencia del aviso = ventana de estabilidad.** El «terminó» llega ~4 s
   (configurable 2–10 s) después del fin real. Es el precio deliberado de no dar
   falsos positivos en pausas y herramientas.
3. **Herramientas "silenciosas".** Si una herramienta corre sin ningún indicador
   visible en el DOM durante más tiempo que la ventana de estabilidad, se
   notificará antes de tiempo. No observado con las herramientas actuales
   (spinners/aria-busy presentes), pero es el punto débil teórico del Caso 5.
4. **Idioma de la UI.** Botón Stop cubierto en inglés y español. Otros idiomas:
   añadir la palabra a `PROBES.stopAriaWords` (1 línea).
5. **Auto-ocultar aproximado.** `chrome.alarms` tiene mínimo efectivo (~30 s);
   Windows recoge el toast al Centro de actividades por su cuenta antes.
6. **Uso: endpoint privado.** Puede romperse sin aviso; degrada a "no
   disponible" sin afectar al monitor de tareas. Sin fallback automático por
   decisión de diseño (nada de scraping).
7. **Umbrales de uso dependen del refresco (10 min).** Un cruce puede avisarse
   con hasta ese retraso.
8. **PWA fuera de alcance** por decisión del proyecto (2026-08-25): uso en
   pestañas normales. El código no lo impide, pero no está probado ni soportado.
9. **Ventanas de incógnito:** no soportadas salvo que actives la extensión en
   incógnito manualmente; no probado.
10. **Aviso al teléfono = servidor de relevo.** Es físicamente imposible sin
    uno. Se usa ntfy.sh público (opt-in, mensaje genérico, topic secreto). Si
    queréis soberanía total: ntfy es auto-hospedable; habría que añadir vuestro
    dominio a `host_permissions` (1 línea del manifest) y la URL en Opciones.
11. **Un solo perfil de navegador.** El registro vive por-perfil; pestañas de
    otro perfil de Edge son invisibles (correcto, pero conviene saberlo).

---

# Nota de arquitectura

La referencia completa de arquitectura es el documento de diseño de la Fase 2
(FASE2-arquitectura.md, entregado junto al proyecto) — sigue siendo exacto:
módulos, máquina de estados con histéresis, contrato de mensajes `CC_*`,
registro multi-tab, notificaciones/badge/sonido, Usage Monitor aislado.
Cambios posteriores al diseño: PWA retirada del alcance; el resto se implementó
tal cual, con estos archivos:

```
manifest.json                MV3, permisos mínimos
content/
  state-machine.js           FSM pura (21 tests)
  detector.js                sondas del DOM, versionadas (PROBES)
  content-main.js            observer + scheduler + mensajería
background/
  service-worker.js          cableado de todo
  tab-registry.js            multi-tab (10 tests)
  notifier.js                notificaciones+agrupación (14 tests)
  badge.js                   badge global/por-pestaña
  sound.js                   puente al offscreen
  usage.js                   Módulo B (11 tests)
  history.js                 historial ligero (4 tests)
offscreen/                   reproducción de audio MV3
popup/  options/             UI (verificadas con screenshot)
sounds/ icons/               assets propios generados
tests/                       60 tests en Node, sin navegador
```
