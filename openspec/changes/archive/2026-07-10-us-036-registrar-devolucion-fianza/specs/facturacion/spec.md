# facturacion (delta US-036)

## ADDED Requirements

### Requirement: Registro de la devolución de la fianza con derivación del estado final y auditoría

El sistema SHALL (DEBE) permitir al **Gestor** registrar en Slotify la **devolución de la fianza** que
ha ejecutado externamente en su banca, sobre una RESERVA en `estado = 'post_evento'` con
`fianza_status = 'cobrada'` y `CLIENTE.iban_devolucion IS NOT NULL`, indicando `importe_devuelto` y
`fecha_cobro` (la fecha real del abono). En una **única unidad transaccional atómica**, el sistema
SHALL (DEBE): establecer `RESERVA.fianza_devuelta_eur = importe_devuelto` y
`RESERVA.fianza_devuelta_fecha = fecha_cobro`; **derivar** y establecer el estado final de la fianza
según el importe (`importe_devuelto == fianza_eur` ⇒ `fianza_status = 'devuelta'`; `importe_devuelto <
fianza_eur`, incluido `0,00 €`, ⇒ `fianza_status = 'retenida_parcial'`); y registrar `AUDIT_LOG` con
`accion = 'actualizar'`, `entidad = 'RESERVA'`, `datos_anteriores = {fianza_status: 'cobrada',
fianza_devuelta_eur: null, fianza_devuelta_fecha: null}` y `datos_nuevos = {fianza_status:
<devuelta|retenida_parcial>, fianza_devuelta_eur, fianza_devuelta_fecha}`. La derivación del estado
final es lógica de **dominio puro** y **no** la elige el Gestor. La acción **no** genera ninguna
FACTURA nueva (la FACTURA de tipo `fianza` ya existe desde US-030) y **no** dispara ningún email
automático (no hay código E asignado en §9.3). La acción se ejecuta bajo el contexto RLS del `tenant`
del Gestor autenticado (JWT), nunca cross-tenant. (Fuente: `US-036 §Historia`, `§Happy Path`,
`§Reglas de negocio`, `§Reglas de Validación`; UC-27 pasos 4–8; `er-diagram.md §RESERVA fianza`;
`CLAUDE.md §Multi-tenancy`.)

#### Scenario: Devolución completa deja la fianza en estado devuelta y audita

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = 'cobrada'`, `fianza_eur =
  1000.00`, `fianza_cobrada_fecha = 2026-05-15` y `CLIENTE.iban_devolucion = 'ES9121000418450200051332'`
- **WHEN** el Gestor registra `importe_devuelto = 1000.00` y `fecha_cobro = 2026-06-05`
- **THEN** el sistema deriva `fianza_status = 'devuelta'` (importe igual a la fianza cobrada)
- **AND** establece `RESERVA.fianza_devuelta_eur = 1000.00` y `RESERVA.fianza_devuelta_fecha = 2026-06-05`
- **AND** registra en `AUDIT_LOG` `accion = 'actualizar'`, `entidad = 'RESERVA'`,
  `datos_anteriores = {fianza_status: 'cobrada', fianza_devuelta_eur: null, fianza_devuelta_fecha: null}`,
  `datos_nuevos = {fianza_status: 'devuelta', fianza_devuelta_eur: 1000.00, fianza_devuelta_fecha: 2026-06-05}`

#### Scenario: El estado final se deriva del importe, no lo elige el Gestor

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1500.00`
- **WHEN** el Gestor registra `importe_devuelto = 1500.00`
- **THEN** el sistema deriva `fianza_status = 'devuelta'` sin que el Gestor seleccione el estado
- **AND** cualquier `importe_devuelto < 1500.00` derivaría `fianza_status = 'retenida_parcial'`

### Requirement: Devolución parcial o retención total deja la fianza en retenida_parcial con motivo

El sistema SHALL (DEBE), cuando `importe_devuelto < fianza_eur` (devolución parcial por desperfectos,
FA-01) o `importe_devuelto = 0,00 €` (retención total), derivar `fianza_status = 'retenida_parcial'`,
establecer `RESERVA.fianza_devuelta_eur = importe_devuelto` (`0,00 €` es un valor **válido**) y
`RESERVA.fianza_devuelta_fecha = fecha_cobro`, y **exigir** un **motivo de retención** (texto libre)
que SHALL (DEBE) quedar **persistido en el expediente de la RESERVA** (destino concreto —campo
`notas` vs. campo dedicado— fijado en el gate, `design.md §D-2`) y reflejado en `AUDIT_LOG`. En
`retenida_parcial`, la ausencia del motivo SHALL (DEBE) rechazar el registro con un error de
validación. (Fuente: `US-036 §FA-01`, `§Reglas de negocio` motivo de retención, `§Reglas de
Validación` retención total válida.)

#### Scenario: Devolución parcial por desperfectos deja la fianza en retenida_parcial (FA-01)

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1500.00`
- **WHEN** el Gestor registra `importe_devuelto = 1000.00`, `motivo_retencion = 'Daños en vajilla
  valorados en 500 €'` y `fecha_cobro = 2026-06-06`
- **THEN** el sistema deriva `fianza_status = 'retenida_parcial'`
- **AND** establece `RESERVA.fianza_devuelta_eur = 1000.00` y `RESERVA.fianza_devuelta_fecha = 2026-06-06`
- **AND** el motivo de retención queda persistido en el expediente de la RESERVA
- **AND** `AUDIT_LOG` registra `datos_nuevos = {fianza_status: 'retenida_parcial', fianza_devuelta_eur: 1000.00, ...}`

#### Scenario: Retención total (importe 0,00 €) también deja la fianza en retenida_parcial

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1000.00`
- **WHEN** el Gestor registra `importe_devuelto = 0.00` con un motivo de retención de toda la fianza
- **THEN** el sistema acepta `fianza_devuelta_eur = 0.00` como valor válido
- **AND** deriva `fianza_status = 'retenida_parcial'`

#### Scenario: Devolución parcial sin motivo de retención se rechaza

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1500.00`
- **WHEN** el Gestor registra `importe_devuelto = 1000.00` **sin** indicar un motivo de retención
- **THEN** el sistema rechaza el registro con un error de validación (motivo de retención requerido)
- **AND** no se modifica ningún campo de `RESERVA`

### Requirement: Validación del importe devuelto no superior a la fianza cobrada

El sistema SHALL (DEBE) validar, **antes de cualquier escritura**, que `importe_devuelto ≤
RESERVA.fianza_eur` (no se puede devolver más de lo cobrado) y que `importe_devuelto ≥ 0`. Si la
validación falla, el sistema DEBE **rechazar** el registro con un error de validación ("El importe a
devolver no puede superar la fianza cobrada"), **sin** modificar ningún campo de `RESERVA` y **sin**
crear `DOCUMENTO`. La comparación se realiza con precisión **decimal de 2 posiciones** (no coma
flotante). Esta validación es lógica de **dominio puro**. (Fuente: `US-036 §FA-02`, `§Reglas de
Validación`.)

#### Scenario: Importe superior a la fianza cobrada se rechaza (FA-02)

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1000.00`
- **WHEN** el Gestor introduce `importe_devuelto = 1500.00`
- **THEN** el sistema rechaza el registro con "El importe a devolver (1.500,00 €) no puede superar la
  fianza cobrada (1.000,00 €)"
- **AND** ningún campo de `RESERVA` se modifica y no se crea `DOCUMENTO`

### Requirement: Validación de la fecha de devolución no anterior a la fecha de cobro de la fianza

El sistema SHALL (DEBE) validar, **antes de cualquier escritura**, que `fecha_cobro` (la fecha real
del abono de la devolución) sea **≥ `RESERVA.fianza_cobrada_fecha`** (no se puede devolver antes de
haber cobrado la fianza). `fecha_cobro` es **obligatoria**. Si la validación falla, el sistema DEBE
**rechazar** el registro con un error de validación ("La fecha de devolución no puede ser anterior a
la fecha de cobro de la fianza"), sin modificar `RESERVA` ni crear `DOCUMENTO`. Esta validación es
lógica de **dominio puro**. (Fuente: `US-036 §FA-03`, `§Reglas de Validación`.)

#### Scenario: Fecha de devolución anterior al cobro de la fianza se rechaza (FA-03)

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_cobrada_fecha =
  2026-05-15`
- **WHEN** el Gestor introduce `fecha_cobro = 2026-05-10` (anterior al cobro de la fianza)
- **THEN** el sistema rechaza el registro con "La fecha de devolución no puede ser anterior a la fecha
  de cobro de la fianza (15/05/2026)"
- **AND** ningún campo de `RESERVA` se modifica

### Requirement: El justificante de la devolución es un DOCUMENTO opcional (tipo justificante_pago)

El sistema SHALL (DEBE) permitir adjuntar al registro de la devolución un **justificante** (imagen o
PDF de la transferencia), que se almacena como `DOCUMENTO` con `tipo = 'justificante_pago'`,
`reserva_id` de la RESERVA, `url`, `mime_type`, `nombre_archivo` y `tenant_id` correcto, creado en la
misma transacción y auditado con `accion = 'crear'`. El justificante es **recomendado pero no
bloqueante en MVP** (FA-04): si el Gestor **no** lo adjunta, la devolución se registra **igualmente**
(el `fianza_status` avanza al estado final derivado y los campos `fianza_devuelta_*` se establecen),
**no** se crea `DOCUMENTO`, y el sistema DEBE presentar una advertencia indicando que puede adjuntarse
más tarde desde la ficha de documentos de la RESERVA. (Fuente: `US-036 §Happy Path` documento,
`§FA-04`, `§Reglas de negocio`; reutiliza la entidad `DOCUMENTO` polimórfica de US-024/US-029/US-030.)

#### Scenario: Registro con justificante crea el DOCUMENTO tipo justificante_pago

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `fianza_eur = 1000.00`
- **WHEN** el Gestor registra `importe_devuelto = 1000.00`, `fecha_cobro = 2026-06-05` y adjunta el
  justificante PDF de la transferencia
- **THEN** se crea un `DOCUMENTO` con `tipo = 'justificante_pago'`, `reserva_id = <id>`,
  `mime_type = 'application/pdf'` y `url = <url del PDF subido>`
- **AND** `AUDIT_LOG` registra la creación del `DOCUMENTO`

#### Scenario: Registro sin justificante se permite con advertencia (FA-04)

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y el Gestor no tiene el PDF
  del justificante disponible
- **WHEN** el Gestor completa la devolución sin adjuntar justificante y confirma
- **THEN** el sistema registra la devolución igualmente (`fianza_status` avanza al estado final y
  `fianza_devuelta_eur` / `fianza_devuelta_fecha` quedan establecidos)
- **AND** no se crea ningún `DOCUMENTO`
- **AND** el sistema muestra la advertencia "⚠️ Devolución registrada sin justificante. Puedes
  adjuntarlo más tarde desde la ficha de documentos de la reserva."

### Requirement: Precondición triple de disponibilidad del registro de devolución

El sistema SHALL (DEBE) permitir el registro de la devolución **únicamente** cuando `RESERVA.estado =
'post_evento'` **Y** `RESERVA.fianza_status = 'cobrada'` **Y** `CLIENTE.iban_devolucion IS NOT NULL`.
Si falta cualquiera de las tres condiciones, el backend DEBE **rechazar** la acción con un error de
conflicto de estado (fuera de `post_evento` / fianza no cobrada / sin IBAN de devolución), **sin**
modificar `RESERVA` ni crear `DOCUMENTO`. El backend NO DEBE confiar en que la UI oculte la acción:
DEBE validar la precondición en el servidor. La UI DEBE, de forma complementaria, condicionar la
**visibilidad/habilitación** de la acción a que se cumplan las tres condiciones. (Fuente: `US-036
§Reglas de negocio` disponibilidad, `§Reglas de Validación`; dependencias US-034/US-030/US-035.)

#### Scenario: Fianza no cobrada rechaza el registro de devolución

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_status = 'recibo_enviado'` (fianza aún
  no cobrada)
- **WHEN** se intenta registrar una devolución sobre esa RESERVA
- **THEN** el sistema rechaza la acción como conflicto de estado (fianza no cobrada)
- **AND** ningún campo de `RESERVA` se modifica y no se crea `DOCUMENTO`

#### Scenario: Sin IBAN de devolución rechaza el registro

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'` y `CLIENTE.iban_devolucion IS
  NULL`
- **WHEN** se intenta registrar una devolución sobre esa RESERVA
- **THEN** el sistema rechaza la acción (falta el IBAN de devolución del cliente)
- **AND** ningún campo de `RESERVA` se modifica

#### Scenario: Registro fuera de post_evento se rechaza como conflicto de estado

- **GIVEN** una RESERVA cuyo `estado ≠ 'post_evento'` (p. ej. `evento_en_curso`)
- **WHEN** se intenta registrar una devolución sobre esa RESERVA
- **THEN** el sistema rechaza la acción como conflicto de estado
- **AND** ningún campo de `RESERVA` se modifica

### Requirement: Guarda contra el doble registro de la devolución e irreversibilidad del estado final

El sistema SHALL (DEBE), si `RESERVA.fianza_status ∈ {'devuelta', 'retenida_parcial'}` (la devolución
ya fue registrada), **rechazar** un nuevo intento de registro de devolución con un error informativo
("La devolución de la fianza ya está registrada") y **NO** modificar `RESERVA` ni crear un segundo
`DOCUMENTO`. La guarda se evalúa **dentro de la transacción** releyendo el estado de la RESERVA con
bloqueo de fila (`SELECT ... FOR UPDATE`) de PostgreSQL, de modo que dos peticiones concurrentes se
serializan y solo la primera registra la devolución; la segunda ve el estado final y aborta. La
serialización es del motor SQL (lock de fila), **nunca** mediante locks distribuidos (Redis/Redlock).
Una vez alcanzado `devuelta` o `retenida_parcial`, el estado **es final** y **no retrocede** a
`cobrada`: la acción es **irreversible** en MVP. (Fuente: `US-036 §Reglas de negocio` irreversible,
`§Reglas de Validación`; `CLAUDE.md §Regla crítica: bloqueo atómico`; `design.md §D-4`.)

#### Scenario: Segundo intento de registro sobre fianza ya devuelta se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'devuelta'` (la devolución ya fue registrada)
- **WHEN** el Gestor intenta registrar otra devolución
- **THEN** el sistema rechaza la acción con "La devolución de la fianza ya está registrada"
- **AND** no se modifica `RESERVA` ni se crea ningún `DOCUMENTO` adicional

#### Scenario: Dos registros de devolución concurrentes solo aplican uno

- **GIVEN** una RESERVA con `fianza_status = 'cobrada'` sobre la que llegan dos peticiones de registro
  de devolución concurrentes
- **WHEN** ambas transacciones intentan registrar la devolución a la vez
- **THEN** el bloqueo de fila (`SELECT ... FOR UPDATE`) serializa las transacciones: la primera aplica
  el estado final y la segunda ve un estado final y aborta
- **AND** la RESERVA queda con **un único** registro de devolución, sin doble aplicación
