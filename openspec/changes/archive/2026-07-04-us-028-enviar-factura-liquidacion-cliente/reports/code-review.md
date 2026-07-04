# Informe de revisión de código — US-028 "Gestor aprueba y envía la factura de liquidación"

**Change:** `openspec/changes/us-028-enviar-factura-liquidacion-cliente/`
**Rama:** `feature/us-028-enviar-factura-liquidacion-cliente`
**Fecha:** 2026-07-04

## Resultado por guardrail

| # | Guardrail | Estado |
|---|-----------|--------|
| 1 | Hexagonal (`domain/`/`application/` sin infra ni `@nestjs`/`@prisma`) | OK |
| 2 | Bloqueo atómico / sin Redis-Redlock | OK (numeración por `UNIQUE`+`P2002`) |
| 3 | Multi-tenancy (tenant del JWT, RLS) | OK |
| 4 | Arrow functions (sin `function` declarativo) | OK |
| 5 | Contrato: cliente HTTP generado, no editado a mano | OK |
| 6 | TDD (tests hermanos, atomicidad/concurrencia) | OK — 67/67 pasan |
| 7 | Responsive mobile-first | OK |
| 8 | Estructura por dominio | OK |

## Hallazgos

### Bloqueantes
- Ninguno.

### Medias
- **[M-1] Servicio E4 duplicado eliminado.** `EnviarE4LiquidacionFianzaService` fue identificado como código muerto (no cableado en producción) y eliminado antes del PR junto con su spec. La ruta de producción usa `EnviarE4EmisionAdapter` correctamente. Deuda pendiente: añadir guardia de PDF vacío en el use-case (documentada en `tasks.md`).

### Bajas
- **[B-1]** Barrel del feature no exporta todos los hooks de US-028 (consumo interno, no violación).
- **[B-2]** `FacturaSenalCard.tsx` > 300 líneas — deuda pre-existente de US-022, fuera del scope.
- **[B-3]** LF→CRLF en `schema.d.ts` y `pnpm-lock.yaml` — cosmético, entorno Windows.

## Evidencia verificada

- Hexagonal: use-cases y dominio solo importan de `../domain/*`; sin `@nestjs`/`@prisma` en capas puras.
- Multi-tenancy: `tenantId`/`usuarioId` siempre desde `@CurrentUser()` (JWT); RLS activo en adaptadores.
- Numeración: `UNIQUE(tenant_id, numero_factura)` + reintento ante `P2002`; sin locks distribuidos.
- Atomicidad D-1: envío E4 dentro de la tx → rollback total ante fallo. Verificado por 5 tests de atomicidad.
- Migración D-4: relaja índice UNIQUE parcial de COMUNICACION con `es_reenvio` (no destructiva).
- Contrato: 3 endpoints en `api-spec.yml`, DTOs alineados, `schema.d.ts` con cabecera "auto-generated".
- TDD: 6 specs de US-028, 67/67 pasan (incluye concurrencia en `slotify_test`).
- Responsive: sin anchos px fijos; mobile-first verificado en 390/768/1280 por QA v3.

## Veredicto: APTO
