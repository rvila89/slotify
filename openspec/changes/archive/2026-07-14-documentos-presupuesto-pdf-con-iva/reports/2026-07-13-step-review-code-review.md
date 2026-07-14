# Code review — 6.1b `documentos-presupuesto-pdf-con-iva`

- **Fecha:** 2026-07-13
- **Rama:** `feature/documentos-presupuesto-pdf-con-iva` (cambios en árbol de trabajo sobre `master` 7c895ca)
- **Alcance:** PDF real del presupuesto CON IVA con `@react-pdf/renderer`; numeración `AAAANNN`; migración `tenant_id`+`numero_presupuesto`; toolchain ESM. Sin cambios de API ni frontend.
- **Naturaleza:** informe de solo lectura. No se aplicaron fixes.

## Toolchain ejecutado (con `NODE_OPTIONS=--experimental-vm-modules`)

| Comando | Resultado |
|---------|-----------|
| `pnpm run arch` (depcruise) | OK — no dependency violations (530 módulos, 1897 deps) |
| `pnpm run lint` (eslint `{ts,tsx}`) | OK — sin hallazgos |
| `pnpm typecheck` (`tsc --noEmit`) | OK |
| Tests `documentos/presentation` + `presupuestos/domain` + `pdf-presupuesto.real.adapter` + `generar-presupuesto` + `activar-prereserva` | OK — 7 suites, 83/83 verde |

## Hallazgos por severidad

### Bloqueante
- Ninguno.

### Alta
- Ninguno.

### Media
- **[RESUELTO — re-review 2026-07-13] [numeración / P2002 no discriminado]** `apps/api/src/presupuestos/application/generar-presupuesto.use-case.ts:213` (`esColisionUnicidad`) reintenta ante **cualquier** `P2002`, sin mirar `meta.target`. La tx de confirmación puede emitir dos P2002 distintos: el de la numeración `UNIQUE(tenant_id, numero_presupuesto)` (reintentable) y el de la carrera D4 sobre la fecha `UNIQUE(tenant_id, fecha)` que lanza `activar-prereserva-uow.prisma.adapter.ts:184`. Consecuencias:
  1. Una colisión D4 real (fecha ocupada por otra reserva) ahora **re-ejecuta la tx completa hasta 10 veces** antes de propagar (trabajo desperdiciado; antes fallaba al primer intento).
  2. Si la numeración colisionara en los 10 intentos (concurrencia extrema), el `ultimoError` propagado es el P2002 de numeración, que el controller (`generar-presupuesto.controller.ts:226` `esColisionUnique`, también sin discriminar target) mapea a **409 `FECHA_NO_DISPONIBLE` / "Fecha no disponible"** — mensaje engañoso para un conflicto de numeración.
  Recomendación: discriminar por `meta.target` — reintentar solo cuando el target sea `numero_presupuesto`; dejar que el P2002 de `fecha` (D4) propague de inmediato (comportamiento previo). Idealmente aplicar la misma discriminación en el controller.

- **[RESUELTO — re-review 2026-07-13] [cobertura de tests / retry de numeración]** No existe test para el nuevo bucle de reintento ante P2002 de numeración ni para la garantía de que un P2002 de fecha (D4) siga surgiendo como 409 tras introducir el bucle. `generar-presupuesto.use-case.spec.ts` mockea `ultimoNumeroDelAnio` siempre a `null` y no ejercita colisión de numeración. La lógica crítica nueva (retry en tx) queda sin RED/GREEN propio. Recomendación: añadir test que (a) simule `crear` lanzando P2002 de `numero_presupuesto` una vez y verifique reintento con número recalculado, y (b) verifique que un P2002 de `fecha` no se reintenta y propaga.

### Baja
- **[tamaño de fichero]** `generar-presupuesto.use-case.ts` = 801 líneas. `max-lines` no se aplica en el ESLint de `apps/api` (es regla dura solo de `apps/web`), por lo que **no es violación**; se anota como deuda de mantenibilidad: el fichero creció con el bucle de reintento y ya concentra mucha orquestación.
- **[ordenación string vs numérica]** `cargar-datos-...prisma.adapter.ts:39` y `activar-prereserva-uow...:423` obtienen el último número con `orderBy: { numeroPresupuesto: 'desc' }` (orden lexicográfico). Con padding mínimo de 3, por encima de 999/año (`2026999` vs `20261000`) el orden lexicográfico deja de coincidir con el numérico. Fuera del MVP (>999 presupuestos/tenant/año), pero es una asunción implícita a documentar.

## Verificación de guardrails duros

- **Hexagonal / DDD (OK).** `documentos/presentation/**` NO importa de `presupuestos` (verificado por grep y por depcruise); los tipos de desglose/reparto están duplicados intencionadamente en `modelo-documento-presupuesto.ts`. `numeracion-presupuesto.ts` es dominio puro: sin `@nestjs/*`, `@prisma/*`, `react-pdf` ni `infrastructure/`. Los `.tsx` NO importan react-pdf estáticamente: reciben el `kit` inyectado; solo `documento-presupuesto.render.ts` cruza a react-pdf vía `import()` nativo. `.dependency-cruiser.cjs` solo añadió la extensión `.tsx` a `resolveOptions.extensions`; NO relajó ninguna regla de dominio.
- **Multi-tenancy / RLS (OK).** La migración `20260713150000_presupuesto_numero_tenant/migration.sql` añade `tenant_id`+`numero_presupuesto`+backfill+FK+UNIQUE y **NO** contiene `CREATE POLICY` ni `ENABLE ROW LEVEL SECURITY` sobre `presupuesto` (verificado); mantiene la policy `tenant_isolation` por subconsulta a `reserva` del init. El adaptador de lectura `cargar-datos-documento-presupuesto.prisma.adapter.ts` fija `app.tenant_id` en la tx (`fijarTenant`) y filtra por `tenantId` en presupuesto/reserva/settings; degrada a `null` en cross-tenant/no encontrado. La clave de subida `presupuestos/{tenantId}/{idPresupuesto}.pdf` aísla por tenant.
- **Numeración (OK).** `siguienteNumeroPresupuesto` produce `AAAANNN` con reinicio anual (año embebido; sin previo → `AAAA001`), asignada DENTRO de la tx de confirmación (N1), no post-commit. Sin gaps silenciosos (unicidad garantizada por `@@unique`). (Robustez del retry: ver Media.)
- **Adaptador real (OK).** Degrada a `null` si config o datos son `null` (no rompe la pre_reserva ya comprometida). Fake retirado del wiring de producción (`presupuestos.module.ts` cablea `PdfPresupuestoRealAdapter` en `GENERAR_PDF_PRESUPUESTO_PORT`); el fake permanece solo como fichero para tests.
- **Toolchain ESM (OK, razonable).** react-pdf se carga con `import()` nativo vía `Function('m','return import(m)')` para evitar que TS lo transpile a `require`; el árbol permanece CommonJS y solo react-pdf cruza la frontera ESM. `--experimental-vm-modules` se inyecta vía `cross-env` **solo** en `test`/`test:e2e`. El script de arranque de producción `start: node dist/main.js` NO necesita flags (import dinámico nativo). No se detecta script de arranque de producción que requiera el flag y lo omita. Enfoque sin deuda peligrosa.
- **Convenciones (OK).** Arrow functions en todo el código nuevo (componentes React como expresiones flecha; métodos de clase Nest exentos). Sin lock distribuido / Redis. Sin `any` ni `Float` en la capa nueva; importes como `Decimal`/string de 2 decimales (`aImporte`/`aDecimal2`); el uso transitorio de `number` en `calcularReparto` es patrón preexistente, no introducido aquí. Errores/comentarios en español. Sin secretos en el diff.
- **Contrato / frontend (OK).** Sin cambios en `apps/web`, ni en `api-spec.yml`/SDK/cliente generado (verificado). `numero_presupuesto` no se expone por API en 6.1b. Docs (`architecture.md`, `er-diagram.md`) coherentes con el código.
- **Responsive (N/A).** Rebanada backend; sin UI.

## Re-review focalizada del fix — 2026-07-13 (DELTA sobre 6.1b, ya APTA)

Alcance: SOLO el delta que cierra las dos Media. El resto del change no se re-revisa (quedaba APTO).

**Media 1 — P2002 no discriminado → RESUELTO.** `generar-presupuesto.use-case.ts` sustituye el retry ciego por `esColisionNumeracion(error)` (líneas 444-473): sobre un `P2002` (helper `esP2002`, guard de tipo) inspecciona `meta.target` y solo reintenta si el objetivo es la numeración. La discriminación es **robusta a ambas formas** que Prisma expone en `target`: array de columnas (`typeof target` array → `.map(String)`, contempla `numero_presupuesto` = `COLUMNA_NUMERO_PRESUPUESTO`) o string del nombre del índice (contempla `presupuesto_tenant_id_numero_presupuesto_key` = `INDICE_NUMERO_PRESUPUESTO`); `target` ausente → `[]` → no reintenta. El nombre del índice coincide **exactamente** con la migración `20260713150000_presupuesto_numero_tenant/migration.sql:36` (`CREATE UNIQUE INDEX "presupuesto_tenant_id_numero_presupuesto_key"`) y con `@@unique([tenantId, numeroPresupuesto])` de `schema.prisma:491` (verificado). El P2002 de fecha D4 lo emite `activar-prereserva-uow.prisma.adapter.ts:184` con `meta.target: ['tenant_id','fecha']` — no contiene ninguno de los dos objetivos de numeración, luego **no se reintenta y propaga tal cual** (líneas 638-642: `if (esColisionNumeracion(error)) continue; throw error;`). El controller lo sigue mapeando a **409 "Fecha no disponible"** vía `esColisionUnique` (`generar-presupuesto.controller.ts:184,226`), comportamiento previo intacto. Reintentos de numeración agotados → nuevo `NumeracionPresupuestoAgotadaError` (use-case:403-410, código `NUMERACION_PRESUPUESTO_AGOTADA`): NO es `Prisma.PrismaClientKnownRequestError` ni instancia de ningún error mapeado en `aHttp`, por lo que **cae al `throw error` final (controller:222) → 500**, nunca al 409 engañoso. Cierra por completo las dos consecuencias que motivaron el hallazgo.

**Media 2 — cobertura del retry → RESUELTO.** `generar-presupuesto.use-case.spec.ts` añade el bloque N1 (líneas 570-682) con `crearP2002(target)` (fabrica el P2002 con `meta.target` string o array) y `crearUowConColisiones` (inyecta un error por intento contando aperturas de la tx): (1) `debe_reintentar_ante_P2002_de_numeracion_y_persistir_el_numero_incrementado` — colisión de numeración en el 1.er intento, éxito en el 2.º, verifica 2 aperturas de UoW y que persiste el número recalculado (`2026002`, no el que colisionó); (2) `debe_propagar_de_inmediato_el_P2002_de_fecha_D4_sin_reintentar` — P2002 `['tenant_id','fecha']` propaga tal cual con **una única** apertura de UoW. La suite del use-case pasa 29/29.

**Toolchain del delta (re-ejecutado con `NODE_OPTIONS=--experimental-vm-modules`).**

| Comando | Resultado |
|---------|-----------|
| `pnpm --filter @slotify/api typecheck` (`tsc --noEmit`) | OK |
| `pnpm --filter @slotify/api lint` (eslint `{ts,tsx}`) | OK — sin hallazgos |
| `pnpm --filter @slotify/api arch` (depcruise) | OK — no dependency violations (530 módulos, 1897 deps) |
| Suite `generar-presupuesto.use-case.spec` | OK — 29/29 (incl. N1) |
| Suite completa `@slotify/api` (incl. D4 concurrencia + `activar-prereserva`) | OK — 196 suites, 1842/1842 verde |

Sin regresión en el camino feliz (los tests 3.3/3.5/3.6 siguen verdes) ni nuevas violaciones de guardrails: el fix no introduce framework/infra en dominio (helpers puros sobre `unknown`), no toca el bloqueo atómico (D4 sigue serializado por `UNIQUE`+`FOR UPDATE`, ahora sin reintento espurio), no altera contrato/SDK/frontend. Ambas Media quedan **cerradas**.

## Conclusión

Los guardrails duros (hexagonal, RLS sin recrear policy, tenant en clave, adaptador degradante, ESM sin deuda de arranque, convenciones, contrato/frontend intactos) se cumplen. Toolchain completo en verde (arch/lint/typecheck + 83 tests). Las dos observaciones Media (P2002 no discriminado y su falta de test) son de robustez ante concurrencia patológica: el camino común está probado y cualquier colisión sigue resolviéndose en un 4xx, por lo que no bloquean el merge; se recomienda abordarlas (discriminar `meta.target` + test) en esta rebanada o como seguimiento inmediato.

Veredicto: APTO

Veredicto (re-review del fix, 2026-07-13): APTO
