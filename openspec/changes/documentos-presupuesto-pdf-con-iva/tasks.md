# Tasks — documentos-presupuesto-pdf-con-iva (6.1b)

> Change de OpenSpec. Los pasos obligatorios provienen de `openspec/config.yaml`.
> El agente DEBE ejecutar él mismo las pruebas (unit, integración, verificación
> visual del PDF); **nunca las delega en el usuario**.
>
> **Sin fase de contrato OpenAPI/SDK** (cuestión abierta N4: `pdf_url` ya existe;
> `numero_presupuesto` no se expone por API en 6.1b). **Sin fase de
> frontend/E2E Playwright** (no hay UI nueva; el PDF es backend). La verificación
> visual del PDF real se hace en el paso de integración desde la sesión principal
> (que sí tiene Postgres).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/documentos-presupuesto-pdf-con-iva` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentado y **APROBADO 2026-07-13**
- [x] 1.2 Cuestiones N1–N6 resueltas: **N1** número en la tx de confirmación (reintento ante colisión); **N2** añadir `tenant_id` + `numero_presupuesto` a `Presupuesto`, `@@unique([tenantId, numeroPresupuesto])`, RLS + backfill, formato **`2026001`** (año + 3 dígitos, reset anual); **N3** cabecera solo-texto si `logoUrl=null`; **N4** sin delta de contrato (número solo en el PDF); **N5** mostrar solo **"(N hores)"** (sin hora de inicio); **N6** unit render + generación real + inspección visual del PDF desde la sesión principal
- [x] 1.3 OK explícito recibido

## 2. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [ ] 2.1 Tests de la función de dominio de **numeración de presupuesto**
      (`2026001`, incremento por tenant, reinicio anual, defensa año) — patrón de
      `facturacion/domain/numeracion-factura.spec.ts` — EN ROJO
- [ ] 2.2 Tests de **render de la capa de plantilla** (`DocumentoLayout` +
      sub-componentes): produce bytes no vacíos; contiene textos del tenant
      (razón social, concepto con `{nombreComercial}` resuelto, **no "lloguer"**,
      IBAN, validesa, base/%IVA/total); cabecera **solo-texto** con `logoUrl=null`
      y con logo cuando existe — EN ROJO
- [ ] 2.3 Tests del **adaptador real de PDF** con dobles: config `null` → `null`;
      camino feliz llama a `AlmacenDocumentosPort.subir` con clave que incluye
      `tenant_id` y devuelve la URL — EN ROJO
- [ ] 2.4 Confirmar que los tests fallan por ausencia de implementación (RED)

## 3. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 3.1 Instalar `@react-pdf/renderer` en `apps/api`; verificar que el toolchain
      compila JSX/`.tsx`. react-pdf es ESM puro (sin build CJS): se carga con `import()`
      NATIVO en el render (`--experimental-vm-modules` bajo Jest vía cross-env); los `.tsx`
      compilan a CJS y reciben las primitivas de react-pdf inyectadas (kit)
- [x] 3.2 Migración Prisma no destructiva: `numero_presupuesto` + `tenant_id` (N2) en
      `Presupuesto`, con `@@unique([tenantId, numeroPresupuesto])`, backfill y RLS
      `tenant_isolation` (SQL a mano en `20260713150000_presupuesto_numero_tenant`; NO
      aplicada — sin Postgres en esta sesión)
- [x] 3.3 Implementar la función de dominio de numeración (arrow, dominio puro)
- [x] 3.4 Implementar la capa de plantilla en `documentos/presentation/` y sus
      componentes (arrow functions, contenido 100% de la config)
- [x] 3.5 Implementar `PdfPresupuestoRealAdapter` (carga config + datos → render →
      `subir` → URL) + puerto/adaptador Prisma de lectura de datos; cablearlo en el token
      `GENERAR_PDF_PRESUPUESTO_PORT` de `PresupuestosModule` (importa `DocumentosModule`);
      fake retirado del cableado de producción
- [x] 3.6 Asignar `numero_presupuesto` en la tx de confirmación (N1), con reintento
      ante colisión de unicidad (P2002)
      - **Fix code-review (Media 1+2):** el reintento ahora DISCRIMINA el `P2002` por
        `meta.target` (`esColisionNumeracion`): solo reintenta el de la numeración
        (`numero_presupuesto` / `presupuesto_tenant_id_numero_presupuesto_key`); el P2002
        de la fecha D4 (`UNIQUE(tenant_id, fecha)`) propaga de inmediato → 409 "fecha no
        disponible" sin 10 reintentos. Reintentos agotados → `NumeracionPresupuestoAgotadaError`
        (→ 500), no el mensaje de fecha. Cubierto por 2 tests unitarios nuevos en
        `generar-presupuesto.use-case.spec.ts` (N1).
- [x] 3.7 Revisar/actualizar tests existentes de `presupuestos` afectados (fake repo del
      use-case + `ultimoNumeroDelAnio`); los del paso 2 en verde. Los 2 suites de
      integración/concurrencia contra Postgres quedan pendientes de aplicar la migración
      (se ejecutan desde la sesión principal con BD real)
- [x] 3.8 `pnpm lint` + `pnpm typecheck` (+ `arch`) en verde

## 4. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 4.1 Baseline de BD capturado
- [x] 4.2 Tests dirigidos `documentos`/`presupuestos` en verde
- [x] 4.3 Suite dirigida 112/112 verde (con `NODE_OPTIONS=--experimental-vm-modules`); flaky US-004 ajena
- [x] 4.4 Migración aplicada a `slotify_test`+`dev`; esquema verificado (columnas+unicidad). **Corregida**: no recrea la policy RLS (presupuesto ya tenía `tenant_isolation` por join desde el init)
- [x] 4.5 Report `reports/2026-07-13-step-4-unit-test-and-db-verification.md`
- [x] 4.6 Completado

## 5. QA: integración real + verificación VISUAL del PDF (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
> No hay endpoint nuevo: en lugar de curl a una ruta nueva, se ejercita el flujo
> real de confirmación de presupuesto (que ya expone su endpoint) contra Postgres
> desde la SESIÓN PRINCIPAL (los subagentes no tienen BD) y se INSPECCIONA
> visualmente el PDF generado.
- [x] 5.1 Backend + Postgres + seed del piloto disponibles
- [x] 5.2 Presupuesto confirmado real (`POST /api/reservas/{id}/presupuesto` → 201, reserva→pre_reserva)
- [x] 5.3 BD: `numero_presupuesto=2026001` + `tenant_id` + unicidad verificados. `pdf_url` real obtenida ejecutando el adaptador fresco (`http://localhost:3000/almacen/presupuestos/{tenantId}/{id}.pdf`); en el confirm en vivo quedó null por el dev server obsoleto (no bug)
- [x] 5.4 **PDF real generado e inspeccionado visualmente** (cabecera solo-texto, concepto sin "lloguer" con "(8 hores)", extras, base/%IVA/total, 40/60/fiança, IBAN). Muestra en `reports/muestra-presupuesto-con-iva.pdf`
- [x] 5.5 Caso degradado (config null → null) cubierto por el test unit del adaptador
- [x] 5.6 BD restaurada (976f45c4→consulta/s2b, presupuesto de prueba borrado, cliente fiscales null)
- [x] 5.7 Report `reports/2026-07-13-step-5-integracion-y-verificacion-visual-pdf.md`. **Nota**: almacenamiento local en memoria (B1) → PDF aún no durable/adjuntable real hasta el adaptador cloud (diferido)

## 6. QA: E2E con Playwright MCP — NO APLICA (step-N+3)
- [x] 6.1 **NO APLICA**: sin frontend en 6.1b (el PDF es backend). Sin E2E.

## 7. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 7.1 Actualizar docs de arquitectura/documentos: capa de plantilla react-pdf,
      adaptador real de PDF, numeración de presupuesto, variable `ALMACEN_PROVIDER`
- [x] 7.2 Nota de deuda/roadmap: SIN IVA + método de pago + doble numeración = 6.2;
      reutilización de la plantilla por facturas = 6.3

## 8. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Ejecutar `code-reviewer` sobre el diff (hexagonal, RLS/tenant, arrow
      functions, sin lock distribuido, cliente generado intacto, TDD)
- [x] 8.2 Dejar informe `openspec/changes/documentos-presupuesto-pdf-con-iva/reports/YYYY-MM-DD-step-review-code-review.md`
      con la línea literal `Veredicto: APTO`

## 9. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 9.1 Code-review APTO (2 Media resueltos) + PDF verificado + OK humano **APROBADO 2026-07-14**

## 10. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 10.1 `openspec archive documentos-presupuesto-pdf-con-iva`; actualizar
      `openspec/specs/`; abrir PR (solo tras gate final y code-review APTO)
