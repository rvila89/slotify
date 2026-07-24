# Tasks — fix-liquidacion-fianza-independientes

> Pasos obligatorios del harness (SDD + TDD), en orden. El AGENTE ejecuta él mismo todas las
> pruebas (unit, curl, E2E); NUNCA las delega en el usuario. Cada `[x]` se marca solo tras
> ejecutar y verificar. Los tests de integración/concurrencia con BD real se lanzan desde la
> sesión principal (los subagentes QA no tienen Postgres).

## 0. Setup: feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Worktree y rama `worktree-fix-liquidacion-fianza-independientes` ya creados (EnterWorktree)
- [x] 0.2 Artefactos OpenSpec creados: `proposal.md`, `design.md`, `tasks.md` + spec-deltas por
      capability (`facturacion`, `comunicaciones`, `ficha-operativa`, `confirmacion`)
- [x] 0.3 `openspec validate 2026-07-24-fix-liquidacion-fianza-independientes --strict` → OK

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-deltas + `design.md`; ESPERAR OK explícito
- [x] 1.2 Decisiones D-1..D-5 revisadas y aprobadas en el gate
- [x] 1.3 OK recibido ("adelante") — avanzar a contrato/TDD/implementación

## 2. Contrato OpenAPI + SDK (post-gate — dueño: contract-engineer)
- [x] 2.1 Añadir a `docs/api-spec.yml`: `POST /reservas/{id}/facturas/liquidacion/enviar`,
      `POST /reservas/{id}/facturas/liquidacion/reenviar`,
      `POST /reservas/{id}/fianza/comprobante` (multipart), `POST /reservas/{id}/fianza/devolver`
- [x] 2.2 Eliminar de `docs/api-spec.yml`: `.../facturas/liquidacion/aprobar-enviar` (combinado),
      `.../facturas/fianza/enviar`, cobro de fianza, `registrar-iban-devolucion`, variante de
      devolución con retención/importe; retirar `iban_devolucion` de los schemas de CLIENTE
- [x] 2.3 Ajustar schemas: `TipoFactura` sin `fianza`; `FianzaStatus` = `pendiente|cobrada|devuelta`;
      quitar `motivo_retencion`/`fianza_devuelta_eur`; enhebrar `fianza_comprobante_fecha` y
      `fianza_devuelta_fecha` donde aplique al read path
- [x] 2.4 `spectral lint docs/api-spec.yml` → 0 errores
- [x] 2.5 Regenerar SDK (`pnpm --filter web run generate-client`); NO editar el cliente a mano
- [x] 2.6 Verificar clave de matching contrato↔backend con el payload real del SDK

## 3. Modelo de datos: migración Prisma (post-gate)
- [x] 3.1 `schema.prisma`: `TipoFactura` drop `fianza`; `FianzaStatus` → `pendiente|cobrada|devuelta`
- [x] 3.2 `RESERVA`: drop `motivo_retencion`, `fianza_devuelta_eur`; add `fianza_comprobante_fecha`
      (o referencia al DOCUMENTO comprobante); conservar `fianza_eur`/`fianza_cobrada_fecha`/
      `fianza_devuelta_fecha`
- [x] 3.3 `CLIENTE`: drop `iban_devolucion`
- [x] 3.4 `DOCUMENTO`: add `tipo = 'comprobante_fianza'`
- [x] 3.5 Confirmar que no quedan filas con `TipoFactura.fianza` ni `FianzaStatus ∈
      {recibo_enviado, retenida_parcial}` (decidir backfill si las hubiera)
- [x] 3.6 `prisma migrate dev` en worktree; `prisma generate`; actualizar `docs/er-diagram.md` y
      `docs/data-model.md`

## 4. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 4.1 Unit dominio: `subir-comprobante-fianza` marca `fianza_status='cobrada'` + crea DOCUMENTO
      `comprobante_fianza` (espejo firma condiciones); opcional, re-subible
- [x] 4.2 Unit dominio: `devolver-fianza` → `fianza_status='devuelta'` + `fianza_devuelta_fecha`;
      guarda doble registro; sin IBAN/importe/motivo
- [x] 4.3 Unit: `enviar-factura-liquidacion` standalone (número asignado en emisión, `enviada`,
      `liquidacion_status='facturada'`, E4 solo liquidación, no toca fianza) + `reenviar-liquidacion`
- [x] 4.4 Unit catálogo: E4 CA/ES nuevo texto (solo liquidación); nueva plantilla "fianza devuelta"
      CA/ES con `{nombre}`/`{fianzaEur}`
- [x] 4.5 Unit máquina de estados: guarda `evento_en_curso` = `pre_evento_status='cerrado'` +
      `liquidacion_status='cobrada'` (sin fianza)
- [x] 4.6 Unit PDF liquidación: modelo con subtítulo/condicions/pie fieles a la referencia, CA/ES
- [x] 4.7 Integración (sesión principal, Postgres): comprobante, devolución + email best-effort,
      emisión/reenvío liquidación por SQL/HTTP real
- [x] 4.8 Confirmar suite en ROJO (RED) antes de implementar

## 5. Backend: implementación (OBLIGATORIO — step-N)
- [x] 5.1 Añadir `enviar-factura-liquidacion.use-case.ts` + `reenviar-liquidacion` (espejo señal)
- [x] 5.2 Añadir `subir-comprobante-fianza.use-case.ts` (espejo `registrar-firma-condiciones`)
- [x] 5.3 Añadir `devolver-fianza.use-case.ts` + adapter email post-commit best-effort (patrón
      `disparar-e8.adapter.ts`)
- [x] 5.4 Modificar `generar-borradores-liquidacion-fianza.use-case.ts` → solo liquidación
- [x] 5.5 Modificar `pdf-factura.real.adapter.ts` + plantilla (variante liquidación fiel a la
      referencia, CA/ES)
- [x] 5.6 Modificar `catalogo-plantillas.ts` (E4 solo liquidación CA/ES; nueva "fianza devuelta"
      CA/ES) + `emision-email.adapter.ts` (E4 solo liquidación)
- [x] 5.7 Modificar máquina de estados: guarda `evento_en_curso` sin fianza
- [x] 5.8 Eliminar `aprobar-y-enviar-liquidacion` combinado, `registrar-cobro-fianza.*`,
      `registrar-iban-devolucion.*`, `disparar-e8.adapter.ts`, `cargar-reserva-iban-devolucion.*`,
      retención/IBAN de `registrar-devolucion-fianza.*`, plantillas E5/E8
- [x] 5.9 Respetar hexagonal/DDD, RLS/tenant, idempotencia `UNIQUE(reserva_id, tipo)`, jobs asíncronos

## 6. Frontend: implementación (OBLIGATORIO — step-N)
- [x] 6.1 Añadir `FacturaLiquidacionCard.tsx` (espejo `FacturaSenalCard.tsx`, banner permanente)
- [x] 6.2 Añadir `FianzaComprobanteCard.tsx` (espejo `CondicionesFirmadasCard.tsx`)
- [x] 6.3 Añadir botón "Devolver fianza" en la sección de fianza (post_evento) + hooks
      `useEnviarFacturaLiquidacion`, `useReenviarLiquidacion`, `useSubirComprobanteFianza`,
      `useDevolverFianza` (invalidar `comunicacionesReservaQueryKey`)
- [x] 6.4 Modificar `SeccionesFicha.tsx`: orden señal → liquidación → operativa → condiciones →
      fianza → comunicaciones
- [x] 6.5 Eliminar `DocumentosLiquidacionFianza.tsx`, `AccionesFacturacion.tsx`,
      `AprobarEnviarLiquidacionDialog.tsx`, `RegistrarCobroFianzaDialog.tsx`, `IbanDevolucionCard.tsx`
      + hook; simplificar/retirar retención/IBAN de `RegistrarDevolucionFianzaDialog.tsx` /
      `DevolucionFianzaCard.tsx`
- [x] 6.6 Reglas duras: mobile-first (390/768/1280), Bulletproof por dominio, `components/` solo
      `.tsx`, barrels

## 7. QA: unit tests + BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 `pnpm --filter api test` verde (incl. integración/concurrencia desde sesión principal;
      react-pdf en aislamiento)
- [x] 7.2 `pnpm --filter web build` exit 0
- [x] 7.3 Verificar estado BD: `FACTURA` sin tipo `fianza`; `FianzaStatus` reducido; comprobante
      DOCUMENTO; COMUNICACION E4 (solo liquidación) y "fianza devuelta"; sin E5/E8
- [x] 7.4 Report `reports/2026-07-24-step-N+1-unit-test-and-db-verification.md`

## 8. QA: curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO, restaurar BD)
- [x] 8.1 Emitir liquidación standalone (borrador→enviada) + reenvío
- [x] 8.2 Subir comprobante de fianza (`fianza_status='cobrada'`)
- [x] 8.3 Devolver fianza (`fianza_status='devuelta'`, email en historial)
- [x] 8.4 Confirmar que el evento arranca sin fianza cobrada (guarda `evento_en_curso`)
- [x] 8.5 Restaurar BD; Report `reports/2026-07-24-step-N+2-curl-endpoint-tests.md`

## 9. QA: E2E Playwright 3 viewports (OBLIGATORIO — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 9.1 Ficha `reserva_confirmada`: señal + liquidación (debajo) + fianza (comprobante) en
      390/768/1280
- [x] 9.2 `post_evento`: botón "Devolver fianza" y banner de liquidación enviada
- [x] 9.3 Mover capturas a `reports/e2e-screenshots/`; Report
      `reports/2026-07-24-step-N+3-e2e-playwright.md`

## 10. Documentación (OBLIGATORIO — step-N+4 — docs-keeper)
- [x] 10.1 `docs/use-cases.md` (UC-21 liquidación standalone, UC-22 fianza pasiva, UC-26/27
      devolución simplificada)
- [x] 10.2 `docs/er-diagram.md` + `docs/data-model.md` (enums, campos eliminados, comprobante)
- [x] 10.3 `docs/architecture.md` si cambia algún patrón de email; consistencia cruzada

## 11. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 11.1 `code-reviewer` sobre el diff completo (guardrails: hexagonal, bloqueo atómico, contrato,
      mobile-first)
- [x] 11.2 Report `reports/2026-07-24-step-review-code-review.md` con línea `Veredicto: APTO`

## 12. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 12.1 Presentar al humano: code-review APTO + validación manual aprobados; ESPERAR OK
- [ ] 12.2 OK recibido del humano — proceder con archive/PR

## 13. Archivar + PR (OBLIGATORIO — archive; solo tras gate final y code-review APTO)
- [ ] 13.1 `openspec archive 2026-07-24-fix-liquidacion-fianza-independientes` (verificar que no se
      duplica el prefijo de fecha; una sola sección ADDED por capability)
- [ ] 13.2 Actualizar `openspec/specs/` (aplicar deltas) y abrir PR
