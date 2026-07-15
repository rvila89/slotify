# Proposal — condiciones-particulares-e3-us023 (US-023, rebanada incremental)

> Change: `condiciones-particulares-e3-us023`.
> Branch: `feature/condiciones-particulares-e3-us023` (creada por el orquestador; ver Nota de coherencia).
> US: **US-023** — "Generar y Enviar Condiciones Particulares al Cliente en E3".
> UC: **UC-19** (primer flujo: generación y envío), contexto UC-17 (orquestador, cubierto en US-021).

## Nota de coherencia branch↔change

El orquestador creó la branch `feature/condiciones-particulares-e3-us023`. El change se ha
renombrado a `condiciones-particulares-e3-us023`, de modo que branch y change **CASAN** con el
patrón `feature/{change-name}` de `config.yaml`. No queda divergencia que resolver.

## Por qué (contexto)

US-023 cierra el hito de confirmación: el cliente recibe en un único email **E3** la factura de
señal y el **documento de condiciones particulares** del evento, iniciando el proceso de firma
(cumplimiento contractual, D1) y dejando trazado el estado de las condiciones en la reserva (D3).

**La mayor parte del happy path YA EXISTE en master** (épico #6, en particular la rebanada 6.4b
`documentos-enviar-factura-senal-e3`). Este change NO re-propone lo entregado: delimita **solo
los tres gaps genuinos** que la US-023 exige y 6.4b no cubre.

## Qué reutiliza de 6.4a/6.4b (NO se re-propone)

- **Entidad `DOCUMENTO`** (`Documento`, `schema.prisma`) con `tipo/reservaId/tenantId/url/mimeType/
  nombreArchivo/tamanoBytes/fechaCreacion`; enum `TipoDocumento` ya incluye
  `condiciones_particulares`. **No hay migración de enum ni de tabla.**
- **Campos RESERVA** `cond_part_enviadas_fecha`, `cond_part_firmadas`, `cond_part_firmadas_fecha`
  ya existen. **No hay migración.**
- **Entidad `COMUNICACION`** con enum `CodigoEmail` (incluye `E3`), `EstadoComunicacion`
  = {borrador, enviado, fallido}, campo `esReenvio` (default false) e **índice UNIQUE parcial**
  `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false`. **No hay
  migración.** El `esReenvio=true` ya está pensado para reenvíos que esquivan el UNIQUE.
- **PDF de condiciones**: `GenerarPdfCondicionesPort` + `PdfCondicionesRealAdapter`
  (clave fija `condiciones/{tenantId}.pdf`; degrada a `null`). Almacén durable vía
  `AlmacenDocumentosPort`. Se reutiliza tal cual (salvo el cambio de semántica del GAP 2).
- **Envío E3 atómico**: `EnviarFacturaSenalUseCase` (envío síncrono/confirmado de E3 con adjuntos
  dentro de tx atómica, rollback total si E3 falla; fija `cond_part_enviadas_fecha` y
  `cond_part_firmadas=false`; crea COMUNICACION E3 `enviado` + AUDIT_LOG). Adaptador directo
  `EnviarE3EmisionAdapter` (`EnviarEmailPort`). Endpoint `POST /reservas/{id}/facturas/senal/enviar`.
- **Plantilla E3** activa en el catálogo. Patrón espejo E4: `aprobar-y-enviar-liquidacion.use-case.ts`
  y `reenviar-liquidacion.use-case.ts`.

## Qué es NUEVO (alcance exacto de este change)

Solo **tres gaps** respecto a lo entregado. Nada más se propone.

### GAP 1 — Persistencia de la fila `DOCUMENTO` de condiciones (NUEVO)

Hoy el PDF de condiciones se **genera y adjunta** a E3, pero **no se persiste** una fila
`DOCUMENTO`. US-023 §Happy Path exige crear `DOCUMENTO` con `tipo='condiciones_particulares'`,
`reserva_id`, `tenant_id`, `url` (la del PDF ya generado), `mime_type='application/pdf'`, y
registrar `AUDIT_LOG accion='crear'` para ese DOCUMENTO. La creación ocurre **dentro de la misma
tx atómica** del envío E3 y es **idempotente**: **un único** `DOCUMENTO` de condiciones por reserva
(si existe, se reutiliza; los reenvíos no duplican). Requiere puerto de dominio + adaptador Prisma
para persistir/buscar el `DOCUMENTO`, integrado en el use-case existente sin romper su atomicidad.

### GAP 2 — Condiciones: requisito bloqueante (DECISIÓN CERRADA: ENDURECER, aprobada en el gate SDD)

6.4b decidió (D-adjunto-condiciones) que las condiciones son un adjunto **opcional/degradable**:
si `GenerarPdfCondicionesPort` devuelve `null`, **E3 se envía igual** sin condiciones
(`condPartAdjuntada=false`). **US-023 dice lo contrario**: si no hay condiciones configuradas,
**NO se genera DOCUMENTO, NO se envía E3**, la reserva **permanece sin `cond_part_enviadas_fecha`**,
y el gestor recibe la alerta "Configura las condiciones particulares del espacio para poder enviar
E3". Esto **contradice una decisión de diseño ya enviada en 6.4b** y cambia la semántica del
`.catch(() => null)` actual. **Decisión CERRADA** (aprobada por el humano en el gate SDD, ver
`design.md` §D-condiciones-bloqueante): para US-023 las condiciones pasan a ser **requisito duro** del envío E3
(guarda que aborta con error de negocio y rollback si el PDF degrada a `null`), alineando el
comportamiento con la US y con la trazabilidad `DOCUMENTO` del GAP 1.

### GAP 3 — Reenvío manual de E3 (NUEVO)

6.4b bloquea el re-disparo con `E3_YA_ENVIADO` (409) y dejó el reenvío **fuera de alcance**.
US-023 §E3 ya enviado (idempotencia/reenvío) exige poder **reenviar E3** desde la ficha: nueva
`COMUNICACION` E3 con **`es_reenvio=true`** (respeta el UNIQUE parcial), **reutilizando los
documentos existentes** (factura + condiciones, sin regenerar ni duplicar `DOCUMENTO`), y
actualizando `cond_part_enviadas_fecha` al nuevo timestamp. Se diseña un **endpoint/caso de uso
dedicado** de reenvío E3 (espejo de `ReenviarLiquidacionUseCase` de E4), **NO** se reutiliza el
endpoint "enviar señal". **Toca el contrato API** (nuevo endpoint) → dueño: `contract-engineer`.

## Alcance y no-alcance

- **En alcance**: GAP 1 + GAP 2 + GAP 3, con su spec-delta, TDD, backend, contrato del nuevo
  endpoint de reenvío, y (si aplica) UI del botón "Reenviar E3".
- **Fuera de alcance**: registro de la firma del cliente (US-024); firma digital (solo diseñado);
  cualquier cambio en el enum de estados, en la tabla `DOCUMENTO`/`COMUNICACION`/`RESERVA`
  (no hay migraciones); el flujo automático post-commit por motor `DespacharEmailService`.

## Impacto en el contrato

Nuevo endpoint de **reenvío de E3** (GAP 3): `POST /reservas/{id}/facturas/senal/reenviar`
(espejo de `.../liquidacion/reenviar`), `@Roles('gestor')`, 200/404/409/502. El endpoint
existente `.../senal/enviar` **no cambia su firma**, aunque su **semántica de condiciones** se
endurece por el GAP 2 (deja de aceptar el envío degradado sin condiciones). Detalle en `design.md`.

## Trazabilidad

- **GAP 1**: US-023 §Happy Path (crear DOCUMENTO + AUDIT_LOG `crear`), §Reglas de Validación
  ("solo un DOCUMENTO de condiciones por reserva; si existe, se reutiliza"); `er-diagram.md §DOCUMENTO`.
- **GAP 2**: US-023 §Condiciones particulares del tenant no configuradas, §Reglas de negocio
  ("si no hay condiciones configuradas, el sistema no puede generar el documento y alerta");
  tensión con 6.4b `design.md §D-adjunto-condiciones`.
- **GAP 3**: US-023 §E3 ya enviado previamente (reenvío), §Fallo en el envío (reenvío manual);
  patrón US-028 `reenviar-liquidacion`; `COMUNICACION.es_reenvio` + UNIQUE parcial (US-045).
