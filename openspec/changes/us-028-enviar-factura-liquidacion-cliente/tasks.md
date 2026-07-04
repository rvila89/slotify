# Tasks — us-028-enviar-factura-liquidacion-cliente

> Fuente de verdad de los pasos obligatorios: `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E); **nunca** las delega en el usuario. Cada tarea se marca `[x]`
> solo tras ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear branch `feature/us-028-enviar-factura-liquidacion-cliente` desde `master`
- [x] 0.2 Verificar la branch actual (`git branch --show-current`) — ya creada y activa

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`facturacion` MODIFICADA +
      `comunicaciones` MODIFICADA) + `design.md` y **ESPERAR su OK explícito** antes de
      contrato/TDD/implementación. No avanzar por defecto ni aunque se diga "continúa".
      Punto clave a validar: **D-1** (atomicidad síncrona estado↔E4, que INVIERTE el patrón
      post-commit de US-045; ¿red dentro de la transacción o variante reservar-número +
      commit-de-consolidación?) y **D-4** (reenvío como nueva `COMUNICACION` vs. contador).

## 2. Contrato OpenAPI (tras el gate SDD — SÍ toca API)

- [x] 2.1 `contract-engineer`: definir en `docs/api-spec.yml` los endpoints de emisión con
      envío (`POST /reservas/{id}/facturas/liquidacion/aprobar-enviar` con body opcional de
      descuento/ajuste), envío separado del recibo de fianza
      (`POST /reservas/{id}/facturas/fianza/enviar`) y reenvío
      (`POST /reservas/{id}/facturas/liquidacion/reenviar`), con respuestas y errores (`409`
      no `borrador`/no `enviada`, `422` datos fiscales/PDF, `502/503` fallo PDF/email
      recuperable sin cambio de estado, `404`, `401`). Ver `design.md §D-5`
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`) y regenerar el SDK del
      frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 3.1 Descuento negociado (dominio puro): aplicar descuento recalcula `total` y reutiliza
      el desglose fiscal de US-022 (4.100 − 200 = 3.900 → base 3.223,14 / IVA 676,86,
      `base + iva = total` exacto) — `facturacion/domain/__tests__/aplicar-descuento-liquidacion.spec.ts`
- [x] 3.2 Emisión de la liquidación: precondición `estado='borrador'` + `liquidacion_status=
      'pendiente'`; al confirmar E4 → `estado='enviada'`, `numero_factura='F-YYYY-NNNN'`,
      `fecha_emision`, `liquidacion_status='facturada'`, `RESERVA_EXTRA` marcados con `factura_id`,
      `importe_liquidacion` actualizado si hubo descuento, `AUDIT_LOG` `actualizar` —
      `facturacion/__tests__/aprobar-y-enviar-liquidacion.use-case.spec.ts`
- [x] 3.3 Efecto sobre la fianza: al confirmar E4 → `FACTURA(fianza).estado='enviada'`,
      `RESERVA.fianza_status='recibo_enviado'`; si la fianza ya se envió por separado, E4 no la
      re-emite ni retrocede `fianza_status` — `…use-case.spec.ts`
- [x] 3.4 Atomicidad estado↔E4 (rollback): fallo de PDF/email → ambas FACTURA siguen en
      `borrador`, `numero_factura=NULL`, `liquidacion_status='pendiente'`, `RESERVA_EXTRA` sin
      `factura_id`; reintento posible — `facturacion/__tests__/aprobar-y-enviar-atomicidad.spec.ts`
      (transacción real)
- [x] 3.5 Numeración en la emisión + concurrencia: `numero_factura` nulo en borrador, asignado
      solo al emitir; dos emisiones concurrentes del mismo tenant resuelven `P2002` con reintento
      (reuso de US-022), sin duplicados ni huecos consolidados — `…aprobar-y-enviar-concurrencia.spec.ts`
- [x] 3.6 Envío separado del recibo de fianza: `fianza_status='recibo_enviado'`,
      `FACTURA(fianza).estado='enviada'`, `liquidacion_status` intacto, `COMUNICACION`
      `codigo_email='manual'` (no E4) — `facturacion/__tests__/enviar-recibo-fianza-separado.use-case.spec.ts`
- [x] 3.7 Reenvío: `FACTURA(liquidacion).estado='enviada'` → reenvía PDF ya emitido, **nueva**
      `COMUNICACION` E4, `numero_factura`/`estado` intactos, status de RESERVA intactos —
      `facturacion/__tests__/reenviar-liquidacion.use-case.spec.ts`
- [x] 3.8 Reglas de validación: no aprobar si no está en `borrador` (`409`); no retroceso
      `facturada → pendiente` — `…use-case.spec.ts`
- [x] 3.9 Cableado de E4 (comunicaciones): E4 con AMBOS `pdf_url` adjuntos, verificación de
      adjuntos antes de enviar, registro `COMUNICACION` `codigo_email='E4'`,`estado='enviado'`,
      `fecha_envio`; adjunto nulo bloquea envío; modo fake en test —
      `comunicaciones/__tests__/e4-liquidacion-fianza.spec.ts`
- [x] 3.10 Confirmar que TODA la batería anterior está en ROJO antes de implementar
      (por AUSENCIA DE IMPLEMENTACIÓN), 0 tests verdes

## 4. Backend: implementar + revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [ ] 4.1 Verificar el modelo: `numero_factura` nullable (US-027), `fecha_emision`, enum
      `liquidacion_status` incluye `facturada`, `fianza_status` incluye `recibo_enviado`,
      `RESERVA_EXTRA.factura_id` nullable, `COMUNICACION.codigo_email` admite `E4` y `manual`.
      Si falta un valor de enum → migración aditiva mínima; si no, sin migración
- [ ] 4.2 `backend-developer`: función de dominio puro `aplicarDescuentoLiquidacion` (reuso del
      desglose de US-022), `AprobarYEnviarLiquidacionUseCase` (orquestación atómica estado↔E4
      según `design.md §D-1`: verificación de adjuntos + numeración con reintento `P2002` +
      transición de ambas facturas + marcado de `RESERVA_EXTRA` + actualización de
      `importe_liquidacion` + AUDIT_LOG + registro E4), `EnviarReciboFianzaSeparadoUseCase`
      (email `manual`) y `ReenviarLiquidacionUseCase` (nueva `COMUNICACION` E4), en
      `apps/api/src/facturacion/**`; dominio sin imports de infraestructura (hexagonal)
- [ ] 4.3 Integrar el motor de email de US-045 en modo **síncrono/confirmado con adjuntos**
      para E4 (`apps/api/src/comunicaciones/**`), preservando el contrato del puerto de envío
- [ ] 4.4 `frontend-developer`: en `apps/web/src/features/facturacion/**`, editor de borrador
      (total, desglose, descuento, extras), botón "Aprobar y enviar", "Enviar recibo de fianza
      por separado", y tras emitir mostrar `numero_factura` + "Reenviar factura de liquidación";
      manejo de error recuperable; mobile-first (390/768/1280)
- [ ] 4.5 Ejecutar §3 en verde; suite completa (`pnpm test`), `pnpm lint`, `pnpm typecheck` y
      `depcruise` (hexagonal) sin violaciones

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [ ] 5.1 Capturar baseline de BD (FACTURA, RESERVA, RESERVA_EXTRA, COMUNICACION, AUDIT_LOG) en
      `slotify_test`
- [ ] 5.2 Ejecutar tests dirigidos de los módulos cambiados (facturacion + comunicaciones)
- [ ] 5.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky
- [ ] 5.4 Verificar estado posterior de BD y restaurar si hace falta
- [ ] 5.5 Crear report `openspec/changes/us-028-enviar-factura-liquidacion-cliente/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Levantar el backend y verificar conexión a BD
- [ ] 6.2 Happy path: aprobar y enviar la liquidación; verificar `estado='enviada'`,
      `numero_factura` asignado, `liquidacion_status='facturada'`, fianza `enviada` +
      `fianza_status='recibo_enviado'`, `COMUNICACION` E4 `enviado`, `RESERVA_EXTRA` marcados.
      **Restaurar BD**
- [ ] 6.3 Descuento negociado: aprobar con descuento; verificar total/desglose recalculados,
      `importe_liquidacion` actualizado y descuento en `AUDIT_LOG`. **Restaurar BD**
- [ ] 6.4 Atomicidad: forzar fallo de PDF/email (transporte fake en fallo) y verificar rollback
      total (nada cambia, `numero_factura=NULL`). **Restaurar BD**
- [ ] 6.5 Envío separado del recibo de fianza: verificar `fianza_status='recibo_enviado'`,
      `liquidacion_status` intacto, `COMUNICACION` `codigo_email='manual'`. **Restaurar BD**
- [ ] 6.6 Reenvío: reenviar la liquidación emitida; verificar nueva `COMUNICACION` E4 y factura
      intacta. **Restaurar BD**
- [ ] 6.7 Casos de error: aprobar factura ya `enviada` (`409`), reserva inexistente (`404`), sin
      auth (`401`); verificar que el formato de error coincide con el contrato OpenAPI
- [ ] 6.8 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`
- [ ] 6.9 Marcar completado solo tras pasar todos los curl y restaurar la BD

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — step-N+3 — hay frontend — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar frontend y backend con BD en estado conocido
- [ ] 7.2 `browser_navigate` a la ficha de una reserva con borradores de liquidación y fianza;
      snapshot inicial
- [ ] 7.3 Flujo completo: revisar el borrador, (opcional) aplicar descuento, pulsar "Aprobar y
      enviar", verificar `numero_factura`, estado `enviada`, y el aviso de envío al cliente
- [ ] 7.4 Escenarios adicionales: "Enviar recibo de fianza por separado" y "Reenviar factura de
      liquidación"; error recuperable ante fallo de envío; responsive en 3 viewports
      (390/768/1280)
- [ ] 7.5 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
- [ ] 7.6 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [ ] 8.1 `docs-keeper`: reflejar el flujo (aprobar y enviar liquidación → E4 con ambos PDFs →
      liquidacion_status=facturada + fianza_status=recibo_enviado, más envío separado y reenvío)
      en la doc técnica; verificar alineación US-028 ↔ OpenAPI ↔ `er-diagram.md` (§3.12 FACTURA
      emitida, §3.10 RESERVA_EXTRA `factura_id`, §3.16 COMUNICACION E4/manual, §RESERVA
      liquidacion_status/fianza_status) ↔ UC-21/UC-22 ↔ E4

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [ ] 9.1 `code-reviewer` sobre el diff contra guardrails (hexagonal, dominio puro del descuento
      y del desglose, atomicidad estado↔E4 sin locks distribuidos, numeración por UNIQUE +
      reintento `P2002`, multi-tenancy/RLS, reenvío sin reasignar, envío separado como `manual`,
      mobile-first, cliente HTTP generado no editado a mano)
- [ ] 9.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación y repetir)

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [ ] 10.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 11.1 `openspec archive us-028-enviar-factura-liquidacion-cliente` (aplica el delta a
      `openspec/specs/facturacion/` y a `openspec/specs/comunicaciones/`)
- [ ] 11.2 Abrir PR (GitHub MCP o `gh`) — solo tras el gate final y con code-review APTO
      (el hook `require-code-review` lo bloquea si falta el informe APTO)
- [ ] 11.3 Registrar la URL del PR en el frontmatter de
      `user-stories/US-028-enviar-factura-liquidacion-cliente.md`

## Deuda técnica post-US-028
- [ ] Añadir guardia de disponibilidad de PDF antes de llamar al puerto E4 en `AprobarYEnviarLiquidacionUseCase` (lanzar 422 si `pdfUrl` está vacío). Actualmente el adaptador enviaría E4 con adjunto vacío si el PDF no se generó.
