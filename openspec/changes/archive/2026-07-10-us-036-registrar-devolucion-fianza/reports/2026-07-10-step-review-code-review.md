# Informe de Code-Review — US-036 Registrar devolución de fianza

- **Change:** `us-036-registrar-devolucion-fianza`
- **Rama:** `feature/us-036-registrar-devolucion-fianza`
- **Base comparada:** working tree vs `master` (664000f). El trabajo de US-036 está en el árbol de
  trabajo, aún sin commit; la rama apunta al mismo commit que `master`. Revisado sobre los ficheros
  modificados/nuevos (`git status`).
- **Alcance:** backend (`apps/api`) + frontend (`apps/web`) + contrato (`docs/api-spec.yml`) +
  cliente generado + migración + artefactos del change.
- **Fecha:** 2026-07-10
- **Modo:** solo lectura (no se aplican fixes).

---

## 1. Resumen ejecutivo

Implementación de alta calidad, simétrica inversa del cobro de fianza de US-030 y alineada con los
guardarraíles duros de Slotify. Arquitectura hexagonal respetada, bloqueo por `SELECT ... FOR UPDATE`
(sin locks distribuidos), multi-tenancy por JWT + RLS, importes en `Decimal`/céntimos enteros,
contrato <-> implementación <-> cliente generado coherentes, migración aditiva. Los dos bugs que dejó
el QA (Bug 1 `aImporte`, Bug 2 aviso FA-04) están **ya corregidos** en el árbol de trabajo. No se
detectan hallazgos bloqueantes. Solo hallazgos menores/cosméticos.

---

## 2. Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Alta
- Ninguno.

### Media
- **[frontend / UX de validación] Placeholder de importe con separador de miles rechazado por el
  esquema.** `apps/web/src/features/facturacion/components/devolucionFianzaSchema.ts` valida el
  importe crudo con `IMPORTE_RE = /^\d+([.,]\d{1,2})?$/`, que **rechaza** cualquier valor con
  separador de miles (`"1.000,00"`, `"1.234.567,89"`). Sin embargo:
  - El placeholder del campo es `"Ej.: 1.000,00"`
    (`DevolucionFianzaFormFields.tsx:69`), que si se teclea literalmente da el error "Introduce un
    importe válido (máx. 2 decimales)".
  - `aImporte` sí normaliza correctamente esos valores (tests: `"1.000,50" -> "1000.50"`), de modo
    que la restricción está en el refine previo, no en la normalización.
  - No es un bug de datos (no reintroduce el bug de separador de miles del punto 8: el `Importe`
    producido es siempre `Decimal(10,2)` correcto); es una incoherencia de UX entre el placeholder y
    lo que el formulario acepta.
  - Es un patrón HEREDADO de US-030 (`RegistrarCobroFianzaDialog.tsx:49` tiene el mismo `IMPORTE_RE`),
    por lo que es consistente con el precedente congelado, no una regresión nueva.
  - **Recomendación (no bloqueante):** ampliar `IMPORTE_RE` para tolerar separadores de miles
    (validar sobre `aImporte(v)`) o cambiar el placeholder a un formato que el regex acepte
    (p. ej. `"Ej.: 1000,00"`). Alinear con US-030 si se decide corregir.

### Baja
- **[qa] El informe E2E (`reports/2026-07-10-step-N+3-e2e-playwright.md`) está desactualizado**
  respecto al código actual: reporta Bug 1 (`aImporte` no normaliza enteros) y Bug 2 (aviso FA-04 no
  visible) como abiertos, pero **ambos están corregidos** en el árbol de trabajo:
  - Bug 1: `aImporte` ahora emite `toFixed(2)` siempre y tiene batería dedicada
    (`components/__tests__/devolucionFianzaSchema.test.ts`, describe "Bug 1").
  - Bug 2: `avisoSinJustificante` se propaga a `FianzaDevueltaResumen` (aviso persistente en el estado
    final) y además se muestra un toast en `DevolucionFianzaCard`.
  - **Recomendación:** actualizar la nota de QA / informe E2E para reflejar que los dos bugs quedaron
    resueltos (evita confusión en el archivado).
- **[frontend / cast controlado] `api/useSubirJustificante.ts` usa `fichero as unknown as string`**
  para el body multipart de `POST /documentos`. Documentado y patrón estándar de `openapi-fetch` para
  `FormData` (no edita el cliente generado). Aceptable; se deja constancia.

---

## 3. Verificación del checklist / guardrails

| Regla | Resultado | Evidencia |
|-------|-----------|-----------|
| Hexagonal (domain sin @nestjs/@prisma/infra) | OK | Los 3 ficheros de `facturacion/domain/*devolucion*` solo tienen imports internos; el use-case depende solo de puertos. |
| Puertos en dominio / adaptadores en infra | OK | Puertos en el use-case; `devolucion-fianza-repository.prisma.adapter.ts` + `-uow.prisma.adapter.ts` los implementan. |
| Bloqueo por SELECT ... FOR UPDATE, sin Redis | OK | `releerConBloqueo` usa `$queryRaw ... FOR UPDATE OF r`; UoW abre `$transaction` + `SET LOCAL app.tenant_id`. |
| Irreversibilidad del estado final | OK | Guarda reevaluada bajo lock: estados finales -> 409 `DEVOLUCION_YA_REGISTRADA`. Test de concurrencia real. |
| Tenant del JWT, nunca del path/body | OK | Controlador toma tenant/usuario de `@CurrentUser`. |
| RLS + justificante/reserva acotados al tenant | OK | UoW fija `app.tenant_id`; `buscarJustificante` filtra tenant + tipo + reservaId. |
| Máquina de estados declarativa | OK | Guarda y derivación como funciones puras de datos. |
| Importes en Decimal/céntimos, no Float | OK | `aCentimos` + `Math.round`; `Prisma.Decimal`; migración TEXT, sin Float. |
| DTOs con class-validator | OK | `@IsString`/`@Matches`/`@IsOptional`. |
| Errores en español | OK | Mensajes de dominio y UI en español. |
| Contrato <-> implementación (endpoint/body/códigos) | OK | `POST /reservas/{id}/fianza/devolucion`; 400/404/409 con los codigo correctos; simétrico a US-030. |
| Cliente generado, no editado a mano | OK | `schema.d.ts` regenerado (op `registrarDevolucionFianza`, schemas nuevos, placeholder eliminado). |
| 400 vs 422 (desviación declarada) | OK | tasks.md 7.5/7.6 reconcilian 422->400; contrato y código usan 400. |
| @Matches laxo en justificanteDocId | Aceptable | Contrato declara `format: uuid` como forma; existencia real -> 404 en dominio; no debilita seguridad (RLS + tipo+reserva). Documentado en el DTO. |
| Migración aditiva | OK | `ALTER TABLE "reserva" ADD COLUMN "motivo_retencion" TEXT;` nullable, sin default/backfill. |
| Normalización de importe (fix Bug 1) | OK | `aImporte` produce siempre Decimal(10,2) (`toFixed(2)`); tests dedicados. |
| Arrow functions (no function) | OK | Sin declaraciones `function` en código nuevo. |
| max-lines <= 300 | OK (nuevos) | Todos los nuevos <= 300. `FacturaSenalCard.tsx` (315) excede pero es PRE-EXISTENTE, fuera de este change. |
| Estructura Bulletproof React + barrel | OK | `features/facturacion/` con api/components/lib/model; barrel exporta API pública; FichaConsulta importa por barrel. |
| Responsive mobile-first, drawer <lg, sin overflow | OK | `w-full` movil -> `sm:w-auto`; footer flex-col -> sm:flex-row; evidencia E2E 390/768/1280. |
| Tests primero (concurrencia/transiciones) | OK | Specs de dominio, use-case, controller HTTP y concurrencia real contra Postgres. |
| Nombres español | OK | Convenciones respetadas. |

---

## 4. Estado ya verificado por la sesión principal

Se da por bueno (no reproducible desde el subagente sin Postgres): backend 1632 tests + concurrencia
real 15/15 + depcruise 0 violaciones; web 155 tests + lint/typecheck/build OK; QA 3 reports PASS.
Nada en el diff los contradice. Único matiz: el informe E2E quedó desfasado respecto a los fixes de
Bug 1 y Bug 2 (ver hallazgo Baja).

---

## 5. Veredicto

Ningún hallazgo bloqueante. Arquitectura, contrato, seguridad multi-tenant, concurrencia, importes,
migración y responsive cumplen los guardarraíles. Los hallazgos son de severidad Media/Baja
(coherencia placeholder<->regex heredada de US-030 e informe E2E desactualizado), ninguno impide el
merge.

**Veredicto: APTO**
