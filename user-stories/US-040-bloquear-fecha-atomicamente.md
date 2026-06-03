# 🧾 Historia de Usuario: Bloquear Fecha Atómicamente

## 🆔 Metadatos
- ID: US-040
- Área funcional: Calendario y Disponibilidad
- Módulo: M2 — Calendario & Disponibilidad
- Prioridad: Crítica  (heredada de UC-30)
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** una solicitud de bloqueo de fecha originada por una transición de estado de RESERVA (creación con fecha, paso a 2.c/2.v/pre_reserva/reserva_confirmada)
**Ejecuto** la inserción o actualización atómica en `FECHA_BLOQUEADA` con restricción `UNIQUE(tenant_id, fecha)` dentro de una transacción `SELECT … FOR UPDATE`, configurando `tipo_bloqueo` (blando/firme) y `ttl_expiracion` según la fase de la reserva y los valores de `TENANT_SETTINGS`
**Para** garantizar que ninguna fecha puede quedar bloqueada por dos reservas distintas del mismo tenant de forma simultánea, eliminando el riesgo de doble reserva (D4)

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-30
- Entidades implicadas: `FECHA_BLOQUEADA`, `RESERVA`, `TENANT_SETTINGS`
- Dolor(es) que resuelve: D4 (riesgo de doble reserva — dolor crítico)
- Automatización relacionada: invocada por A1 (lead entra con fecha → bloqueo 2.b), A2 (activar pre_reserva → bloqueo 7d), A6 (confirmar señal → bloqueo firme), A18 (visita → bloqueo hasta día post-visita)
- Email relacionado: ninguno (el bloqueo es infraestructura; los emails los disparan los flujos que invocan el bloqueo)
- Reglas de negocio:
  - La garantía de no-doble-reserva reside en `UNIQUE(tenant_id, fecha)` a nivel de motor de BD (PostgreSQL), **no** en lógica aplicativa.
  - Toda mutación de bloqueo (crear, actualizar, actualizar TTL) usa `SELECT … FOR UPDATE` dentro de una transacción para serializar el acceso.
  - Mapa canónico de tipo y TTL según fase (AGENTS.md + use-cases §3 UC-30):
    - Sub-estado `2.b` → `tipo_bloqueo = 'blando'`, `ttl_expiracion = now() + TENANT_SETTINGS.ttl_consulta_dias`
    - Sub-estado `2.c` → extensión del bloqueo existente: `ttl_expiracion = ttl_expiracion + TENANT_SETTINGS.ttl_consulta_dias` (≥ actual)
    - Sub-estado `2.v` → `tipo_bloqueo = 'blando'`, `ttl_expiracion = visita_programada_fecha + 1 día`
    - `pre_reserva` → `tipo_bloqueo = 'blando'`, `ttl_expiracion = now() + TENANT_SETTINGS.ttl_prereserva_dias`
    - `reserva_confirmada` → `tipo_bloqueo = 'firme'`, `ttl_expiracion = NULL`
  - Si la fecha ya tiene bloqueo activo (registro en `FECHA_BLOQUEADA`), la transacción rechaza la operación con violación de unicidad determinista.
  - Los valores de TTL (`ttl_consulta_dias` = 3, `ttl_prereserva_dias` = 7 en el tenant piloto) vienen de `TENANT_SETTINGS`; no se hardcodean.
- Supuestos:
  - La operación de bloqueo es una función transaccional única compartida por todos los flujos que necesitan bloquear una fecha; no se implementa inline por cada transición.
  - El "upgrade" de bloqueo blando a firme al confirmar la reserva es un UPDATE del registro existente en `FECHA_BLOQUEADA`, no un DELETE+INSERT, para preservar la atomicidad.
- Dependencias: ninguna de implementación (operación fundacional que otras US invocan como servicio).
- Notas de alcance: UC-30 FA-01 menciona "ofrecer cola si 2.b" como consecuencia del rechazo. La oferta de cola la gestiona el flujo invocante (US-004 / UC-03), no esta historia. US-040 solo garantiza el rechazo atómico y propaga el error al llamador.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

#### Bloqueo blando en transición a 2.b
- **Dado** que existe una `RESERVA` en sub_estado `2.b` con `fecha_evento = D`, `tenant_id = T`, y no hay ningún registro en `FECHA_BLOQUEADA` para `(T, D)`
  **Cuando** el Sistema ejecuta la operación de bloqueo (tipo=blando, fase=2.b)
  **Entonces** se inserta un registro en `FECHA_BLOQUEADA` con `tenant_id = T`, `fecha = D`, `reserva_id` apuntando a la reserva, `tipo_bloqueo = 'blando'`, y `ttl_expiracion = now() + TENANT_SETTINGS.ttl_consulta_dias` (3 días por defecto)

#### Bloqueo firme en transición a reserva_confirmada
- **Dado** que existe un registro en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'` para la fecha D de la reserva
  **Cuando** la reserva transiciona a `reserva_confirmada` y el Sistema ejecuta el upgrade de bloqueo
  **Entonces** el registro de `FECHA_BLOQUEADA` queda con `tipo_bloqueo = 'firme'` y `ttl_expiracion = NULL`; el campo `reserva_id` permanece inalterado

#### Bloqueo en 2.v (visita programada)
- **Dado** que la `RESERVA` tiene `visita_programada_fecha = V` y transiciona a sub_estado `2.v`
  **Cuando** el Sistema ejecuta el bloqueo de visita
  **Entonces** `FECHA_BLOQUEADA.ttl_expiracion = V + 1 día` y `tipo_bloqueo = 'blando'`

#### TTL leído de TENANT_SETTINGS
- **Dado** que `TENANT_SETTINGS.ttl_consulta_dias = 5` (valor no por defecto)
  **Cuando** el Sistema ejecuta un bloqueo de tipo 2.b
  **Entonces** `FECHA_BLOQUEADA.ttl_expiracion = now() + 5 días` (no 3)

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: Fecha ya bloqueada por otra reserva
- **Dado** que ya existe un registro en `FECHA_BLOQUEADA` para `(tenant_id = T, fecha = D)` con una `reserva_id` distinta
  **Cuando** el Sistema intenta insertar un nuevo bloqueo para `(T, D)`
  **Entonces** la transacción falla con violación de `UNIQUE(tenant_id, fecha)`; ningún registro adicional es insertado; la segunda reserva permanece sin bloquear y el error se propaga al flujo invocante para que ofrezca entrada en cola si corresponde
- Comportamiento del sistema: `INSERT` rechazado por la restricción de unicidad del motor PostgreSQL; `ROLLBACK` de la transacción; error devuelto al servicio de dominio que invocó el bloqueo.

#### Extensión de TTL en 2.c sin cambiar tipo
- **Dado** que ya existe un bloqueo blando para `(T, D)` con `ttl_expiracion = now() + 1 día` (TTL próximo a vencer)
  **Cuando** la reserva transiciona a sub_estado `2.c` (pendiente invitados)
  **Entonces** el registro en `FECHA_BLOQUEADA` se actualiza con `ttl_expiracion = antiguo_ttl + TENANT_SETTINGS.ttl_consulta_dias`; el `tipo_bloqueo` permanece como `'blando'`
- Comportamiento del sistema: `UPDATE FECHA_BLOQUEADA SET ttl_expiracion = ...` dentro de la misma transacción serializada.

#### Bloqueo sobre una fecha pasada (anomalía de datos)
- **Dado** que `fecha_evento = D` es anterior a la fecha actual
  **Cuando** el Sistema recibe solicitud de bloqueo
  **Entonces** el bloqueo es rechazado antes de intentar la inserción; el error indica "fecha en el pasado"; no se toca `FECHA_BLOQUEADA`
- Comportamiento del sistema: validación de dominio previa a la transacción.

### 🔒 Concurrencia / Race Conditions (zona crítica — TDD primero)

#### Race condition: dos solicitudes simultáneas para la misma fecha
- **Dado** dos transacciones concurrentes `TX-1` y `TX-2` que intentan bloquear la misma fecha `D` para el mismo `tenant_id = T` (p. ej. dos formularios de alta enviados simultáneamente)
  **Cuando** ambas ejecutan `SELECT ... FOR UPDATE` + `INSERT INTO FECHA_BLOQUEADA(tenant_id, fecha, ...)` en la misma ventana temporal
  **Entonces** exactamente una transacción tiene éxito (1 fila insertada, confirmada con `COMMIT`) y la otra recibe una excepción de violación de `UNIQUE(tenant_id, fecha)` con `ROLLBACK` automático; el estado final de `FECHA_BLOQUEADA` contiene exactamente un registro para `(T, D)`; no hay doble reserva

#### Idempotencia del bloqueo firme
- **Dado** que ya existe un bloqueo firme para `(T, D)` y otra solicitud de bloqueo firme llega para la misma fecha (retry o bug del llamador)
  **Cuando** el Sistema ejecuta el upgrade de bloqueo firme
  **Entonces** si el `reserva_id` coincide, la operación es idempotente (UPDATE con mismos valores, sin error); si el `reserva_id` es distinto, se rechaza con violación de unicidad

### 🚫 Reglas de Validación
- `FECHA_BLOQUEADA.tipo_bloqueo` solo acepta los valores del enum: `'blando'` o `'firme'`.
- Si `tipo_bloqueo = 'firme'`, entonces `ttl_expiracion` **debe** ser `NULL`; el sistema lo impone en BD (check constraint recomendado).
- Si `tipo_bloqueo = 'blando'`, entonces `ttl_expiracion` **debe** ser no nulo y mayor que `now()`.
- El `tenant_id` del bloqueo debe coincidir con el `tenant_id` de la `RESERVA` referenciada; no se puede bloquear una fecha en nombre de un tenant diferente al de la reserva.
- La operación solo modifica `FECHA_BLOQUEADA`; no muta directamente los campos de `RESERVA` (la transición de estado de `RESERVA` es responsabilidad del flujo invocante).

## 📊 Impacto de Negocio
- Impacto esperado: eliminación del riesgo de doble reserva en condiciones de concurrencia real (dos gestores simultáneos, retry de red, duplicación de formulario). El motor de BD como última línea de defensa.
- Criterio de éxito: 0 casos de doble bloqueo confirmados en el banco de tests de concurrencia (test TDD con 2 workers simultáneos para la misma fecha en el mismo tenant → siempre 1 éxito + 1 error de unicidad).
