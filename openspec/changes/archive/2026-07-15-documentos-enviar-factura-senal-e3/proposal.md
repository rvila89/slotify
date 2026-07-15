# Change: documentos-enviar-factura-senal-e3 (6.4b — Bloque C)

## Why

El épico **#6 — Documentos PDF por tenant** entrega la documentación real del
tenant (presupuesto, factura, condicions particulars). Las rebanadas ya en master
aportan lo que esta consume:

- **6.4a** (`documentos-condiciones-particulares-pdf`, archivada 2026-07-14, PR
  #68): el bloque `condiciones` en `PlantillaDocumentoTenant` + VO, el seed piloto
  de Masia (14 secciones), la plantilla react-pdf `documento-condiciones` (con
  bloque de firma EN BLANCO), el puerto `GenerarPdfCondicionesPort` + adaptador
  real (clave fija `condiciones/{tenantId}.pdf`, **degrada a `null`** si falta
  config o secciones) y el `DispararE2Adapter`, que **ya adjunta las condicions
  particulars al email E2** del presupuesto (post-commit, fire-and-forget).
- **US-022** (`generar-factura-senal`, en master): genera la FACTURA `tipo =
  'senal'` en `borrador` + PDF post-commit (idempotente por reserva). Concepto
  `Señal reserva {codigo}`. **Hoy esa factura nunca se despacha al cliente.**
- **US-028** (`enviar-factura-liquidacion-cliente`, archivada 2026-07-04): patrón
  vivo del envío MANUAL, SÍNCRONO y CONFIRMADO con atomicidad estado↔email E4
  (`aprobar-y-enviar-liquidacion.use-case.ts`), del que esta rebanada es **espejo**.

Hoy existe la factura de señal en `borrador` con su PDF, y existe el PDF de
condicions particulars, pero **no hay ninguna acción que envíe al cliente la
factura de la señal (40%) ni el email E3**. El Gestor no dispone de la acción
"Enviar factura 40%" que cierra el hito de confirmación de US-021/US-022/US-023:
el cliente recibe el presupuesto (E2) pero nunca recibe la factura de la señal
pagada junto con el contrato de condicions particulars.

Esta rebanada **6.4b (Bloque C)** entrega la **acción manual del Gestor "Enviar
factura de señal"**: aprueba (si procede) y **envía** la factura de señal al
cliente en el email **E3**, adjuntando la **factura de señal (40%)** + las
**condicions particulars** (reutilizando `GenerarPdfCondicionesPort` de 6.4a), de
forma **síncrona, confirmada y atómica** (espejo literal de E4). Activa además la
**plantilla E3** del catálogo (hoy inactiva).

(Fuentes: `epico-6-documentos-pdf-roadmap` §6.4/6.4b; US-022, US-023, UC-18, UC-19;
patrón US-028/UC-21; specs vivas `facturacion`, `comunicaciones`, `documentos`.)

## What Changes

### Bloque C.1 — Caso de uso `enviar-factura-senal` (capability `facturacion`)

- **Nuevo use-case de aplicación** `EnviarFacturaSenalUseCase`
  (`facturacion/application/enviar-factura-senal.use-case.ts`), **espejo de
  `AprobarYEnviarLiquidacionUseCase`** (US-028):
  - Acción **MANUAL** del Gestor, **SÍNCRONA** y **CONFIRMADA**.
  - Carga la RESERVA (RLS) → 404 si no existe/cross-tenant.
  - Unidad de trabajo tx + RLS con **reintento ante `P2002`** de numeración (la
    factura de señal ya recibe su `F-YYYY-NNNN` en US-022; el reintento se conserva
    por si el borrador aún no estuviese numerado — ver `design.md §D-num`).
  - **Envío de E3 SÍNCRONO dentro de la tx**: si falla → `EmisionEnvioFallidoError`
    y **rollback total** (nada de estado/`fecha_envio`/COMUNICACION E3).
  - Tras confirmar E3: **factura señal `borrador → enviada`** (fija `fecha_emision`
    si aún no la tenía), registra `RESERVA.cond_part_enviadas_fecha`,
    `cond_part_firmadas = false`, crea `COMUNICACION` E3 `enviado` y `AUDIT_LOG`.
  - **Idempotencia**: si ya existe una `COMUNICACION` E3 `enviado` para la reserva
    → NO re-envía; devuelve conflicto `E3_YA_ENVIADO` (409). Ver `design.md
    §D-idempotencia`.
  - Errores: `FacturaSenalNoEncontradaError` (404), `FacturaSenalNoEnviableError`
    (409, guarda de estado), `E3YaEnviadoError` (409, idempotencia),
    `EmisionEnvioFallidoError` (502).

### Bloque C.2 — Cableado del email E3 (capability `comunicaciones`)

- **Envío E3 síncrono/confirmado por `EnviarEmailPort` DIRECTO** (espejo de E4, NO
  por `DespacharEmailService`) con adjuntos: factura de señal + condicions
  particulars. Justificación en `design.md §D-ruta-email` (el motor/catálogo NO
  propaga el fallo del proveedor, incompatible con el rollback exigido).
- **Nuevo adaptador** `EnviarE3EmisionAdapter`
  (`facturacion/infrastructure/emision-email.adapter.ts` o fichero hermano) que
  cablea el puerto `enviarE3` del use-case a `EnviarEmailPort` con
  `codigoEmail: 'E3'`.
- **Plantilla E3 pasa a ACTIVA** en `catalogo-plantillas.ts` (hoy E2–E8 inactivas):
  se sustituye el `renderInactivo` de E3 por un `renderE3` real (asunto + cuerpo
  con próximos hitos), con sus `variablesRequeridas` y `adjuntosRequeridos`. El
  render activo sirve al registro/consistencia del catálogo; el **envío atómico**
  usa el puerto directo. Ver `design.md §D-ruta-email`.

### Bloque C.3 — Adjunto de condicions particulars (capability `documentos`)

- El envío E3 **reutiliza `GenerarPdfCondicionesPort`** (6.4a). Criterio de fallo
  específico de E3 (envío confirmado/rollback, a diferencia del E2 post-commit)
  fijado en `design.md §D-adjunto-condiciones`: el fallo de condicions **NO tumba**
  el envío; el adjunto se omite (degrada a `null`), porque la factura de señal es
  el adjunto legalmente imprescindible.

### Bloque C.4 — Endpoint HTTP + contrato OpenAPI + SDK

- **Nuevo endpoint** `POST /reservas/{id}/facturas/senal/enviar` (@Roles('gestor'))
  en `factura.controller.ts`. Ver `design.md §D-endpoint` (alinea con la convención
  viva `reservas/:id/facturas/{tipo}/{accion}`, en vez del literal del roadmap
  `POST /reservas/{id}/factura-senal/enviar`).
- **Debe entrar en el contrato OpenAPI** (`docs/api-spec.yml`, tag `Facturacion`) y
  **regenerar el SDK** del frontend. Lo ejecuta el `contract-engineer` en la fase de
  contrato; aquí solo se especifica (request vacío/`{}`, respuesta con la factura
  emitida + `condPartEnviadasFecha`; errores 404/409/502).

### Bloque C.5 — Frontend `features/facturacion`

- **Botón "Enviar factura 40%"** en `apps/web/src/features/facturacion` que invoca
  el nuevo endpoint (SDK generado), con estados de carga/éxito/error (409 ya
  enviado, 502 reintentable). Mobile-first (regla dura del proyecto). El detalle de
  diseño (ubicación en la ficha, confirmación) se cierra en implementación con Figma
  MCP si hay frame; si no, adaptación con tokens del proyecto.

## Trazabilidad

| Artefacto | Fuente |
|-----------|--------|
| Use-case `enviar-factura-senal` | US-023 §Happy Path (envío E3 con factura+condiciones), US-022 (factura señal), UC-19 (primer flujo), patrón UC-21/US-028 |
| Atomicidad estado↔E3, rollback | US-023 §Fallo en el envío del email E3; patrón `design.md §D-1` de US-028 |
| Idempotencia E3 | US-023 §E3 ya enviado previamente; §Reglas de Validación |
| Adjuntos E3 (factura señal + condiciones) | US-023 §Happy Path; 6.4a `GenerarPdfCondicionesPort` |
| Plantilla E3 activa | US-045 §Catálogo (E3→US-021/022/023); `catalogo-plantillas.ts` |
| `RESERVA.cond_part_enviadas_fecha/firmadas` | US-023 §Reglas de negocio; `schema.prisma` §RESERVA |
| Endpoint `POST .../facturas/senal/enviar` | Convención viva `factura.controller.ts`; roadmap §6.4b |
| Botón frontend | roadmap §6.4b; CLAUDE.md §responsive |

## Impact

- **Specs (delta)**: `facturacion` (MODIFICADA), `comunicaciones` (MODIFICADA),
  `documentos` (MODIFICADA — criterio de adjunto en envío confirmado).
- **Código backend**: `facturacion/application/enviar-factura-senal.use-case.ts`
  (nuevo), `facturacion/infrastructure/*.adapter.ts` (adaptador E3 + repos tx),
  `facturacion/interface/factura.controller.ts` + `factura.dto.ts` (endpoint/DTO),
  `facturacion/*.module.ts` (wiring), `comunicaciones/.../catalogo-plantillas.ts`
  (E3 activa).
- **Contrato**: `docs/api-spec.yml` (nuevo path) + SDK regenerado (dueño
  `contract-engineer`).
- **Frontend**: `apps/web/src/features/facturacion` (botón + llamada SDK).
- **Migración BD**: **ninguna** (los campos `cond_part_*` ya existen en `RESERVA`;
  la factura de señal y la config de condiciones ya existen).
- **Docs**: sincronizar `docs/` al cerrar el change.
