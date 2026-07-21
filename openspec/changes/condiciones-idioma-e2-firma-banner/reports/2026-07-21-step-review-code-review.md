# Code Review — condiciones-idioma-e2-firma-banner

Fecha: 2026-07-21 · Revisor: code-reviewer (solo lectura) · Rama: feature/condiciones-idioma-e2-firma-banner

## Resumen ejecutivo

- Mejora A (idioma en PDF de condiciones): limpia. GenerarPdfCondicionesPort.generar pasa a { tenantId, idioma: es | ca }, la clave del almacen diferencia por idioma (condiciones/{tenantId}-{idioma}.pdf) y el render selecciona texto bilingue. Tests RED->GREEN presentes (pdf-condiciones.real.adapter.idioma.spec.ts).
- Mejora B (condiciones de E3 -> E2): guarda dura CondicionesNoConfiguradasError (409) PRE-TX en GenerarPresupuestoUseCase.confirmar(), con cond_part_enviadas_fecha / cond_part_firmadas fijados en la misma transaccion de la pre_reserva. E3 (EnviarFacturaSenalUseCase) queda despojado de toda logica de condiciones (sin PDF, sin DOCUMENTO, sin guard, sin condPartAdjuntada). Contrato y SDK regenerados coherentemente.
- Mejora C (banner inline en firma): nuevo AvisoCondicionesFirmadas (emerald), useAvisosFicha con estado firma, bifurcacion con prop onRegistrado (banner) / fallback toast. Presentacional puro, mobile-first, tests unitarios verdes.
- Hexagonal / lock / multi-tenant / import de cliente generado: sin violaciones. domain/ sin imports de framework/infra; no hay Redis ni locks distribuidos; el bloqueo sigue via bloquearFecha UNIQUE; el SDK solo cambia en schema.d.ts (regenerado).
- Hallazgos: 0 bloqueantes. 2 advertencias de coherencia (epoch new Date(0) cuando condPartEnviadasFecha es null vs. contrato no-nullable; ruta de reenvio E3 sigue tocando cond_part_enviadas_fecha pese a que E3 ya no envia condiciones). Ambas fuera del camino feliz y no bloquean el merge.

## Tabla de hallazgos

| Severidad | Fichero:linea | Descripcion | Recomendacion |
|-----------|---------------|-------------|---------------|
| WARNING | apps/api/src/facturacion/interface/factura.controller.ts:416 | (resultado.condPartEnviadasFecha ?? new Date(0)).toISOString() devuelve 1970-01-01T00:00:00.000Z si el timestamp es null. El contrato EnviarFacturaSenalResponse.condPartEnviadasFecha sigue siendo required y no-nullable, asi que un epoch es enganoso. La guarda de E2 garantiza que la reserva llega a E3 con el timestamp fijado, pero el fallback puede enmascarar un dato inconsistente. | Hacer el campo nullable en contrato/DTO, o devolver 409/500 si llega null a E3 (invariante), en lugar de fabricar un epoch. |
| WARNING | apps/api/src/facturacion/infrastructure/reenvio-comunicacion.prisma.adapter.ts:135-148 | FijarCondicionesEnviadasReenvioPrismaAdapter: el reenvio de E3 sigue sobrescribiendo RESERVA.cond_part_enviadas_fecha, pero tras la Mejora B las condiciones ya no se envian en E3 (van en E2). Reescribir ese timestamp en un reenvio de la senal es incoherente con el nuevo modelo. Codigo no tocado por este diff. | Reconciliar el flujo de reenvio E3: dejar de mutar cond_part_enviadas_fecha (ese timestamp lo posee E2), en un change de seguimiento. |
| INFO | apps/api/src/presupuestos/application/generar-presupuesto.use-case.ts:294-309 + disparar-e2.adapter.ts:57-69 | El PDF de condiciones se genera dos veces al confirmar: en la guarda PRE-TX (asegurarCondicionesConfiguradas) y de nuevo post-commit en DispararE2Adapter. Es idempotente (misma clave, reuso del objeto) y ambos degradan a null / .catch sin tumbar la pre_reserva; solo hay una regeneracion redundante. | Opcional: reusar la URL obtenida en la guarda para el adjunto de E2 y evitar el doble render. |
| INFO | apps/api/src/presupuestos/application/generar-presupuesto.use-case.ts:229 | generarCondicionesPort es opcional en GenerarPresupuestoDeps (para no romper dobles de test previos); si no se inyecta, la guarda es no-op. En el PresupuestosModule real SI se inyecta (verificado), por lo que produccion siempre aplica la guarda. | Ninguna accion; vigilar que ningun wiring futuro olvide el puerto. |
| INFO | apps/web/src/api-client/schema.d.ts | Unico fichero del SDK modificado; los cambios (enum CONDICIONES_NO_CONFIGURADAS, eliminacion de condPartAdjuntada) casan con docs/api-spec.yml. Coherente con regeneracion, no edicion a mano. | Ninguna. |

## Verificacion de guardarrailes

1. Hexagonal (domain/ sin framework/infra) — OK. generar-pdf-condiciones.port.ts y los puertos nuevos (GenerarCondicionesPort, CondicionesNoConfiguradasError) son interfaces/clases puras sin @nestjs, @prisma ni imports de infrastructure/. El render se sigue inyectando como funcion.
2. Arrow functions (func-style) — OK. No se introdujeron declaraciones function; helpers/componentes nuevos son expresiones de flecha (metodos de clase NestJS exentos).
3. Multi-tenancy — OK. tenantId viaja por el comando/JWT; la guarda y la clave del PDF usan comando.tenantId / params.tenantId; los adaptadores Prisma siguen con fijarTenant(tx) y filtro por tenant. No se toma tenant de path/body.
4. Bloqueo de fecha / no lock distribuido — OK. Sin Redis/Redlock/locks en memoria en el diff. El bloqueo de fecha en confirmar() sigue intacto (UNIQUE + tx); la guarda nueva es PRE-TX y no altera el mecanismo.
5. Jobs asincronos — N/A. El change no toca crons ni barridos.
6. Importes en Decimal — N/A / OK. No se introducen campos monetarios nuevos.
7. DTOs + contrato OpenAPI — OK. EnviarFacturaSenalResponseDto elimina condPartAdjuntada en linea con api-spec.yml (required reducido a [factura, condPartEnviadasFecha]); el nuevo 409 CONDICIONES_NO_CONFIGURADAS se anade al enum PresupuestoGuardaOrigenError y lo mapea el controller de presupuesto. Coherente spec <-> DTO <-> SDK.
8. Cliente HTTP generado no editado a mano — OK. Solo schema.d.ts cambia (regeneracion); coincide con el contrato.
9. Estructura frontend por dominio + components/ solo .tsx — OK. AvisoCondicionesFirmadas.tsx vive en features/condiciones-firmadas/components/ y se exporta por el barrel index.ts; AvisosFicha lo importa por @/features/condiciones-firmadas (no por ruta interna). No se anaden .ts no-componente bajo components/.
10. Responsive (mobile-first, 3 viewports) — OK con matiz. El banner nuevo usa flex items-start gap-3 sin anchos px fijos, sin overflow a 390px. El report de Step 8 documenta el analisis en 390/768/1280 pero deja constancia de que la ejecucion Playwright real quedo pendiente de entorno; la verificacion estatica cubre el componente nuevo.
11. Errores/textos en espanol — OK. CondicionesNoConfiguradasError con mensaje en espanol; textos de UI en espanol.
12. Tests primero (TDD) + concurrencia/transiciones — OK. Existen y pasan los tests del change: guarda CondicionesNoConfiguradasError (generar-presupuesto.use-case.spec.ts), idioma del adaptador (pdf-condiciones.real.adapter.idioma.spec.ts), prop onRegistrado (CondicionesFirmadasCard.onRegistrado.test.tsx) y E3 sin condiciones (enviar-factura-senal.use-case.spec.ts). La suite de concurrencia de la pre_reserva (activar-prereserva-concurrencia.spec.ts) sigue presente y en verde tras el overrideProvider. Los fallos restantes de la suite global son pre-existentes (flakiness ESM react-pdf y concurrencia flaky), documentados en el Step 6 y en MEMORY.

## Veredicto

Veredicto: APTO

Justificacion: no hay hallazgos bloqueantes. Los guardarrailes duros (hexagonal, multi-tenancy, no-lock-distribuido, cliente generado, contrato<->DTO, TDD con tests de concurrencia y transicion en verde) se cumplen. Las dos advertencias (fallback epoch en el 200 de E3 y el reenvio E3 que aun toca cond_part_enviadas_fecha) son de coherencia semantica fuera del camino feliz, no comprometen la correccion del flujo principal y pueden resolverse en un change de seguimiento. Se recomienda ejecutar la verificacion E2E Playwright real en los 3 viewports antes de dar por cerrada la evidencia de responsive.
