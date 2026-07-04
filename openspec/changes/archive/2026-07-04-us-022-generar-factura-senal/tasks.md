# Tasks — us-022-generar-factura-senal

> Fuente de verdad de los pasos obligatorios: `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E); **nunca** las delega en el usuario. Cada tarea se marca `[x]`
> solo tras ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear branch `feature/us-022-generar-factura-senal` desde `master`
- [x] 0.2 Verificar la branch actual (`git branch --show-current`) — ya creada y activa

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`facturacion` NUEVA +
      `confirmacion` MODIFICADA) + `design.md` y **ESPERAR su OK explícito** antes de
      contrato/TDD/implementación. No avanzar por defecto ni aunque se diga "continúa".

## 2. Contrato OpenAPI (tras el gate SDD)

- [ ] 2.1 `contract-engineer`: definir en `docs/api-spec.yml` `GET /reservas/{id}/factura-senal`,
      `POST /facturas/{id}/aprobar`, `POST /facturas/{id}/rechazar` (body `motivo`) y
      `POST /facturas/{id}/regenerar-pdf`, con respuestas y errores de `design.md §D-6`
- [ ] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`) y regenerar el SDK del
      frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [ ] 3.1 Desglose fiscal (dominio puro): `base_imponible = round(total / 1,21, 2)`,
      `iva_importe = total − base`, `iva_porcentaje = 21,00`, `base + iva = total` exacto
      (1.200 → 991,74 / 208,26 y otros importes) — `facturacion/domain/__tests__/desglose-fiscal.spec.ts`
- [ ] 3.2 Numeración `F-YYYY-NNNN`: primera del tenant/año = `F-YYYY-0001`, secuencia
      incremental por tenant+año, independencia entre tenants distintos
      — `facturacion/__tests__/numerar-factura.spec.ts`
- [ ] 3.3 Concurrencia (zona crítica, skill `concurrency-locking`): N facturas de señal
      concurrentes de reservas distintas del mismo tenant → todas con `numero_factura` único
      y consecutivo, colisión `P2002` resuelta con reintento, ninguna sin número (tests con
      transacciones reales, en rojo) — `facturacion/__tests__/generar-factura-senal-concurrencia.spec.ts`
- [ ] 3.4 Idempotencia: ya existe FACTURA `tipo='senal'` para la reserva → no duplica,
      devuelve la existente, registra intento en `AUDIT_LOG`
      — `facturacion/__tests__/generar-factura-senal.use-case.spec.ts`
- [ ] 3.5 Generación de la factura: `tipo='senal'`, `estado='borrador'`, `total =
      RESERVA.importe_senal`, `reserva_id`/`tenant_id` correctos, `AUDIT_LOG` `accion='crear'`
      — `…use-case.spec.ts` + `generar-factura-senal-integracion.spec.ts` (BD)
- [ ] 3.6 PDF (reuso del mecanismo US-014): puerto `GenerarPdfFacturaPort` + adaptador fake;
      datos emisor (TENANT) + receptor (CLIENTE); `pdf_url` guardada post-commit idempotente
      — `…use-case.spec.ts` + `…-integracion.spec.ts`
- [ ] 3.7 Borrador inválido: `CLIENTE.dni_nif`/dirección fiscal nulos → borrador inválido,
      `pdf_url=null`, aprobación bloqueada — `…use-case.spec.ts`
- [ ] 3.8 Error de PDF: fallo transitorio → `borrador` con `pdf_url=null`, reintento
      automático, aprobación bloqueada — `…use-case.spec.ts`
- [ ] 3.9 Aprobar: borrador válido con PDF → `enviada` + `fecha_emision`, `AUDIT_LOG`
      `accion='actualizar'`; borrador inválido/sin PDF → rechazo de la aprobación
      — `facturacion/__tests__/aprobar-factura.use-case.spec.ts`
- [ ] 3.10 Rechazar: permanece en `borrador`, motivo en `AUDIT_LOG`, E3 bloqueado
      — `facturacion/__tests__/rechazar-factura.use-case.spec.ts`
- [ ] 3.11 Disparo desde `confirmacion`: tras el commit se genera la factura; su fallo NO
      revierte la confirmación (RESERVA sigue en `reserva_confirmada`)
      — `confirmacion/__tests__/*` (extensión del post-commit)
- [ ] 3.12 Confirmar que TODA la batería anterior está en ROJO antes de implementar
      (por AUSENCIA DE IMPLEMENTACIÓN), 0 tests verdes

## 4. Backend: implementar + revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [ ] 4.1 Migración Prisma aditiva: sustituir `numeroFactura @unique` global por
      `@@unique([tenantId, numeroFactura])` y añadir `@@unique([reservaId, tipo])`
      (`design.md §D-7`); aplicar y verificar en `slotify` y `slotify_test`
- [ ] 4.2 `backend-developer`: dominio puro del desglose fiscal (`facturacion/domain`),
      servicio de numeración `F-YYYY-NNNN` con reintento ante `P2002`,
      `GenerarFacturaSenalUseCase` (creación borrador + numeración + AUDIT_LOG crear),
      puerto `GenerarPdfFacturaPort` + adaptador fake (reuso del mecanismo US-014),
      generación de PDF post-commit idempotente con reintento, `AprobarFacturaUseCase`,
      `RechazarFacturaUseCase`, `RegenerarPdfFacturaUseCase`, en `apps/api/src/facturacion/**`
- [ ] 4.3 Integrar el disparo post-commit en `confirmacion` (invocar
      `GenerarFacturaSenalUseCase` tras el commit; su fallo no revierte la confirmación)
- [ ] 4.4 `frontend-developer`: feature `facturacion` en `apps/web/src/features/facturacion/**`
      (visualización del borrador: número, desglose, total, enlace PDF; acciones Aprobar
      —deshabilitada si inválido/sin PDF— y Rechazar con motivo; avisos "Datos fiscales
      incompletos"/"PDF pendiente"), cableada en la ficha de reserva; mobile-first (390/768/1280)
- [ ] 4.5 Revisar/actualizar tests unitarios existentes afectados; poner en verde los de §3;
      `pnpm test`, `pnpm lint` y `depcruise` (hexagonal) sin regresiones

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [ ] 5.1 Capturar baseline de BD (FACTURA, RESERVA, AUDIT_LOG) en `slotify_test`
- [ ] 5.2 Ejecutar tests dirigidos de los módulos cambiados (facturacion + confirmacion)
- [ ] 5.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky
- [ ] 5.4 Verificar estado posterior de BD y restaurar si hace falta
- [ ] 5.5 Crear report `openspec/changes/us-022-generar-factura-senal/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Levantar el backend y verificar conexión a BD
- [ ] 6.2 `GET /reservas/{id}/factura-senal` sobre una reserva `reserva_confirmada`: verificar
      el borrador (número `F-YYYY-NNNN`, `tipo='senal'`, `estado='borrador'`, desglose, total,
      `pdf_url`). **Restaurar BD**
- [ ] 6.3 `POST /facturas/{id}/aprobar` (borrador válido con PDF): verificar `enviada` +
      `fecha_emision` + `AUDIT_LOG actualizar`. **Restaurar BD**
- [ ] 6.4 `POST /facturas/{id}/rechazar` (con motivo): verificar que permanece en `borrador`,
      motivo en `AUDIT_LOG`, E3 bloqueado. **Restaurar BD**
- [ ] 6.5 `POST /facturas/{id}/regenerar-pdf`: verificar reintento idempotente de `pdf_url`.
      **Restaurar BD**
- [ ] 6.6 Casos de error: aprobar borrador inválido / sin PDF (`409`/`422`), factura/reserva
      inexistente (`404`), sin auth (`401`); verificar que el formato de error coincide con el
      contrato OpenAPI
- [ ] 6.7 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`
- [ ] 6.8 Marcar completado solo tras pasar todos los curl y restaurar la BD

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — step-N+3 — hay frontend — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar frontend y backend con BD en estado conocido
- [ ] 7.2 `browser_navigate` a la ficha de una reserva `reserva_confirmada`; snapshot inicial
- [ ] 7.3 Flujo completo: visualizar el borrador de la factura de señal, aprobarla y verificar
      estado `enviada`; verificar el enlace al PDF
- [ ] 7.4 Casos de error/validación en la UI (aprobar deshabilitado si inválido/sin PDF,
      rechazo con motivo, avisos de datos fiscales/PDF pendiente) en 3 viewports (390/768/1280)
- [ ] 7.5 Verificar persistencia (UI ↔ BD) y restaurar entorno/BD
- [ ] 7.6 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [ ] 8.1 `docs-keeper`: reflejar los endpoints y el flujo en la doc técnica; verificar
      alineación US-022 ↔ OpenAPI ↔ `er-diagram.md` (§3.12 FACTURA: nueva unicidad
      `(tenant_id, numero_factura)` + `(reserva_id, tipo)`, flujo de creación de la señal) ↔
      UC-18

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [ ] 9.1 `code-reviewer` sobre el diff contra guardrails (hexagonal, dominio puro del
      desglose, concurrencia sin locks distribuidos, multi-tenancy/RLS, mobile-first)
- [ ] 9.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación y repetir)

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [ ] 10.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 11.1 `openspec archive us-022-generar-factura-senal` (crea `openspec/specs/facturacion/`
      y aplica el delta a `openspec/specs/confirmacion/`)
- [ ] 11.2 Abrir PR (GitHub MCP o `gh`) — solo tras el gate final y con code-review APTO
      (el hook `require-code-review` lo bloquea si falta el informe APTO)
- [ ] 11.3 Registrar la URL del PR en el frontmatter de `user-stories/US-022-generar-factura-senal.md`
