# Claude Control — Licencias y origen del código

## Código de esta extensión
**Escrito desde cero en este proyecto.** No se copió código de ningún
repositorio auditado. Sonidos (WAV sintetizados) e iconos (PNG generados):
creación propia, sin assets de terceros.

## Auditoría de licencias de los repositorios de referencia

| Repositorio | Licencia | ¿Se copió código? | Uso que se le dio |
|---|---|---|---|
| A2rjav/ai-tab-notifier | MIT (LICENSE, © 2026 Aman Kirmara) | No | Referencia conceptual: patrón offscreen-audio, badge por pestaña, persistencia del SW |
| rezaska/done-chime-extension | **Sin licencia** | No (prohibido) | Referencia conceptual: estrategia de detección redundante; reimplementada por completo |
| erkinboy-botirov/claude-usage-extension | «MIT» en README, sin archivo LICENSE | No | Referencia conceptual: par de endpoints de uso; reimplementación propia con validación e invalidación |
| kunikada/claude-usage-monitor | MIT (LICENSE, © 2026 kunikada) | No | Patrón verificar/recrear alarmas en onStartup (reimplementado) |
| ScoopJr/claude-usage-tracker | **Sin licencia** | No | Descartado íntegro en auditoría (scraping con pestañas fantasma) |

Política aplicada: los repos sin archivo LICENSE se trataron como código
no-copiable; las ideas/técnicas (no protegibles como expresión) se
reimplementaron con código original.
