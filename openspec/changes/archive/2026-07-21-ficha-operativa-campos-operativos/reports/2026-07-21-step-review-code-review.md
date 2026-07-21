# Code review — change `2026-07-21-ficha-operativa-campos-operativos`

- Fecha: 2026-07-21
- Rama: `feature/condiciones-idioma-e2-firma-banner` (worktree `ficha-operativa-campos-operativos`)
- Alcance revisado: `git diff master..HEAD` (5 commits: openspec, contrato+SDK, TDD-RED, backend, frontend)
- Modo: solo lectura (informe; no se aplican fixes)

## Resumen del cambio
Ajuste de campos de `FICHA_OPERATIVA`:
- ELIMINA del contrato `menuSeleccionado` y `timingDetallado` (columnas permanecen en BD como legacy nullable, soft-remove).
- AÑADE `contactoEventoCorreo` (String?, pre-rellenado desde `reserva.cliente.email` al confirmar), `horaLlegada` (String?, HH:MM) y `duracion` (String?, texto libre).
- Afecta contrato OpenAPI + SDK, backend NestJS/Prisma y frontend React.

## Veredicto: APTO

No se han encontrado hallazgos Bloqueantes ni de severidad Alta. Se registran advertencias menores (Baja) y notas de verificación.

---

## Checklist de guardrails

### 1. Hexagonal — OK
`apps/api/src/ficha-evento/domain/` (`ficha-operativa.ports.ts`, `maquina-estados-pre-evento.ts`) no importa `@nestjs/*`, `@prisma/*` ni `infrastructure/`. Las menciones a Prisma/Nest son solo comentarios (`no-infra-in-domain`). El único import de `@prisma/client` está en `infrastructure/__tests__/ficha-operativa.mapper.spec.ts` (capa de infraestructura, correcto).

### 2. Multi-tenancy / RLS — OK
- `ficha-operativa.controller.ts`: el `tenant_id` deriva del JWT vía `@CurrentUser`, nunca del path/body.
- `cargar-reserva-confirmacion.prisma.adapter.ts`: el nuevo `include: { cliente: { select: { email: true } } }` cuelga del mismo `findFirst` con `where: { idReserva, tenantId }` bajo `fijarTenant(tx, tenantId)`. No hay bypass de RLS ni query nueva sin filtro de tenant. El correo del cliente pertenece al mismo tenant que la reserva.

### 3. Contrato — OK
- `docs/api-spec.yml`: `GuardarFichaOperativaRequest` conserva `additionalProperties: false`; los campos eliminados desaparecen de request y response, y se añaden los 3 nuevos como `nullable: true`.
- SDK `apps/web/src/api-client/schema.d.ts` regenerado coherentemente (no editado a mano; refleja request/response y el ejemplo de `avisosCamposVacios`).
- DTOs (`ficha-operativa.dto.ts`) coinciden con el contrato: response y request con `contactoEventoCorreo`/`horaLlegada`/`duracion`, validados con `class-validator` (`@IsOptional`/`@ValidateIf(salvoNull)`/`@IsString`).

### 4. Máquina de estados — OK
- `CAMPOS_TEXTO` (`maquina-estados-pre-evento.ts`) y `CAMPOS_CONTENIDO` (`cerrar-ficha-operativa.use-case.ts`) incluyen los 3 nuevos y excluyen los legacy.
- `ContenidoFicha` / `FichaOperativa` / `CamposFichaOperativa` actualizados de forma consistente.
- La guarda `pendiente → en_curso` (§D-2, primer guardado con dato de texto) sigue modelada por tabla declarativa; el spec verifica que dispara con `duracion` con contenido y NO con blancos.

### 5. Pre-relleno idempotente — OK
En `confirmar-pago-senal.use-case.ts` la siembra de `contactoEventoCorreo: reserva.contactoEmail` va dentro del bloque guardado por `if (fichaExistente === null)` (crearVacia solo se invoca al crear). Si `cliente.email` es null, el adapter proyecta `contactoEmail: fila.cliente?.email ?? null` y la ficha queda con el campo a null — no bloquea la confirmación. Cubierto por 3 tests (siembra, null, no re-siembra si ya existe).

### 6. Frontend — OK
- `lib/schema.ts` `construirRequest()` ya no envía `menuSeleccionado`/`timingDetallado`; envía los 3 nuevos vía `textoONull`.
- `valoresDesdeFicha()` maneja null con `?? ''` para todos los campos.
- `lib/campos.ts` tabla declarativa actualizada; nuevos tipos `email`/`hora`.
- `components/CamposFicha.tsx`: helpers `tipoInput`/`modoEntrada` como arrow functions; input `type=time` para hora y `type=email` para correo.

### 7. Regresiones cierre automático (US-026) — OK
Los specs de cierre (`cerrar-ficha-operativa.use-case.spec.ts`) actualizan `avisosCamposVacios` al nuevo conjunto y añaden aserciones `not.toContain('menuSeleccionado'/'timingDetallado')`. El read-path completo (mapper → dominio → DTO → contrato) está cubierto, incluido el test del mapper que verifica que las columnas legacy presentes en BD NO se proyectan.

### 8. Arrow functions — OK
Sin `function` declarativas en el código nuevo (backend ni frontend). Los helpers frontend son arrow functions.

### 9. Responsive — OK (con nota)
`CamposFicha.tsx` mantiene `grid grid-cols-1 gap-5 sm:grid-cols-2` (mobile-first, 1 col → 2 cols en `sm:`) y `sm:col-span-2` para campos de ancho completo; inputs `h-12` (objetivo táctil >=48px), sin anchos px fijos ni overflow. Nota: el cambio no añade evidencia de captura en 3 viewports (390/768/1280); dado que solo se cambia el tipo de dos inputs dentro de una rejilla ya responsive existente, el riesgo es bajo. Se recomienda que QA confirme los 3 viewports.

---

## Verificación de tests
- 6 suites unitarias del change en VERDE: `guardar-ficha-operativa`, `leer-ficha-operativa`, `cerrar-ficha-operativa.spec`, `maquina-estados-pre-evento`, `ficha-operativa.mapper`, `confirmar-pago-senal.use-case` → 124 tests passed.
- En la corrida completa de `ficha-evento` fallan 3 suites de integración/concurrencia (`cerrar-ficha-operativa-interleaving` y afines) por inicialización de Prisma sin Postgres real (`Cannot read properties of undefined (reading 'cliente')`). Es la limitación conocida de entorno (subagentes sin Docker/Postgres), NO una regresión de lógica de este change. Deben ejecutarse desde la sesión principal con BD real.

## Advertencias (Baja)
1. [validación] `horaLlegada` se valida solo como `@IsString()` en el DTO y `z.string()` en el frontend; el formato HH:MM está documentado en el contrato pero no se valida (input `type=time` en UI ayuda, pero la API acepta cualquier string). Consistente con "texto libre" del diseño; considerar validación de formato si se requiere estrictez.
2. [QA] Falta evidencia de responsive en 3 viewports; confirmar en QA.
3. [entorno] Ejecutar las suites de integración/concurrencia de `ficha-evento` contra Postgres real antes de archivar/PR.

## Bloqueantes
Ninguno.

Veredicto: APTO
