# Step N+1 — Unit tests y verificación de BD

- Fecha: 15/07/2026
- Change: `condiciones-particulares-e3-us023`
- Agente: `qa-verifier`

---

## Nota de entorno

Los subagentes QA corren en sandbox sin acceso a Postgres (ver MEMORY: "Subagentes sin
Docker/Postgres"). Los tests que requieren BD real (`*-integracion.spec.ts`) y la suite global
fueron ejecutados por la **sesión principal** (que sí tiene `slotify-postgres` en 5432 vía Docker).
Los resultados que siguen reflejan fielmente lo reportado por esa sesión; no han sido
re-ejecutados en este subagente.

---

## Comandos ejecutados (sesión principal)

Tests dirigidos de módulo (BD real, `slotify_test`):

```bash
# Tests de integración con BD real
cd apps/api
pnpm jest --testPathPattern="enviar-factura-senal-integracion" --runInBand
pnpm jest --testPathPattern="reenviar-e3-integracion" --runInBand

# Tests unitarios dirigidos (sin BD)
pnpm jest --testPathPattern="enviar-factura-senal.use-case" --runInBand
pnpm jest --testPathPattern="reenviar-e3.use-case" --runInBand

# Suite amplia de frontend
cd apps/web
pnpm test

# Lint y typecheck ambas apps
cd apps/api && pnpm lint && pnpm typecheck
cd apps/web && pnpm lint && pnpm typecheck
```

---

## Resultados de unit tests

### Tests dirigidos — integración con BD real (sesión principal, `slotify_test`)

#### `enviar-factura-senal-integracion.spec.ts`
- **5/5 verde**
- Escenarios cubiertos:
  - Happy path: primer envío persiste `DOCUMENTO condiciones_particulares` (url, mime, reserva_id,
    tenant_id) + `AUDIT_LOG accion='crear'` dentro de la tx atómica.
  - Idempotencia: segundo envío reutiliza el `DOCUMENTO` existente (no crea segunda fila, no
    segundo `AUDIT_LOG crear`).
  - Rollback de tx: si E3 falla, no queda `DOCUMENTO` huérfano (rollback total confirmado).
  - RLS cross-tenant: DOCUMENTO de otro tenant no visible; no se duplica entre tenants.
  - GAP 2 endurecido: `GenerarPdfCondicionesPort` retorna `null` → aborta con
    `CondicionesNoConfiguradasError` (409), rollback total — factura permanece `borrador`,
    `cond_part_enviadas_fecha` NULL, sin E3, sin DOCUMENTO.

#### `reenviar-e3-integracion.spec.ts` (NUEVO — parte de este change)
- **6/6 verde**
- Escenarios cubiertos:
  - Happy path: nueva `COMUNICACION` E3 con `es_reenvio=true`, factura NO re-emitida, DOCUMENTO
    condiciones no duplicado (reutilizado), `cond_part_enviadas_fecha` actualizada al nuevo
    timestamp, sin transición de estado de reserva.
  - Rollback total: fallo del proveedor de email → sin COMUNICACION de reenvío, sin actualización
    de `cond_part_enviadas_fecha`.
  - RLS × 2 (cross-tenant × 2 escenarios): reserva de otro tenant retorna 404
    (`FACTURA_SENAL_NO_ENCONTRADA`).
  - Guarda de negocio × 2: sin E3 previo (`es_reenvio=false`) → 409
    `E3_NO_ENVIADO_PREVIAMENTE`; reserva inexistente → 404.

### Tests unitarios (mocks, sin BD)

#### `enviar-factura-senal.use-case.spec.ts` + `reenviar-e3.use-case.spec.ts`
- **49/49 verde** (combinados; sesión principal)
- `reenviar-e3.use-case.spec.ts` — **12/12 verde** en aislamiento:
  - Happy path reenvío (nueva COMUNICACION `es_reenvio=true`, reutiliza documentos, actualiza fecha)
  - Rollback proveedor email
  - Guarda `E3_NO_ENVIADO_PREVIAMENTE` (sin COMUNICACION previa `es_reenvio=false`)
  - Guarda `FACTURA_SENAL_NO_ENCONTRADA` (RLS/cross-tenant)
  - Sin mutación de FACTURA ni transición de reserva
  - Segundo reenvío no colisiona con índice UNIQUE parcial
  - Resto de variantes de guardas y errores recuperables

### Suite frontend

- **187/187 verde** (`apps/web`, sesión principal)

### Lint y typecheck

- `apps/api pnpm lint`: verde
- `apps/api pnpm typecheck`: verde
- `apps/web pnpm lint`: verde
- `apps/web pnpm typecheck`: verde

### Nota conocida — flakiness ESM react-pdf (pre-existente, ajena a este change)

La flakiness ESM de `react-pdf` hace caer suites de render cuando se ejecutan juntas con
`--runInBand` global (ver MEMORY: "react-pdf ESM suite flakiness"). Las suites afectadas pasan en
aislamiento. Este comportamiento es pre-existente y no fue introducido por este change; no se trata
como regresión de `condiciones-particulares-e3-us023`.

---

## Verificación de estado de BD

Los tests de integración usan la BD de test `slotify_test` (configurada vía `.env.test`), que es
completamente independiente de `slotify_dev` (la BD de desarrollo).

### Entidades verificadas en BD (`slotify_test`)

| Entidad | Campo / condición verificada |
|---------|------------------------------|
| `DOCUMENTO` | Un único `tipo='condiciones_particulares'` por reserva (idempotencia confirmada); `reserva_id`, `tenant_id`, `url`, `mime_type='application/pdf'` correctos |
| `COMUNICACION` | E3 de reenvío con `es_reenvio=true`; original `es_reenvio=false` intacto; UNIQUE parcial respetado |
| `RESERVA` | `cond_part_enviadas_fecha` actualizada en envío y reenvío; permanece NULL si condiciones no configuradas (GAP 2) |
| `AUDIT_LOG` | `accion='crear'` para DOCUMENTO solo en primer envío (no duplicado en reenvíos) |

### Baseline previo

- `slotify_test`: vacía o con seed mínimo de setup; limpiada en `afterAll` de cada suite de
  integración.
- `slotify_dev`: solo operaciones de lectura durante las pruebas (nunca mutada por los tests).

### Validación posterior

- `slotify_test`: limpiada por `afterAll` (teardown confirma 0 registros de test residuales).
- `slotify_dev`: intacta — no hubo mutaciones durante la ejecución de los tests.

### Estado restaurado

**Sí.** `slotify_test` se limpia automáticamente en teardown de cada suite de integración.
`slotify_dev` nunca fue mutada.

### Acciones de restauración

Ninguna manual necesaria: el teardown automático de los tests de integración gestiona la limpieza
de `slotify_test`.

---

## Resultado

- **Estado de step-N+1: PASS**
- **Bloqueantes: ninguno**
- Tests de integración con BD real ejecutados por la sesión principal (sandbox de subagentes sin
  Postgres); totales: 5/5 + 6/6 integracion, 12/12 unit (reenviar-e3), 49/49 unit combinados,
  187/187 frontend.
- Flakiness ESM react-pdf documentada como pre-existente y ajena a este change.
