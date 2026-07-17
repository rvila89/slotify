# Step: Unit Tests + DB Verification — US-042 Buscar y filtrar en el histórico

**Fecha:** 2026-07-17
**Ejecutado por:** sesión principal (con acceso a Postgres real)
**Rama:** feature/us-042-buscar-en-historico

---

## Resumen

Este report consolida la verificación ejecutada desde la sesión principal (con Postgres real). El agente QA no repite estos pasos — los incluye aquí para trazabilidad completa.

---

## Backend — 35 tests en 3 suites

### Suites ejecutadas

| Suite | Tests | Estado |
|---|---|---|
| `listar-historico.use-case.spec.ts` | ~10 | PASS |
| `listar-historico-integracion.spec.ts` | ~15 | PASS |
| `listar-historico.controller.http.spec.ts` | ~10 | PASS |
| **Total** | **35** | **PASS** |

### Cobertura funcional verificada por tests de integración (Postgres real)

- Full-text search por nombre, apellidos, email, código de reserva y notas
- Aislamiento multi-tenant (resultados de un tenant no filtran en otro)
- Exclusión de reservas no cerradas del histórico
- Filtros combinados (AND): estado final + tipo de evento + rango de fechas + rango de importe
- Paginación: page/limit, totalPages, total
- Orden determinista (fecha evento DESC, código reserva DESC)

### Bug detectado y corregido — búsqueda por fragmento de email

**Síntoma:** La búsqueda `?q=@dominio` no devolvía resultados.

**Causa raíz:** El email se tokenizaba en FTS como un único token (PostgreSQL no separa por `@`, `.` ni `-` de forma predeterminada). El índice GIN generaba un solo lexema para `usuario@dominio.com`, lo que impedía la búsqueda por fragmento.

**Fix:** Se añadió `translate('@._-', '    ')` tanto en la columna `tsvector` del índice GIN como en la función de búsqueda, convirtiendo los separadores de email en espacios antes de la tokenización. Esto genera lexemas individuales por cada parte del email.

**Verificado mediante test de integración real** contra Postgres.

---

## Frontend — 264 tests verdes

| Check | Estado |
|---|---|
| `pnpm test` (apps/web) | 264 PASS, 0 FAIL |
| TypeScript (`pnpm typecheck`) | Sin errores |
| ESLint (`pnpm lint`) | Sin errores |

### Componentes de frontend cubiertos

- `HistoricoPage` — página principal con filtros y tabla
- `HistoricoFiltros` — búsqueda `q` + filtros de estado final, tipo de evento, fechas e importe
- `HistoricoTabla` — tabla de resultados (reflow a tarjetas en `<lg`, destacado del término, navegación al detalle)
- `HistoricoPaginacion` — controles de página y tamaño
- `HistoricoEstados` — tres estados vacíos diferenciados + error
- `HistoricoSkeleton` — placeholder de carga
- Hook `useHistorico` — integración con el SDK generado y gestión de estado de filtros

---

## Estado BD

No se realizaron mutaciones en la BD durante los tests. Los tests de integración usan la BD `slotify_test` (aislada, ver `.env.test`). La BD de desarrollo (`slotify`) no fue alterada.

**Pre/Post:** Sin cambios en BD de desarrollo.

---

## Resultado

**PASS** — 35 tests de backend + 264 de frontend, typecheck y lint limpios. Bug de FTS detectado y corregido con cobertura de regresión.
