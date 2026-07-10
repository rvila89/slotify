# Change: us-036-registrar-devolucion-fianza

## Why

Cuando un evento ha finalizado (`RESERVA.estado = 'post_evento'`, provisto por **US-034**), hubo
**fianza cobrada** (`RESERVA.fianza_status = 'cobrada'`, provisto por **US-030**) y el cliente ya
aportó su **IBAN de devolución** (`CLIENTE.iban_devolucion IS NOT NULL`, provisto por **US-035**),
el **gestor** ejecuta la transferencia de devolución de la fianza **fuera de Slotify** (banca
electrónica). Hoy ese hecho —importe devuelto, fecha real del abono, motivo de una retención por
desperfectos y el justificante de la transferencia— **se pierde en Drive o en hilos de email**, de
modo que el sub-proceso de fianza queda con `fianza_status = 'cobrada'` al llegar al archivado y sin
evidencia del cierre en el mismo sistema donde se gestionó la reserva (dolores **D6** —cierre
trazable y centralizado del sub-proceso de fianza— y **D1** —estado final registrado en el
expediente para auditoría).

US-036 cierra ese sub-proceso: el gestor **registra en Slotify el hecho cumplido** de la
transferencia (importe devuelto, fecha real del abono y, opcionalmente, el justificante), y el
sistema, tras validar las reglas de negocio, deja la fianza en un **estado final** —`devuelta`
(devolución completa) o `retenida_parcial` (devolución parcial o retención total por desperfectos)—
persistiendo `fianza_devuelta_eur` y `fianza_devuelta_fecha`, adjuntando el justificante como
`DOCUMENTO (tipo = 'justificante_pago')` y registrando todo en `AUDIT_LOG`. Es el paso que
**UC-27 (pasos 4–8, FA-01)** modela como cierre del ciclo iniciado por la solicitud de IBAN (E5,
US-034) y su confirmación (E8, US-035). (Fuente: `US-036 §Historia`, `§Contexto de Negocio`,
`§Impacto de Negocio`; `use-cases.md` UC-27.)

- **La transferencia se ejecuta fuera de Slotify**: US-036 **no** ejecuta ninguna transferencia
  bancaria; **registra el hecho cumplido** que el gestor realizó en su banca. No hay integración
  bancaria en MVP. (`US-036 §Reglas de negocio`, `§Supuestos`.)
- **El estado final se deriva del importe, no lo elige el gestor**: `importe_devuelto = fianza_eur`
  ⇒ `fianza_status = 'devuelta'`; `importe_devuelto < fianza_eur` (incluido `0,00 €`) ⇒
  `fianza_status = 'retenida_parcial'`. La derivación es una **regla de dominio pura**, no un input
  libre. (`US-036 §Reglas de Validación`; enum `FianzaStatus` ya incluye `devuelta` y
  `retenida_parcial`.)
- **Validaciones de servidor previas a toda escritura**: `importe_devuelto ≤ fianza_eur` (no se
  devuelve más de lo cobrado; FA-02) y `fecha_cobro ≥ fianza_cobrada_fecha` (integridad temporal;
  FA-03). Si alguna falla, **ninguna** columna de `RESERVA` se modifica y no se crea `DOCUMENTO`.
  El backend **no confía** en la UI. (`US-036 §Reglas de Validación`, `FA-02`, `FA-03`.)
- **El justificante es recomendado pero no bloqueante en MVP (FA-04)**: si el gestor no adjunta el
  PDF/imagen, la devolución se registra igualmente con una advertencia (queda "pendiente de
  justificante") y **no** se crea `DOCUMENTO`. El justificante se puede adjuntar más tarde desde la
  ficha de documentos. (`US-036 §Reglas de negocio`, `FA-04`.)
- **La acción es irreversible una vez confirmada** y **no genera factura**: la FACTURA de tipo
  `fianza` y su recibo ya se generaron en US-030; la devolución solo registra los campos de
  `RESERVA` + el `DOCUMENTO` del justificante. (`US-036 §Notas de alcance`, `§Reglas de Validación`.)
- **No hay notificación automática al cliente**: no existe código E asignado en §9.3 para la
  devolución efectiva. El gestor puede enviar una comunicación manual (`COMUNICACION` con
  `codigo_email = manual`) desde la ficha si lo considera oportuno; US-036 **no** dispara ningún
  email automático. (`US-036 §Email relacionado`, `§Notas de alcance`.)

## What Changes

- **Extiende la capability existente `facturacion`** (dueña del sub-proceso de fianza: cobro
  US-030, recibo/liquidación US-027/US-028/US-029, PAGO y DOCUMENTO `justificante_pago`): se añaden
  `ADDED Requirements` para el **registro de la devolución de la fianza**. **No** se crean
  capabilities nuevas ni se toca `comunicaciones` (no hay email automático).
- **Endpoint de usuario nuevo** que expone la acción "Registrar devolución de fianza" del gestor
  sobre una RESERVA concreta (autenticado con **JWT de usuario**, no `X-Cron-Token`: es una acción
  manual). Solo disponible cuando `RESERVA.estado = 'post_evento'` **Y** `RESERVA.fianza_status =
  'cobrada'` **Y** `CLIENTE.iban_devolucion IS NOT NULL`; en cualquier otra combinación la acción
  se **rechaza** (conflicto de estado / fianza no cobrada / sin IBAN). La superficie exacta
  (verbo/ruta y si acepta el justificante en el mismo request multipart o por `justificante_doc_id`)
  la materializa el `contract-engineer` tras el gate; ver `design.md §D-5`.
- **Validaciones de servidor previas a toda escritura** (dominio puro): `importe_devuelto ≤
  fianza_eur` (FA-02) y `fecha_cobro ≥ fianza_cobrada_fecha` (FA-03). Un input inválido devuelve
  error de validación (`422`), **no** actualiza `RESERVA` y **no** crea `DOCUMENTO`.
- **Derivación del estado final** (regla de dominio pura): `importe_devuelto == fianza_eur` ⇒
  `fianza_status = 'devuelta'`; `importe_devuelto < fianza_eur` (incluido `0,00 €`) ⇒
  `fianza_status = 'retenida_parcial'`. `fianza_devuelta_eur = 0.00` es un valor válido (retención
  total).
- **Persistencia atómica** en una única transacción: `UPDATE RESERVA SET fianza_status`,
  `fianza_devuelta_eur`, `fianza_devuelta_fecha` (+ el motivo de retención cuando aplique, ver
  `design.md §D-2`); creación del `DOCUMENTO (tipo = 'justificante_pago')` si se adjuntó; y
  `AUDIT_LOG`. La guarda contra doble registro se evalúa **dentro de la transacción** releyendo
  `RESERVA.fianza_status` con `SELECT ... FOR UPDATE` (patrón validado en US-030), de modo que dos
  peticiones concurrentes se serializan y la segunda ve un estado final y aborta. **Sin locks
  distribuidos** (hook `no-distributed-lock`).
- **Motivo de retención en devolución parcial (FA-01)**: cuando `fianza_status =
  'retenida_parcial'`, el gestor debe indicar un **motivo de retención** (texto libre). Dónde se
  persiste (`RESERVA.notas` vs. campo auxiliar) es **DECISIÓN DE GATE** (`design.md §D-2`): el
  schema **no** tiene hoy un campo `motivo_retencion` dedicado, sí un `RESERVA.notas (Text)`.
- **Justificante opcional (FA-04)**: si se adjunta, se crea `DOCUMENTO (tipo = 'justificante_pago')`
  con `reserva_id`, `url`, `mime_type`, `tenant_id`, reutilizando la entidad polimórfica ya viva
  (US-024/US-029/US-030). Si no se adjunta, la devolución se registra igualmente con advertencia y
  **no** se crea `DOCUMENTO`.
- **AUDIT_LOG obligatorio**: `accion = 'actualizar'`, `entidad = 'RESERVA'`, `datos_anteriores =
  {fianza_status: 'cobrada', fianza_devuelta_eur: null, fianza_devuelta_fecha: null}`,
  `datos_nuevos = {fianza_status: <devuelta|retenida_parcial>, fianza_devuelta_eur, fianza_devuelta_fecha}`
  (+ motivo de retención si aplica); y `accion = 'crear'` para el `DOCUMENTO` del justificante si se
  adjunta.

## Impact

- **Specs afectadas**:
  - **`facturacion`** (extendida): `ADDED Requirements` para (1) el registro de la devolución sobre
    `RESERVA` con derivación del estado final y auditoría obligatoria; (2) la precondición triple de
    disponibilidad (`estado = post_evento` **Y** `fianza_status = cobrada` **Y** `iban_devolucion IS
    NOT NULL`); (3) las validaciones de importe (`≤ fianza_eur`) y fecha (`≥ fianza_cobrada_fecha`);
    (4) la devolución parcial / retención total con motivo (FA-01); (5) el justificante opcional como
    `DOCUMENTO (tipo = 'justificante_pago')` (FA-04); (6) la guarda contra doble registro con
    `SELECT ... FOR UPDATE` y la irreversibilidad del estado final.
  - **NO** se crean capabilities nuevas; **NO** se modifican `comunicaciones`, `pipeline`,
    `ficha-operativa`, `foundation`, `calendario`, `auth`, `dashboard`, `consultas`, `presupuestos`,
    `bloqueo-fecha`, `calculo-tarifa`, `confirmacion` ni `app-shell` / `pipeline-ui` (salvo lo que el
    `contract-engineer` decida para exponer el endpoint, dentro de la superficie de post-evento — a
    fijar en el gate).
- **Datos**: **ninguna entidad nueva**. `RESERVA.fianza_devuelta_eur` (`Decimal(10,2)?`),
  `RESERVA.fianza_devuelta_fecha` (`DateTime?`) y los valores de enum `FianzaStatus.devuelta` /
  `FianzaStatus.retenida_parcial` **ya existen** en el schema Prisma
  (`apps/api/prisma/schema.prisma`, model `Reserva`, enum `FianzaStatus`). El `DOCUMENTO` con
  `tipo = 'justificante_pago'` ya está en uso (US-029/US-030). **Posible migración**: solo si el gate
  decide un campo `motivo_retencion` dedicado en lugar de `RESERVA.notas` (`design.md §D-2`); si se
  reutiliza `notas`, **no hay migración**.
- **Contrato OpenAPI**: **un endpoint de usuario nuevo** para la acción del gestor (JWT). No hay
  endpoint de barrido/cron (no es un job de Sistema). El cliente HTTP del frontend se **regenera**
  desde el contrato (nunca a mano).
- **Multi-tenancy/RLS**: la acción se ejecuta **bajo el contexto RLS del tenant** del gestor
  autenticado (`tenant_id` del JWT); `RESERVA`, `CLIENTE`, `DOCUMENTO` y `AUDIT_LOG` operan en ese
  tenant. Nunca cross-tenant.
- **Bloqueo atómico de fecha**: **NO aplica**. US-036 no toca `FECHA_BLOQUEADA`, la cola ni el
  bloqueo atómico. No se introduce ningún lock distribuido (hook `no-distributed-lock`).
- **Concurrencia**: `concurrencia_crítica = true` a nivel de **guarda contra doble registro** de la
  devolución (dos peticiones concurrentes no deben producir dos devoluciones), resuelta con
  `SELECT ... FOR UPDATE` sobre la fila de RESERVA (patrón US-030), no con locks distribuidos. Se
  exigen tests de la guarda concurrente y de la máquina de estados de fianza (`cobrada → devuelta` /
  `cobrada → retenida_parcial`).
- **Frontend**: hay cambios de frontend (formulario de "Registrar devolución de fianza" en la ficha
  de post-evento, condicionado a la precondición triple; validaciones de importe/fecha; adjuntar
  justificante; advertencia FA-04; motivo de retención en parcial). Por tanto **aplica el paso E2E
  con Playwright MCP** (`step-N+3`).
- **Trazabilidad**: **US-036**, **UC-27 (pasos 4–8, FA-01, FA-02)**, dolores **D6**/**D1**; sin
  automatización Axx específica (acción manual); sin email automático (§9.3 no define E para la
  devolución efectiva). Reutiliza US-034 (estado `post_evento`), US-030 (`fianza_status = cobrada`,
  `fianza_eur`, `fianza_cobrada_fecha`, patrón de cobro/DOCUMENTO/guarda concurrente) y US-035
  (`CLIENTE.iban_devolucion`).
- **Fuera de alcance (out-of-scope / lista negra MVP — declaración explícita)** (de
  `US-036 §Notas de alcance`):
  - **Ejecución de la transferencia bancaria**: 📐. Se ejecuta fuera de Slotify; US-036 solo
    **registra el hecho cumplido**. No hay integración bancaria.
  - **Notificación automática al cliente de la devolución efectiva**: 📐. No hay código E en §9.3;
    el gestor envía email manual si procede.
  - **Estado de "IBAN inválido" en el modelo de RESERVA** (FA-02 de UC-27): 📐. Si la transferencia
    falla por IBAN erróneo, el gestor corrige el IBAN vía US-035 (FA-02) y repite la transferencia
    antes de registrar aquí; **no** hay estado nuevo.
  - **Nueva factura por la devolución**: 📐. La devolución **no** genera FACTURA; la de tipo `fianza`
    ya existe desde US-030.
  - **Reversión de la devolución ya confirmada**: 📐. La acción es **irreversible** en MVP.
