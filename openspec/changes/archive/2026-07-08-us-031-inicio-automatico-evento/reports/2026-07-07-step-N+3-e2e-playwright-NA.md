# Step N+3 — E2E Playwright: N/A  (2026-07-07)

Change: `us-031-inicio-automatico-evento`

---

## Justificacion de exencion

US-031 no introduce ninguna pantalla, componente o flujo de usuario nuevo. El actor es **Sistema** (proceso de cron backend); no hay interaccion humana con el navegador.

Motivos especificos:

1. **Sin frontend propio:** El endpoint `POST /api/cron/barrido-eventos` es invocado exclusivamente por el cron scheduler (`BarridoEventosScheduler`) o por herramientas de operaciones (curl, monitorizado). No hay pagina, formulario ni control UI asociados a US-031.

2. **Vistas de UI fuera de alcance de este change:** La vista movil "evento en curso" y el checklist de apertura/cierre son US-033 y US-034 (out-of-scope en el briefing de US-031, marcadas con `out-of-scope`). No se entregan en este change.

3. **Efecto UI observable de forma indirecta:** El unico efecto observable en UI es que una reserva transicionada por el barrido aparece en estado `evento_en_curso` en el pipeline de US-049/US-039. Este efecto queda verificado de forma suficiente:
   - A nivel de unit/integracion: los tests de `iniciar-eventos-del-dia-integracion.spec.ts` verifican que `reserva.estado = 'evento_en_curso'` en BD tras el barrido.
   - A nivel de curl: el Step N+2 verifica la transicion en BD y la respuesta del endpoint.
   - El pipeline US-049 (`GET /reservas`) consume `RESERVA.estado` desde BD, sin logica adicional relacionada con US-031.

4. **Breakpoints responsivos no aplican:** No hay layouts, drawers ni navegacion nueva en este change.

---

## Verificacion indirecta del efecto UI (opcional)

El efecto de que una reserva transicionada por el barrido se muestra como `evento_en_curso` en `GET /reservas` se verifica indirectamente:

- El adaptador Prisma `candidatas-inicio-evento.prisma.adapter.ts` escribe `estado='evento_en_curso'` en la fila RESERVA.
- `GET /reservas` (US-049) lee `RESERVA.estado` directamente; no tiene logica especifica para US-031.
- Los tests de integracion de US-031 confirman que tras `servicio.ejecutar()`, `reserva.estado === 'evento_en_curso'` en BD.

Por tanto, si la BD tiene el estado correcto (verificado por unit + curl), la UI de US-049 lo mostrara correctamente sin necesidad de un test E2E especifico para US-031.

---

## Outcome

**N/A — Exencion justificada.** No hay frontend que probar. El efecto de BD queda verificado por unit + curl (Steps N+1 y N+2).
