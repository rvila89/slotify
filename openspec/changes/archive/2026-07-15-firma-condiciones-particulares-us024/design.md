# Design — firma-condiciones-particulares-us024 (US-024)

Decisiones técnicas no triviales del registro de la firma de condiciones particulares. Cada decisión
cita el código/spec vivos que la fundamentan. Todas las funciones nombradas se escriben como **arrow
functions** (regla dura). El dominio no importa framework/infra (hook `no-infra-in-domain`).

## Grounding del código/modelo actual (verificado)

- **Enum `TipoDocumento`** ya incluye `condiciones_particulares` (`er-diagram.md §DOCUMENTO`,
  `schema.prisma`). **No hay migración de enum.**
- **`RESERVA.cond_part_firmadas` (boolean), `cond_part_firmadas_fecha` (timestamp),
  `cond_part_enviadas_fecha` (timestamp)** ya existen (`er-diagram.md §RESERVA`). US-023 fija
  `cond_part_enviadas_fecha = now()` y `cond_part_firmadas = false` al enviar E3. **No hay migración.**
- **Patrón multipart vivo (US-021)**: `POST /reservas/{id}/confirmar-senal`
  (`multipart/form-data`, campo binario, mime whitelist `{image/jpeg, image/png, application/pdf}`,
  ≤ 10 MB, validación autoritativa en servidor, crea `DOCUMENTO` en la misma tx).
- **Almacén de documentos (épico #6)**: `AlmacenDocumentosPort.subir(bytes, clave)` / `urlPublica(clave)`
  en dominio; adaptador `local` seleccionable por env, persiste en disco, clave con `tenant_id`.
- **Repositorio de `DOCUMENTO` (US-023)**: la capability `documentos` introdujo un puerto de dominio
  para persistir/buscar `DOCUMENTO` (`buscarPorReservaYTipo` idempotente + `crear`), tx-bound, con RLS.
- **AUDIT_LOG**: patrón `accion/entidad/datos_anteriores/datos_nuevos` con el usuario del Gestor.
- **Prórroga de TTL (US-006)**: precedente vivo de una mutación de campos de RESERVA que
  **NO es una transición** de máquina de estados y usa `AUDIT_LOG accion='actualizar'`.

---

## D-endpoint — Endpoint dedicado de registro de firma (NUEVO, no reutiliza subida de US-023)

**Decisión: un endpoint/caso de uso NUEVO y dedicado `POST /reservas/{id}/condiciones-firmadas`
(multipart), NO se reutiliza ni el endpoint de envío de E3 ni el de subida de justificante.**

- **Por qué nuevo y no reutilizar `confirmar-senal`**: `confirmar-senal` sube el **justificante de
  pago** (`tipo='justificante_pago'`) y **transiciona** `pre_reserva → reserva_confirmada`. La firma
  es semánticamente distinta (otro tipo de documento, otro momento del ciclo, sin transición) y válida
  en tres estados. Mezclar ambos en una ruta complicaría las guardas y violaría la separación por
  caso de uso vigente en el proyecto.
- **Por qué nuevo y no reutilizar `.../senal/enviar` (US-023)**: ese endpoint **genera y envía** el
  documento no firmado por email (E3); no sube ficheros del cliente. Es el flujo opuesto (salida vs.
  entrada de documento).
- **Forma del endpoint** (coherente con `confirmar-senal`): `POST /reservas/{id}/condiciones-firmadas`,
  `@Roles('gestor')`, `@HttpCode(200)`, `multipart/form-data` con un campo binario obligatorio
  (`condicionesFirmadas`), mime `{image/jpeg, image/png, application/pdf}`, ≤ 10 MB. Respuestas:
  200 (RESERVA con `condPartFirmadas=true`, `condPartFirmadasFecha`, DOCUMENTO firmado creado);
  400 validación de forma; 401/403 auth; 404 reserva inexistente/cross-tenant; **409** condiciones no
  enviadas (`CONDICIONES_NO_ENVIADAS`); **422** guarda de estado no válido / fichero ausente / formato
  o tamaño inválido. **Toca el contrato → `contract-engineer`** (fase de contrato, tras el Gate 1).
- **Nombre de ruta**: `condiciones-firmadas` (no `firma`) para dejar claro que registra la copia
  firmada, no una firma digital (que es 📐 solo diseñada, fuera de MVP).

**Alternativa descartada**: `PATCH /reservas/{id}` con el fichero como parte del cuerpo. Rechazada por
mezclar una acción específica de negocio (registro de firma con efectos y auditoría propios) con el
update genérico de la reserva; el proyecto usa endpoints de acción dedicados (`confirmar-senal`,
`.../senal/enviar`, `.../liquidacion/aprobar-enviar`).

**Nota sobre el código de estado de "condiciones no enviadas".** La US lo describe como que "la opción
no está disponible" (guarda de disponibilidad). Se propone **409** (`CONDICIONES_NO_ENVIADAS`) por ser
un conflicto con el estado del recurso (falta un prerequisito del flujo, E3), reservando **422** para
la guarda de estado terminal y la validación de fichero. **Punto a confirmar en el Gate 1** (ver
`§Cuestiones para el Gate 1`): si se prefiere unificar todo en 422, es un cambio trivial de contrato.

---

## D-almacenamiento — Clave de almacenamiento del fichero firmado (por reserva + versión)

**Decisión: el fichero firmado se sube con una clave por reserva que admite múltiples versiones, NO
con la clave fija por tenant del documento no firmado.**

- El documento **no firmado** de US-023 usa clave fija **`condiciones/{tenantId}.pdf`** (idéntico por
  tenant, se sobrescribe). La copia **firmada** es **por reserva** y puede tener **varias versiones**
  (re-firma, D-re-firma), así que necesita una clave distinta que no colisione entre reservas ni entre
  versiones. Propuesta: **`condiciones-firmadas/{tenantId}/{reservaId}/{timestamp-o-uuid}.{ext}`**
  (extensión derivada del mime). La clave incluye `tenant_id` (aislamiento) y `reserva_id`
  (agrupación), y un discriminador de versión para no sobrescribir versiones anteriores (histórico
  preservado, coherente con D-re-firma).
- La `url` almacenada en la fila `DOCUMENTO` es la que devuelve `AlmacenDocumentosPort.subir`.
- Reutiliza el adaptador `local` por env (persistencia en disco, sin credenciales cloud en tests).

**Alternativa descartada**: sobrescribir una clave fija `condiciones-firmadas/{tenantId}/{reservaId}`
en cada re-firma. Rechazada porque perdería el histórico de versiones firmadas que la US exige
conservar ("el documento anterior permanece en BD"). El registro `DOCUMENTO` ya conserva el histórico
en tabla; el binario también debe conservarse para que cada fila apunte a su fichero real.

---

## D-documento-repo — Reutilizar el repositorio de DOCUMENTO de US-023 (solo `crear`)

**Decisión: reutilizar el puerto de dominio de persistencia de `DOCUMENTO` (capability `documentos`,
US-023) llamando SOLO a `crear`; NO se usa `buscarPorReservaYTipo` (no hay idempotencia aquí).**

- La copia firmada **no es idempotente por reserva** (D-re-firma): cada registro crea una fila nueva.
  Por eso, a diferencia de US-023 (que buscaba antes de crear para no duplicar el documento no
  firmado), aquí se invoca directamente `crear({ reservaId, tenantId, tipo:'condiciones_particulares',
  url, mimeType, nombreArchivo, tamanoBytes })`.
- El puerto es **tx-bound**: la creación del `DOCUMENTO`, la actualización de `RESERVA` y el
  `AUDIT_LOG` se consolidan/revierten juntos en la misma unidad de trabajo (`tx + RLS`).
- **Hexagonal**: el use-case (`RegistrarFirmaCondicionesUseCase`, dominio/aplicación) depende solo de
  los puertos inyectados (repositorio de DOCUMENTO, almacén, repositorio de RESERVA, audit); Prisma y
  el renderizador/almacén quedan en `infrastructure/`.

**Nota**: la responsabilidad de persistir el `DOCUMENTO` firmado y actualizar la RESERVA vive en la
capability **`confirmacion`** (donde ya vive el flujo de justificante de US-021 y el estado de
`cond_part_*`), reutilizando el **puerto** de `documentos`. No se abre un requirement nuevo en
`documentos`: el puerto ya existe y su contrato no cambia.

---

## D-no-transicion — La firma actualiza campos, no transiciona estado (válida en 3 estados)

**Decisión: el registro de firma es una `accion='actualizar'`, NO una transición de la máquina de
estados; `RESERVA.estado` y los sub-procesos permanecen intactos.**

- Solo mutan `cond_part_firmadas` y `cond_part_firmadas_fecha`. Es el mismo patrón que la **prórroga
  de TTL de US-006** (`er-diagram.md`: "La operación **no es una transición de máquina de estados**").
- La operación es válida en `{reserva_confirmada, evento_en_curso, post_evento}`. En vez de añadir
  transiciones a `maquina-estados.ts`, se implementa una **guarda de precondición declarativa**
  (p. ej. `esEstadoValidoParaRegistrarFirmaCondiciones(estado)`) análoga a
  `esEstadoConBloqueoBlandoExtensible` de US-006, que acepta esos tres estados y rechaza el resto
  (terminales incluidos) con 422 sin efectos.
- `AUDIT_LOG accion='actualizar'`, `entidad='RESERVA'` (nunca `'transicion'`).

**Por qué modelarlo como guarda de precondición y no como transición**: la máquina de estados de
reserva modela cambios de `estado`/`sub_estado`; la firma no cambia ninguno. Meterla como transición
"a sí mismo" ensuciaría el grafo de 16+ transiciones y sus guardas. La guarda declarativa mantiene la
regla en estructura de datos (como el resto del proyecto) sin contaminar la máquina.

**Alternativa descartada**: añadir tres "transiciones no-op" (una por estado válido) a
`maquina-estados.ts`. Rechazada por introducir transiciones ficticias sin cambio de estado y romper la
semántica de la máquina.

---

## D-re-firma — Re-registro no idempotente que conserva histórico

**Decisión: cada registro de firma crea una fila `DOCUMENTO` nueva y actualiza
`cond_part_firmadas_fecha`; se conservan todas las versiones (no idempotente por diseño).**

- Si `cond_part_firmadas` ya es `true`, la operación **no se rechaza**: crea otra versión, actualiza la
  fecha, mantiene el flag en `true`, conserva el histórico de `DOCUMENTO` y de binarios (D-almacenamiento).
- `AUDIT_LOG` recoge `datos_anteriores.cond_part_firmadas` con su valor real (puede ser `true` en la
  re-firma), `datos_nuevos.cond_part_firmadas = true` + nueva `cond_part_firmadas_fecha`.

**Contraste con US-023**: el documento **no firmado** es único por reserva (idempotente, se reutiliza);
la copia **firmada** es versionable (no idempotente). Son dos filas `DOCUMENTO` con el mismo `tipo`
pero semánticas distintas; conviven sin conflicto porque la tabla no impone unicidad por
`(reserva_id, tipo)`.

---

## D-fa01-alcance — La alerta de firma pendiente: señal consultable SÍ, cron NO

**Decisión: US-024 entrega la señal consultable (flag + fecha en la reserva, alerta visible en la
ficha), pero NO el disparo automático por cron el día del evento.**

- La API expone `cond_part_firmadas`/`cond_part_firmadas_fecha`; el frontend muestra la alerta
  informativa no bloqueante cuando el flag es `false`.
- El **cron/barrido** que emite la alerta el día del evento es parte de **UC-23 (Iniciar Evento)** y
  la propia US lo declara fuera de este lote. Coherente con la nota del proyecto "barridos nuevos →
  endpoint dedicado": aquí simplemente **no se crea** ningún cron.

**Por qué esta partición**: la señal es barata y necesaria para la UI de US-024; el cron depende del
flujo de inicio de evento (UC-23), que evalúa las tres precondiciones (`pre_evento_status=cerrado`,
`liquidacion_status=cobrada`, `fianza_status=cobrada`) y aún no está implementado. Acoplar el cron aquí
adelantaría lógica de UC-23 sin sus precondiciones.

---

## Hexagonal / guardrails

- El dominio (`RegistrarFirmaCondicionesUseCase`, guarda de precondición, puertos) NO importa Prisma
  ni `@nestjs/*` (hook `no-infra-in-domain`). Adaptadores en `infrastructure/`.
- **Sin locks distribuidos** (no aplica bloqueo de fecha aquí; la firma no toca `FECHA_BLOQUEADA`).
- **RLS multi-tenant**: la reserva se carga bajo RLS (404 cross-tenant); `DOCUMENTO.tenant_id` y la
  clave de almacén incluyen el tenant activo del JWT.
- El **cliente HTTP del frontend se regenera** desde el contrato; nunca se edita a mano
  (hook `protect-generated-client`). El endpoint nuevo lo añade `contract-engineer`.
- **Frontend responsive** mobile-first (regla dura); acción y alerta funcionan en 390/768/1280.
- **Arrow functions** en todo el código nombrado; `components/` del frontend solo `.tsx`.

---

## Cuestiones para el Gate 1 (a confirmar por el humano)

1. **Código HTTP de "condiciones no enviadas"**: propuesto **409** (`CONDICIONES_NO_ENVIADAS`) por ser
   un prerequisito del flujo no cumplido, reservando 422 para la guarda de estado terminal y la
   validación de fichero. ¿Se prefiere unificar en 422? (Cambio trivial de contrato.)
2. **Nombre del campo multipart y de la ruta**: propuestos `condicionesFirmadas` y
   `POST /reservas/{id}/condiciones-firmadas`. ¿Se prefiere otro naming (p. ej. `.../firma-condiciones`)?
3. **Clave de almacenamiento versionada**: propuesta
   `condiciones-firmadas/{tenantId}/{reservaId}/{uuid}.{ext}` para conservar el histórico de binarios.
   ¿Conforme con guardar todas las versiones del binario, o basta con conservar solo las filas
   `DOCUMENTO` y sobrescribir el binario?
