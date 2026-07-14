# Code review — 6.2 documentos-presupuesto-sin-iva-doble-numeracion

Fecha: 2026-07-14
Revisor: code-reviewer (solo lectura, sin fixes)
Base: `feature/documentos-presupuesto-sin-iva-doble-numeracion` vs `master` (sin commitear)
Skills: `review-checklist`, `architecture-guardrails`

## Alcance revisado
Backend `apps/api` (dominio régimen/desglose, use-case, adaptadores Prisma, DTO/controller,
migración, schema.prisma, `documentos/presentation`), frontend `apps/web` (selector, lib,
model, diálogo, cliente generado) y contrato `docs/api-spec.yml`. QA previo no re-ejecutado.

## Historial de revisión
- **Ronda 1 (NO APTO)**: un hallazgo Alta de divergencia contrato↔DTO — el preview no
  devolvía `regimenIva` pese a que el contrato/cliente lo declaraban requerido y el frontend
  lo consumía.
- **Ronda 2 (esta, APTO)**: re-revisión SOLO del fix del hallazgo Alta (TDD RED→GREEN).
  Verificado y cerrado. Ver más abajo.

## Hallazgos por severidad

### Bloqueantes
_(ninguno)_

### Alta
- **[contrato] El preview no devolvía `regimenIva` — CORREGIDO Y CERRADO.** Re-verificado el
  fix en el diff:
  - `PreviewPresupuestoResultado` ahora incluye `regimenIva: RegimenIva`
    (`generar-presupuesto.use-case.ts:346`).
  - `componerBorrador` lo puebla en AMBAS ramas de retorno: la de `tarifa_a_consultar`
    (`desglose: null`, `...use-case.ts:823`) y la normal (`...use-case.ts:841`), reutilizando
    el `regimen` ya derivado en scope (sin recomputar).
  - `PresupuestoPreviewResponseDto` expone `regimenIva!` requerido, `enum [con_iva|sin_iva]`
    (`generar-presupuesto.dto.ts:164-169`).
  - El mapper `aPreviewResponse` copia `regimenIva: resultado.regimenIva`
    (`generar-presupuesto.controller.ts:146`).
  - TDD: el spec de use-case añade las dos aserciones del preview antes ausentes
    (`generar-presupuesto-regimen.use-case.spec.ts:217-232`): `efectivo ⇒ 'sin_iva'`,
    `transferencia ⇒ 'con_iva'` sobre `out.regimenIva`. Estaba RED, ahora GREEN (preview
    42/42 según la sesión principal). El contrato + cliente generado ya lo declaraban
    requerido, de modo que back, contrato, cliente y frontend quedan alineados.

### Media
_(ninguno)_

### Baja
- **[estilo] indentación de `construirModeloDocumentoPresupuesto`** — RESUELTO. Tras el fix,
  el fichero `modelo-documento-presupuesto.ts` se revirtió por accidente y se reconstruyó a
  mano; verificado que la reconstrucción conserva la variante SIN IVA íntegra: contiene
  `RegimenDocumento` (:24), `DatosDocumentoPresupuesto.regimen` (:63),
  `CabeceraModelo.mostrarIdentidadFiscal` (:82), `TotalesModelo.mostrarDesgloseIva` (:100),
  `totales: TotalesModelo` (:127) y la resolución de flags por régimen (:149-150). La sesión
  principal reporta typecheck limpio, specs de plantilla SIN IVA 11/11 y CON IVA 16/16 en
  verde (aislados) y PDF SIN IVA byte-idéntico al validado (3559 bytes). Sin hallazgo abierto.

## Verificación de guardrails DUROS — OK

- **Hexagonal**: `domain/regimen-desde-metodo-pago.ts` puro (sin `@nestjs/*`, `@prisma/*`
  ni infra); mapa declarativo `Record<MetodoPago,RegimenIva>`. `desglose-fiscal.ts`
  parametriza por régimen con tabla de estrategias `DESGLOSE_POR_REGIMEN` (declarativa),
  importa solo el tipo del propio dominio.
- **documentos NO importa de presupuestos**: 0 matches de `from '...presupuestos'` en
  `apps/api/src/documentos`. `RegimenDocumento` se DECLARA localmente
  (`modelo-documento-presupuesto.ts:24`, duplicado intencional documentado). Los adaptadores
  de infra mapean en la frontera (`regimen as RegimenIva`), capa correcta.
- **Multi-tenancy / RLS**: migración ADITIVA (columnas nullable + backfill), policy
  `tenant_isolation` de `presupuesto` (subconsulta a `reserva`) NO recreada.
  `ultimoNumeroDelAnio` filtra por `tenantId` + `regimenIva`. Tenant desde el JWT.
- **Bloqueo atómico**: sin Redis/Redlock. Reintento `P2002` anclado a
  `presupuesto_tenant_id_regimen_iva_numero_presupuesto_key`; NO reintenta el
  `UNIQUE(tenant_id, fecha)` de FECHA_BLOQUEADA (colisión de numeración → reintento/500,
  nunca 409 de fecha).
- **Importes en Decimal**: persistencia `Prisma.Decimal`; desglose Decimal string 2 dec.
  SIN IVA fija `ivaImporte="0.00"`, `ivaPorcentaje="0.00"`, `total=base`. Sin `Float`.
- **DTOs con class-validator**: `metodoPago` con `@IsIn(['transferencia','efectivo'])` en
  preview y confirmar; ausente/inválido → `MetodoPagoRequeridoError` → 422. Mensajes en
  español.
- **Errores en español**: `MetodoPagoRequeridoError` ("El método de pago es obligatorio...").
- **TDD (tests primero)**: 5 specs nuevos + aserción de preview (RED→GREEN); specs de 6.1b
  actualizados de forma aditiva (`regimen: 'con_iva'`).
- **Cliente generado intacto**: diff de `schema.d.ts` 1:1 con el contrato; sin edición a mano.
- **Arrow functions**: todo el código nuevo usa `const x = () => {}`.
- **components/ solo .tsx**: `SelectorMetodoPago.tsx` puro; helpers/constantes en
  `lib/metodoPago.ts`; estilo en `lib/estilos.ts`; tipos en `model/types.ts`. El barrel
  `index.ts` NO expone el sub-componente (privado del diálogo).
- **Responsive**: selector mobile-first (`flex-col sm:flex-row`), objetivo táctil
  `min-h-[3.5rem]` (≥44px), radios nativos accesibles, sin anchos px fijos ni overflow.
  E2E en 3 viewports OK (step-8).

## Contrato vs DTOs (checklist #9)
- Request preview/confirmar: `metodoPago` requerido en YAML, cliente y DTO. OK.
- `PresupuestoCreadoDto`: `numeroPresupuesto` + `regimenIva` expuestos y poblados desde el
  adaptador. OK.
- `PresupuestoPreviewResponse.regimenIva`: **ALINEADO** tras el fix (DTO required, mapper
  poblado, use-case retorna, cliente requerido, frontend consume). OK.

## Veredicto

Veredicto: APTO

El único hallazgo bloqueante-para-cierre (Alta, divergencia contrato↔preview) quedó
corregido y verificado por TDD (RED→GREEN), con back/contrato/cliente/frontend alineados. El
hallazgo Baja de estilo quedó resuelto en la reconstrucción del modelo, con la variante SIN
IVA íntegra. No quedan hallazgos abiertos. Todos los guardrails duros se cumplen.
