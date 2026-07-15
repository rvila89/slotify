# Proposal — firma-condiciones-particulares-us024 (US-024)

> Change: `firma-condiciones-particulares-us024`.
> Branch: `feature/firma-condiciones-particulares-us024` (Step 0, casa con `feature/{change-name}`).
> US: **US-024** — "Registrar Firma de Condiciones Particulares".
> UC: **UC-19** (segundo flujo: registro de la firma; el primer flujo —generación y envío de E3—
> es US-023, ya en master).

## Por qué (contexto)

US-024 cierra el ciclo contractual de la confirmación: tras enviar en E3 la factura de señal y el
documento de condiciones particulares (US-023), el cliente firma (en papel o por email) y el
**Gestor sube la copia firmada** al sistema. Registrar la firma deja **constancia legal** de la
aceptación del contrato (D1) y actualiza el **estado de cumplimiento** de condiciones en la reserva,
visible en el pipeline (D3). Sin este flujo, la firma vive fuera del sistema (documentos físicos
sueltos, sin trazabilidad de si el cliente firmó).

**El grueso de la infraestructura YA EXISTE en master** (épico #6 de documentos + US-021 subida de
justificante + US-023 persistencia del DOCUMENTO de condiciones). Este change NO re-propone nada de
eso: define **un único flujo nuevo** —el registro de la firma— reutilizando el patrón de subida de
fichero (multipart), la entidad DOCUMENTO, el almacén de documentos y los campos `cond_part_*` que
ya están en el modelo.

## Qué reutiliza (NO se re-propone, sin migración)

- **Entidad `DOCUMENTO`** (`schema.prisma`) con `tipo/reservaId/tenantId/url/mimeType/nombreArchivo/
  tamanoBytes/fechaCreacion`; enum `TipoDocumento` **ya incluye `condiciones_particulares`**. La copia
  firmada se persiste como una **nueva fila** `DOCUMENTO` de ese tipo (US-023 persistió el original
  no firmado con el mismo tipo → conviven ambos). **No hay migración de enum ni de tabla.**
  (`er-diagram.md §3.15 DOCUMENTO`, `TipoDocumento`.)
- **Campos RESERVA** `cond_part_enviadas_fecha`, `cond_part_firmadas` (boolean), `cond_part_firmadas_fecha`
  ya existen en el modelo (`er-diagram.md §RESERVA`). **No hay migración.**
- **Subida y almacenamiento del fichero**: patrón `multipart/form-data` de US-021 `confirmar-senal`
  (mime whitelist `{image/jpeg, image/png, application/pdf}`, ≤ 10 MB, validación autoritativa en
  servidor) + `AlmacenDocumentosPort` (épico #6, adaptador `local` por env, clave con `tenant_id`).
  Se reutiliza el patrón; el fichero firmado se sube con una **clave nueva por reserva** (ver
  `design.md §D-almacenamiento`).
- **Puerto/adaptador de persistencia de `DOCUMENTO`**: US-023 introdujo un repositorio de `DOCUMENTO`
  (`buscarPorReservaYTipo` + `crear`) en la capability `documentos`. Se **reutiliza `crear`** para la
  fila de la copia firmada (ver `design.md §D-documento-repo`).
- **AUDIT_LOG** con `accion/entidad/datos_anteriores/datos_nuevos`, patrón vivo de todas las mutaciones.
- **Máquina de estados** declarativa (`maquina-estados.ts`): la firma **NO es una transición** (espejo
  de la prórroga de TTL de US-006, que también muta campos sin cambiar `estado`).

## Qué es NUEVO (alcance exacto de este change)

Un único flujo: **registrar la firma de las condiciones particulares**. Backend + contrato +
frontend.

### N1 — Endpoint de registro de firma (NUEVO — capability `confirmacion`)

`POST /reservas/{id}/condiciones-firmadas` (multipart, `@Roles('gestor')`). El Gestor sube la copia
firmada. En una **única transacción atómica** (bajo RLS del tenant del JWT), all-or-nothing:

1. **Guardas de servidor** (autoritativas, antes de mutar):
   - `RESERVA.cond_part_enviadas_fecha` **no nulo** (E3 enviado en US-023). Si es nulo → 409/422
     "Las condiciones particulares no han sido enviadas al cliente aún"; sin efectos.
   - `RESERVA.estado ∈ {reserva_confirmada, evento_en_curso, post_evento}`. Si es terminal
     (`reserva_completada`, `reserva_cancelada`) o cualquier otro → 422 "No se puede registrar la
     firma en una reserva en estado terminal"; sin efectos.
   - Fichero presente, `mimeType ∈ {image/jpeg, image/png, application/pdf}`, tamaño ≤ 10 MB. Si no →
     422 (formato no permitido / tamaño excedido / fichero ausente); no se crea DOCUMENTO ni se muta
     RESERVA.
2. **Sube** el fichero firmado por `AlmacenDocumentosPort.subir(bytes, clave)` (clave por reserva).
3. **Crea una nueva fila `DOCUMENTO`** con `tipo='condiciones_particulares'`, `reservaId`, `tenantId`,
   `url` del fichero almacenado, `mimeType`, `nombreArchivo`, `tamanoBytes`. El DOCUMENTO original no
   firmado (US-023) **permanece**: no se borra ni se sobrescribe.
4. **Actualiza RESERVA**: `cond_part_firmadas = true`, `cond_part_firmadas_fecha = now()`. **No
   transiciona `estado`** ni ningún sub-proceso.
5. `AUDIT_LOG accion='actualizar'`, `entidad='RESERVA'`, `datos_anteriores.cond_part_firmadas=false`,
   `datos_nuevos.cond_part_firmadas=true` + `datos_nuevos.cond_part_firmadas_fecha`.

### N2 — Doble registro (re-firma) permitido (NUEVO)

Si `cond_part_firmadas` **ya es `true`** (p. ej. subir una versión más legible), la operación **no se
rechaza**: crea **otra** fila `DOCUMENTO` `condiciones_particulares`, **actualiza**
`cond_part_firmadas_fecha` al nuevo timestamp, **mantiene** `cond_part_firmadas = true`, y **conserva
el histórico** (los documentos anteriores no se eliminan; el más reciente es el de referencia).
`datos_anteriores.cond_part_firmadas` será `true` en este caso. Es un **registro no idempotente por
diseño** (a diferencia del DOCUMENTO original de US-023): cada subida es una versión firmada nueva.

### N3 — Señal consultable de firma pendiente (FA-01, SIN cron)

La API expone `cond_part_firmadas` y `cond_part_firmadas_fecha` en la respuesta de la reserva para que
el frontend pueda **mostrar la alerta** "⚠️ Condiciones particulares pendientes de firma" cuando
`cond_part_firmadas = false`. La alerta es **informativa, no bloqueante**. El **disparo automático por
cron el día del evento** (FA-01 completo) es parte de **UC-23 (Iniciar Evento) y queda FUERA de este
lote** (ver `§Decisión de alcance FA-01`). Aquí solo se garantiza que la señal (flag + fecha) es
consultable.

### N4 — Frontend: acción "Registrar condiciones firmadas" (NUEVO)

En la ficha de la reserva:
- Acción "Registrar condiciones firmadas" con subida de fichero y feedback de validación
  (formato/tamaño), sobre las tres estados válidos.
- Mensaje cuando `cond_part_enviadas_fecha` es nulo: "Las condiciones particulares no han sido
  enviadas al cliente aún" (la acción no está disponible).
- Alerta visible "Condiciones particulares pendientes de firma" cuando `cond_part_firmadas = false`
  y la reserva está en un estado válido (señal de N3).
- Permite re-subir (N2) mostrando que ya hay una firma registrada.
- Responsive (mobile-first), regla dura del proyecto.

## Decisión de alcance FA-01 (explícita, para el Gate 1)

FA-01 de la US ("el día del evento con `cond_part_firmadas = false` el sistema emite una alerta al
gestor") tiene dos mitades:
- **La señal consultable** (flag + fecha en la reserva, alerta visible en la ficha) → **EN alcance**
  (N3 + N4).
- **El disparo automático por cron el día del evento** → **FUERA de alcance**. La propia US lo
  aclara (`§Automatización relacionada`, `§Notas de alcance`): "el disparo de la alerta automática
  por cron es parte de la lógica de UC-23 (Iniciar Evento, no cubierto en este lote)". No se crea
  ningún endpoint `/cron/...` ni barrido en este change (coherente con "barridos nuevos → endpoint
  dedicado" — aquí simplemente no toca).

## Alcance y no-alcance

- **En alcance**: N1 (endpoint de registro de firma) + N2 (re-firma) + N3 (señal consultable) + N4
  (UI), con spec-delta, TDD, backend, contrato del nuevo endpoint y UI.
- **Fuera de alcance**: el cron/barrido de la alerta el día del evento (UC-23); la firma digital con
  plataforma de e-signature (📐 solo diseñada); cualquier transición de estado (la firma no
  transiciona); cualquier migración de `DOCUMENTO`/`RESERVA`/enum (no hay migraciones); regenerar o
  borrar el DOCUMENTO original no firmado de US-023.

## Impacto en el contrato

**Nuevo endpoint**: `POST /reservas/{id}/condiciones-firmadas` (multipart/form-data, `@Roles('gestor')`),
respuestas 200 / 400 / 401 / 403 / 404 / 409 / 422. **Toca el contrato API** → dueño:
`contract-engineer` (en la fase de contrato, tras el Gate 1). La respuesta 200 devuelve la RESERVA con
`condPartFirmadas=true`, `condPartFirmadasFecha` y el DOCUMENTO firmado creado. El endpoint de lectura
de la reserva ya expone los campos `cond_part_*`.

## Trazabilidad

- **N1**: `US-024 §Happy Path` (crear DOCUMENTO firmado + `cond_part_firmadas=true` +
  `cond_part_firmadas_fecha` + AUDIT_LOG `actualizar`), `§Reglas de negocio`, `§Reglas de Validación`,
  `§Condiciones no enviadas`, `§Reserva en estado no esperado`, `§Formato de fichero no válido`; UC-19
  (segundo flujo); `er-diagram.md §RESERVA cond_part_*`, `§DOCUMENTO tipo=condiciones_particulares`;
  patrón multipart `US-021 confirmar-senal`.
- **N2**: `US-024 §Firma ya registrada — intento de doble registro`.
- **N3**: `US-024 §FA-01`, `§Automatización relacionada`, `§Notas de alcance`.
- **N4**: `US-024 §Historia`, `§FA-01`, `§Condiciones no enviadas`; `CLAUDE.md §Web responsive`.
