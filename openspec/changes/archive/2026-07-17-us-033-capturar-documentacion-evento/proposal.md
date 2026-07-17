# Proposal — us-033-capturar-documentacion-evento (US-033)

> Change: `us-033-capturar-documentacion-evento`.
> Branch: `feature/us-033-capturar-documentacion-evento` (Step 0 ya satisfecho — la rama
> existe; NO se re-crea).
> US: **US-033** — "Gestor/Equipo captura la documentación obligatoria durante el evento".
> UC: **UC-24**. Automatización: **A30**. Módulo **M7** (Ficha operativa del Evento —
> Slotify Brief).

## Por qué (contexto)

US-033 centraliza en Slotify la documentación legal obligatoria del evento (foto DNI
anverso, foto DNI reverso y cláusula de responsabilidad firmada), que hoy vive dispersa en
hilos de email, WhatsApp y carpetas físicas (D10). El Gestor o el Equipo la suben el día del
evento desde una vista **mobile-first** (también usable en escritorio), con un **checklist
que refleja en tiempo real** qué piezas están completas. Deja **single source of truth** de
los documentos en la ficha de la reserva (D1) y **trazabilidad** de cada subida vía
`AUDIT_LOG` (A30, D9).

**El grueso de la infraestructura YA EXISTE en master** (épico #6 de documentos + US-021
subida de justificante + US-023/US-024 persistencia y firma del DOCUMENTO de condiciones).
Este change **NO re-propone nada de eso**: define **un flujo nuevo** —captura de la
documentación obligatoria del evento con checklist— reutilizando el patrón de subida
multipart, la entidad `DOCUMENTO`, el enum `TipoDocumento` (ya incluye `dni_anverso`,
`dni_reverso`, `clausula_responsabilidad`), el almacén de objetos durable
(`AlmacenDocumentosPort`) y el patrón `AUDIT_LOG`. **Sin migración de schema ni de enum**
(verificado en `schema.prisma`).

## Qué reutiliza (NO se re-propone, sin migración)

- **Entidad `DOCUMENTO`** (`schema.prisma` ~L603): `idDocumento / tenantId / reservaId? /
  tipo / nombreArchivo / url / mimeType / tamanoBytes? / fechaCreacion`. El enum
  `TipoDocumento` (~L139) **ya contiene** `dni_anverso`, `dni_reverso`,
  `clausula_responsabilidad`. **No hay migración de tabla ni de enum.** (`er-diagram.md
  §DOCUMENTO`.)
- **Patrón multipart de subida** (US-021): `POST /reservas/{id}/confirmar-senal`
  (`FileInterceptor`, `multipart/form-data`, mime whitelist `{image/jpeg, image/png,
  application/pdf}`, tamaño ≤ 10 MB, rechazo de fichero ausente, validación autoritativa en
  servidor, errores de dominio `FormatoNoPermitidoError` / `TamanoExcedidoError` / etc., crea
  `DOCUMENTO` en la misma transacción). Se **reutiliza el patrón** de controller/DTO/errores.
- **Almacén de objetos durable** (épico #6): puerto de dominio
  `AlmacenDocumentosPort.subir(bytes, clave)` / `obtener` / `urlPublica`, con adaptador
  `local` **durable a disco** seleccionable por env `ALMACEN_PROVIDER`. Es la vía correcta
  para persistir los bytes (preferible al almacén efímero del justificante). La clave incluye
  `tenant_id` (aislamiento).
- **`AUDIT_LOG`** con `accion / entidad / datos_anteriores / datos_nuevos`, patrón vivo de
  todas las mutaciones.
- **Máquina de estados** declarativa (`maquina-estados.ts`): la subida de documentación **NO
  es una transición** (no cambia `estado` ni sub-estados); es una guarda de precondición
  declarativa por estado (espejo del patrón de US-006/US-024).

## Qué es NUEVO (alcance exacto de este change)

Un flujo: **capturar la documentación obligatoria del evento con checklist en tiempo real**.
Backend + contrato + frontend.

### N1 — Endpoint de subida de un documento del evento (NUEVO — capability `documentacion-evento`)

`POST /reservas/{id}/documentos-evento` (multipart, `@Roles('gestor')`). El Gestor/Equipo sube
**un** documento indicando su `tipo` (`dni_anverso` | `dni_reverso` |
`clausula_responsabilidad`). En una **única transacción atómica** (bajo RLS del tenant del
JWT), all-or-nothing:

1. **Guardas de servidor** (autoritativas, antes de mutar):
   - `RESERVA.estado = evento_en_curso`. Cualquier otro estado → 422
     (`ESTADO_NO_PERMITE_DOCUMENTACION`) "La documentación del evento solo puede capturarse
     mientras el evento está en curso"; sin efectos.
   - `tipo ∈ {dni_anverso, dni_reverso, clausula_responsabilidad}`. Cualquier otro → 422
     (`TIPO_DOCUMENTO_NO_PERMITIDO`); sin efectos.
   - Fichero presente, `mimeType ∈ {image/jpeg, image/png, application/pdf}`, `tamanoBytes > 0`,
     tamaño ≤ 10 MB. Si no → 422 (fichero ausente / formato no permitido / archivo vacío o
     corrupto / tamaño excedido) con mensaje específico; no se crea `DOCUMENTO`.
2. **Sube** los bytes por `AlmacenDocumentosPort.subir(bytes, clave)` (clave por reserva +
   tipo + discriminador de versión, con `tenant_id`).
3. **Crea una nueva fila `DOCUMENTO`** con `tipo`, `reservaId`, `tenantId`, `url`, `mimeType`,
   `nombreArchivo`, `tamanoBytes`. **NO idempotente**: si ya existe un documento del mismo
   `tipo` para la reserva, se crea **otra** fila (histórico preservado; no se sobrescribe).
4. `AUDIT_LOG accion='crear'`, `entidad='DOCUMENTO'`, con `datos_nuevos` (tipo, reservaId, url,
   mimeType, tamanoBytes).
5. **Respuesta**: el DOCUMENTO creado + el **checklist actualizado** (los tres ítems con su
   estado completado/pendiente), para que el frontend refresque en tiempo real.

### N2 — Endpoint de checklist del evento (NUEVO — GET)

`GET /reservas/{id}/documentos-evento/checklist` (`@Roles('gestor')`). Devuelve el estado de
los tres tipos obligatorios para la reserva: cada ítem `{ tipo, completado, documento? }`
donde `completado = existe ≥ 1 DOCUMENTO de ese tipo+reserva` y `documento` es el **más
reciente** (por `fechaCreacion`) a efectos de referencia. Filtra por `tenant_id` del JWT
(RLS). Disponible mientras la reserva exista (la vista de checklist se pinta en la ficha; el
estado válido para subir es solo `evento_en_curso`, pero el checklist es consultable para
mostrar pendientes también en `post_evento`, coherente con FA-01).

### N3 — Re-subida no idempotente que conserva histórico (NUEVO)

Subir un **segundo** archivo del mismo `tipo` para la misma reserva **no se rechaza** ni
sobrescribe: crea **otra** fila `DOCUMENTO`; el checklist muestra el ítem como ✅ (basado en
"existe ≥ 1 documento del tipo") tomando el **más reciente** como referencia; los registros
anteriores **permanecen** en la tabla (trazabilidad). Es un registro **no idempotente por
diseño**, a diferencia del DOCUMENTO de condiciones de US-023 (que sí es único por reserva).

### N4 — Documentación incompleta NO bloquea el flujo (FA-01, informativo)

La documentación incompleta **no bloquea** la transición a `post_evento` (US-034): el checklist
puede quedar con ítems pendientes y el Gestor puede continuar. La alerta de documentación
pendiente es **informativa, no bloqueante**. US-033 **solo** garantiza que el checklist (señal
consultable, N2) refleja los pendientes; **no** implementa la transición a `post_evento` (es
US-034) ni ningún cron/barrido.

### N5 — Frontend: checklist mobile-first de documentación del evento (NUEVO)

En la ficha de la reserva (visible cuando `estado = evento_en_curso`):
- Vista de **checklist** con los tres ítems (DNI anverso, DNI reverso, cláusula de
  responsabilidad) y su estado ✅/pendiente, alimentada por el GET de N2.
- Acción de subida por ítem con captura desde cámara del móvil o selección de fichero, con
  **validación de formato en frontend antes de enviar** (JPEG/PNG/PDF) y feedback de error
  ("Formato no admitido. Por favor, usa JPEG, PNG o PDF."), además de la validación
  autoritativa del servidor (N1).
- Refresco en tiempo real del checklist tras cada subida (respuesta de N1 o refetch de N2).
- Permite re-subir un tipo ya completado (N3), mostrando que ya hay un documento registrado.
- **Responsive** mobile-first (regla dura del proyecto): funciona en 390 / 768 / 1280.

## Alcance y no-alcance

- **En alcance**: N1 (subida de documento del evento) + N2 (checklist GET) + N3 (re-subida no
  idempotente) + N4 (señal informativa no bloqueante) + N5 (UI checklist mobile-first), con
  spec-delta, TDD, backend, contrato de los nuevos endpoints y UI.
- **Fuera de alcance**: la transición a `post_evento` y su advertencia de documentación
  pendiente al finalizar el evento (US-034); cualquier cron/barrido; validación OCR o de
  legibilidad del contenido de los documentos; firma digital; cualquier migración de
  `DOCUMENTO`/`RESERVA`/enum (**no hay migraciones**); borrado o edición de documentos ya
  subidos.

## Impacto en el contrato

**Nuevos endpoints** (dueño: `contract-engineer`, en la fase de contrato tras el Gate 1):
- `POST /reservas/{id}/documentos-evento` (multipart/form-data, `@Roles('gestor')`) →
  201 / 400 / 401 / 403 / 404 / 422.
- `GET /reservas/{id}/documentos-evento/checklist` (`@Roles('gestor')`) →
  200 / 401 / 403 / 404.

El cliente HTTP del frontend se **regenera** desde el contrato; nunca se edita a mano
(hook `protect-generated-client`).

## Trazabilidad

- **N1**: `US-033 §Happy Path` (crear DOCUMENTO por tipo con `reserva_id`/`tenant_id`/`url`/
  `mime_type`/`tamano_bytes > 0` + `AUDIT_LOG`), `§Reglas de negocio`, `§Reglas de
  Validación`, `§Formato de archivo no admitido`, `§Archivo vacío o corrupto`; UC-24; A30;
  `er-diagram.md §DOCUMENTO`, `TipoDocumento`; patrón multipart `US-021 confirmar-senal`;
  `documentos` `AlmacenDocumentosPort`.
- **N2**: `US-033 §Happy Path` (checklist en tiempo real, tres ítems ✅), `§Reglas de
  Validación` (checklist = existe ≥ 1 DOCUMENTO por tipo + reserva).
- **N3**: `US-033 §Sustitución de un documento ya subido`.
- **N4**: `US-033 §FA-01 — Documentación incompleta al finalizar el evento` (no bloqueante).
- **N5**: `US-033 §Historia`, `§Acceso desde escritorio (no móvil)`, `§Formato de archivo no
  admitido`; `CLAUDE.md §Web responsive`.
