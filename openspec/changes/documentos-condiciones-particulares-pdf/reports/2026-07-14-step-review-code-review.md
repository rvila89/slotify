# Code Review — 6.4a `documentos-condiciones-particulares-pdf`

- **Fecha**: 2026-07-14
- **Revisor**: code-reviewer (solo lectura)
- **Rama**: `feature/documentos-condiciones-particulares-pdf` vs `master`
- **Alcance**: Bloques A (PDF de "Condicions particulars") y B (adjunto al E2).
  El envío E3 es 6.4b, fuera de alcance.
- **Método**: diff del árbol de trabajo (`git diff master` + ficheros sin seguimiento),
  lectura de dominio/infra/presentación/tests, comprobación de guardrails y hooks.
- **Re-revisión (2026-07-14)**: verificado el fix del hallazgo M1 (delta del
  `disparar-e2.adapter.ts` + nuevo test 2.7e). M1 queda RESUELTO.

## Resumen del veredicto

Cambio limpio, hexagonal y bien testeado. Espejo fiel de 6.1b/6.3. No se detecta
ningún hallazgo Bloqueante ni Alto. El único hallazgo Medio (M1) fue CORREGIDO tras
la revisión inicial y verificado en esta re-revisión; quedan dos observaciones Bajas
no bloqueantes. **Apto para merge.**

## Checklist de guardrails

| Guardrail | Resultado |
|-----------|-----------|
| Hexagonal: `domain/` sin `@nestjs`/`@prisma`/infra/react-pdf | OK — puerto y VO puros (solo menciones en comentarios) |
| Puerto en dominio, adapters en infra, render no contamina dominio | OK |
| Multi-tenant: clave de almacén aísla por tenant `condiciones/{tenantId}.pdf` | OK |
| RLS no recreada en la migración (ya activa desde 6.1a) | OK — migración solo `ADD COLUMN` |
| Degradación D3 a `null` (sin config O sin secciones), E2 omite adjunto | OK |
| Arrow functions, sin `function` declarativo (salvo métodos de clase NestJS) | OK |
| `componentes/` SOLO `.tsx` (helpers/modelos/render fuera) | OK — 3 `.tsx` nuevos, sin `.ts` |
| Reutiliza Cabecera/estilos/kit de 6.1b sin duplicar | OK |
| react-pdf ESM vía `import()` nativo, no `require` | OK — patrón `Function('m','return import(m)')` |
| Migración no destructiva y coherente con schema | OK — `JSONB NOT NULL DEFAULT '{}'` = `Json @default("{}")` |
| TS strict sin `any` injustificado, `Decimal` no `Float` | OK — no hay importes en este slice; cast JSON tipado |
| Tests: VO, seed 14 secciones, mapeo Prisma, render, adapter, E2 | OK — cobertura completa |
| Sin debilitar tests existentes | OK — solo se completan fixtures con `condiciones` |
| Contrato: sin cambio de `api-spec.yml` ni SDK | OK — E2 es interno post-commit |

## Hallazgos por severidad

### Bloqueante
Ninguno.

### Alta
Ninguna.

### Media

- **[M1] RESUELTO — El adjunto de condiciones ya no puede propagar una excepción
  tras el commit; se traga y omite el adjunto.**
  - Estado: CORREGIDO y verificado en la re-revisión de 2026-07-14.
  - Hallazgo original: la generación del PDF del **presupuesto** estaba envuelta en
    `try/catch` (`generarPdfPostCommit`), pero el disparo del E2 no. Una excepción REAL
    de render react-pdf o de subida al almacén (modo de fallo de la flakiness ESM ya
    documentada en QA) se habría propagado fuera del caso de uso **después** del commit,
    devolviendo 500 pese a que la `pre_reserva` ya estaba comprometida.
  - Fix aplicado: en `apps/api/src/presupuestos/infrastructure/disparar-e2.adapter.ts`
    la llamada `this.generarCondiciones.generar({ tenantId }).catch(() => null)` traga
    cualquier excepción real (no solo el `null` de negocio), de modo que el adjunto de
    condiciones se omite sin propagar ni tumbar la `pre_reserva` post-commit — mismo
    criterio que `generarPdfPostCommit` del use-case.
  - Cobertura: nuevo test `disparar-e2.adapter.spec.ts` 2.7e
    (`debe_despachar_solo_el_presupuesto_cuando_generar_condiciones_lanza`) + helper
    `condicionesQueLanza`: cuando la generación LANZA, `disparar` resuelve
    (`resolves.toBeUndefined()`, no propaga) y el E2 se despacha con solo el adjunto
    `presupuesto`. Verificado por el coordinador: `disparar-e2.adapter` 6/6 en verde,
    eslint limpio.
  - Verificación del revisor: delta y test leídos; el `.catch(() => null)` cubre el
    camino de excepción además del `null` de negocio ya cubierto por 2.7b/2.7c. Cerrado.

### Baja

- **[B1] Clave `key` de React en `ListaSeccionesCondiciones` usa `indice`.**
  - Ubicación: `apps/api/src/documentos/presentation/componentes/ListaSeccionesCondiciones.tsx:25`
    (`key={`${indice}-${seccion.titulo}`}`).
  - Es render server-side de react-pdf (sin reconciliación interactiva) y la clave
    combina índice + título, por lo que es inocuo. Se anota solo por convención.

- **[B2] `aCondiciones` está duplicada en dos adapters.**
  - Ubicación: `configuracion-documento.prisma.adapter.ts` (método privado) y
    `facturacion/.../cargar-datos-documento-factura.prisma.adapter.ts` (helper).
  - Misma lógica de mapeo tolerante del JSON. Aceptable por ahora (viven en módulos
    distintos y el VO es la frontera compartida); candidata a extraer a un mapper común
    si crece. No bloqueante.

## Notas de QA tenidas en cuenta (no re-verificadas)

- Migración aplicada + reseed OK (14 secciones en BD); PDF real inspeccionado
  (cabecera + 14 secciones + firma en blanco); suites 6.4a en verde (30 tests).
- Los 18 rojos de la suite global son flakiness ESM PRE-EXISTENTE del render
  react-pdf (reproducida sin condiciones), no regresión de 6.4a.
- Bug de seed (`condiciones` no persistía) ya corregido en QA.
- Fix de M1 (`.catch(() => null)` + test 2.7e) aplicado por el coordinador tras la
  revisión inicial y verificado en esta re-revisión.

## Trazabilidad de guardrails clave

- Dominio puro: `documentos/domain/generar-pdf-condiciones.port.ts`,
  `documentos/domain/configuracion-documento.ts` — sin imports de framework/infra.
- Aislamiento por tenant: `pdf-condiciones.real.adapter.ts:31`
  (`clavePdf = (tenantId) => `condiciones/${tenantId}.pdf``), verificado por test 2.5d.
- Degradación D3: `pdf-condiciones.real.adapter.ts:43-50`, tests 2.5a/2.5b.
- E2 dos adjuntos / omisión: `disparar-e2.adapter.ts:48-63`, tests 2.7a-2.7d.
- ESM nativo: `documento-condiciones.render.ts:29-30`.
- Migración no destructiva: `migrations/20260714130000_.../migration.sql`
  (`ADD COLUMN ... JSONB NOT NULL DEFAULT '{}'`).

Veredicto: APTO
