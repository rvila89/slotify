# Code Review Report — US-027 Generar borradores de liquidacion y fianza

- **Change**: `us-027-generar-borradores-liquidacion-fianza`
- **Branch**: `feature/us-027-generar-borradores-liquidacion-fianza` (cambios en working tree sobre `master` 6ee8dd5)
- **Fecha**: 2026-07-04
- **Revisor**: code-reviewer (solo lectura, contra `review-checklist` + `architecture-guardrails`)

## Veredicto: APTO

Sin bloqueantes. El slice respeta los guardrails hexagonales, la idempotencia sin locks
distribuidos, la multi-tenancy/RLS, el reuso del desglose fiscal de US-022 y el anti-scope
declarado (no numeracion, no marcado de RESERVA_EXTRA, no email E4). La desviacion de D-7
(migracion `numero_factura` nullable) es correcta, segura y esta registrada.

---

## Hallazgos por punto de atencion

### 1. Hexagonal — CUMPLE
- `facturacion/domain/calculo-total-liquidacion.ts` es dominio puro: sin imports de `@nestjs/*`,
  `@prisma/*` ni `infrastructure/`. Suma en centimos enteros, sin `Float` para importes; devuelve
  Decimal string de 2 decimales.
- El use-case `generar-borradores-liquidacion-fianza.use-case.ts` (application) depende solo de
  puertos inyectados (UoW, cargas, auditoria); no importa Prisma ni framework. `@prisma/client` y
  `@nestjs/*` viven solo en `infrastructure/` y `interface/`.
- depcruise: 328 modulos sin violaciones hexagonales (report step-N+1).

### 2. Bloqueo/concurrencia — CUMPLE
- Idempotencia por `(reserva_id, tipo)`: guarda `buscarPorReservaYTipo` + creacion; ante `P2002`
  (`esColisionUnicidad`) se reintenta (bucle de 2 intentos) y se recupera la existente. Respaldo en
  BD por `UNIQUE(reserva_id, tipo)` (US-022).
- Sin Redis/Redlock/locks distribuidos (verificado en use-case, UoW adapter y lecturas).
- La generacion es POST-COMMIT: `confirmar-pago-senal.use-case.ts` invoca
  `generarBorradoresPostCommit` FUERA de la tx critica del `FOR UPDATE`, tras
  `presentarFacturaPostCommit`. Su fallo se traga en `try/catch` y NO revierte la confirmacion.
  La UoW de borradores abre su propia transaccion (atomica entre los 2 documentos + AUDIT_LOG),
  no sostiene el `FOR UPDATE` de la confirmacion.

### 3. Desviacion de design.md D-7 (migracion) — CUMPLE, desviacion justificada
- `design.md D-7` decia "no prevista"; en implementacion se detecto que `numero_factura` era
  `NOT NULL`. Migracion `20260704130000_us027_numero_factura_nullable`:
  `ALTER TABLE "factura" ALTER COLUMN "numero_factura" DROP NOT NULL;`
  - (a) Correcta y aditiva/segura: relaja una restriccion (DROP NOT NULL), operacion no destructiva;
    no borra datos ni columnas. Coincide con `schema.prisma` (`numeroFactura String?`).
  - (b) No rompe `UNIQUE(tenant_id, numero_factura)`: en PostgreSQL los NULL no colisionan entre si,
    por lo que multiples borradores sin numero conviven sin violar la unicidad. Correcto.
  - (c) Registrada: comentario en el `migration.sql`, `tasks.md 4.1` la documenta como "AJUSTE en
    implementacion", y el archivo cita "D-7 ajustado en implementacion".
- Recomendacion (no bloqueante): reflejar la desviacion en `design.md D-7` (nota breve) para que el
  diseno quede consistente con lo implementado antes del archive. Es aceptable como nota de
  implementacion; no requiere reabrir el Gate.

### 4. Multi-tenancy / RLS — CUMPLE
- `tenant_id` siempre del JWT (`@CurrentUser().tenantId`) en `FacturaController.listar`, nunca del
  path/body.
- Todos los adaptadores de lectura/escritura abren `$transaction` + `fijarTenant(tx, tenantId)`
  (SET LOCAL app.tenant_id) como primera operacion (RLS). Las queries filtran por `tenantId` y
  `reservaId`.
- `listar-facturas-reserva`: comprueba existencia de la RESERVA en el tenant y devuelve `null` ->
  404 si cross-tenant (invisible por RLS). Verificado en curl (Test 6: 404 reserva inexistente;
  Test 7: 401 sin auth).
- Controlador con `@UseGuards(RolesGuard)` + `@Roles('gestor')` + `@ApiBearerAuth`.

### 5. Reuso vs duplicacion — CUMPLE
- El desglose fiscal reutiliza `calcularDesgloseFacturaSenal` de US-022 (mismo `{ total }`, IVA por
  resta, redondeo half-up); no se duplica logica fiscal.
- El agregado FACTURA no se redefine: se generaliza el DTO (`FacturaDto` canonico; `FacturaSenalDto`
  queda como alias `allOf`), consistente con el contrato congelado.

### 6. Arrow functions / mobile-first / estructura Bulletproof React — CUMPLE
- Backend y frontend usan arrow functions para funciones nombradas; metodos de clase NestJS exentos.
- Frontend: feature `facturacion` con barrel `index.ts` como unica API publica; `FichaConsultaPage`
  importa por `@/features/facturacion`. Segmentos `api/components/lib/model`.
- Mobile-first: `DocumentosLiquidacionFianza` usa `grid-cols-1 ... lg:grid-cols-2`;
  `FacturaBorradorCard` `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`; sin anchos px fijos. Evidencia
  en 3 viewports (390/768/1280) sin overflow horizontal en el report E2E step-N+3.

### 7. Cliente generado NO editado a mano — CUMPLE
- `apps/web/src/api-client/schema.d.ts` refleja EXACTAMENTE el contrato de `docs/api-spec.yml`
  (regenerado: `get: operations["listarFacturasReserva"]`, `FacturaDto`, alias `FacturaSenalDto`).
  El hook `useFacturasReserva` consume `apiClient.GET('/reservas/{id}/facturas')` del SDK generado.
- DTOs (`factura.dto.ts`) coinciden con el contrato: `FacturaDto` con `required` alineado;
  `fechaCreacion` opcional en DTO y NO en `required` del schema (consistente).

### 8. Scope (anti-scope US-028) — CUMPLE
- `numero_factura = NULL` en toda creacion de borrador; no se asigna `F-YYYY-NNNN`.
- NO se marca RESERVA_EXTRA con `factura_id` (los extras se leen con `factura_id IS NULL` y solo se
  suman; test 3.8 lo cubre).
- NO se envia email E4; la alerta es una senal de UI derivada de la coleccion en el frontend
  (`derivarAlertaDocumentos`), sin endpoint ni notificacion nueva.
- Edge case `fianza_default_eur = 0`: no se crea la fianza, `fianza_status` permanece `pendiente`,
  alerta solo de liquidacion (test 3.5).

---

## Bloqueantes
- Ninguno.

## No bloqueantes
- [D-7/doc] La desviacion de la migracion `numero_factura` nullable no esta reflejada en
  `design.md D-7` (sigue diciendo "no prevista"). Esta registrada en `tasks.md 4.1` y en el
  `migration.sql`, pero conviene una nota en el design para consistencia antes del archive.
- [flags derivados en coleccion] En `aFacturaDto` (controlador), `esBorradorInvalido` se fija a
  `false` para todos los items de la coleccion, incluida la factura de `senal`. Para la senal, el
  calculo real de "borrador invalido por datos fiscales" solo se obtiene via su endpoint dedicado
  (`GET /reservas/{id}/factura-senal`). No afecta a US-027 (liquidacion/fianza no derivan ese flag),
  pero la UI no debe confiar en `esBorradorInvalido` de la senal cuando la lee por la coleccion.

## Sugerencias
- `pdfPendiente: f.pdfUrl === null && f.estado !== 'borrador'` en la coleccion: correcto para
  borradores (siempre `false`); conviene un test de contrato que fije esta semantica de cara a US-028.
- Confirmar en docs (step-N+4) que `er-diagram.md 3.12` refleja `numero_factura` nullable, coherente
  con la migracion de este change.

## Verificacion de calidad (de reports)
- Suite backend: 122 suites / 1052 tests en verde; depcruise sin violaciones (step-N+1).
- Curl: borradores generados post-confirmacion, 404/401/422 correctamente formateados (step-N+2).
- E2E Playwright: alerta y visualizacion de ambos borradores; responsive 3 viewports sin overflow
  (step-N+3).
