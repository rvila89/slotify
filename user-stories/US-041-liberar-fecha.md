# 🧾 Historia de Usuario: Liberar Bloqueo de Fecha

## 🆔 Metadatos
- ID: US-041
- Área funcional: Calendario y Disponibilidad
- Módulo: M2 — Calendario & Disponibilidad
- Prioridad: Crítica  (heredada de UC-31)
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** una liberación de bloqueo de fecha (TTL agotado, consulta expirada/descartada o reserva cancelada)
**Ejecuto** la eliminación atómica del registro correspondiente en `FECHA_BLOQUEADA` y, si existe cola activa para esa fecha, disparo la promoción de la primera consulta en espera (delegando en la mecánica de UC-12 / US-018)
**Para** que la fecha quede disponible para nuevas reservas sin delay y el primer lead en cola sea promovido automáticamente, preservando las oportunidades comerciales (D4, D13)

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-31
- Entidades implicadas: `FECHA_BLOQUEADA`, `RESERVA`, `TENANT`
- Dolor(es) que resuelve: D4 (fechas perpetuamente bloqueadas = doble riesgo), D13 (leads en cola pierden oportunidad si la liberación no activa la promoción)
- Automatización relacionada:
  - A4: TTL agotado en `consulta.2.b` → liberar fecha + notificar gestor + promoción automática del primero en cola
  - A5: TTL agotado en `pre_reserva` → liberar fecha + cancelar reserva + notificar
  - A21: día post-visita sin resultado → liberar fecha + notificar gestor
- Email relacionado: ninguno directamente (el email al cliente lo genera el flujo que invoca la liberación: US-012 para expiración, US-013 para descarte)
- Reglas de negocio:
  - La liberación elimina el registro de `FECHA_BLOQUEADA` para `(tenant_id, fecha)` dentro de una transacción.
  - Tras la eliminación, el Sistema verifica si existe alguna `RESERVA` con `sub_estado = '2d'` y `consulta_bloqueante_id` apuntando a la reserva liberada. Si existe → delega en el mecanismo de promoción (US-018) dentro de la misma transacción.
  - Un bloqueo de tipo `'firme'` (reserva_confirmada) **solo** puede liberarse si la `RESERVA` ha transitado a un estado terminal (`reserva_cancelada`). No se puede liberar un bloqueo firme de una reserva activa.
  - La operación es idempotente: si no existe registro para `(tenant_id, fecha)`, la operación termina sin error (0 filas afectadas = éxito).
  - Los triggers de liberación son:
    1. TTL expirado detectado por el cron de barrido periódico (`ttl_expiracion < now()` en `FECHA_BLOQUEADA`).
    2. Consulta descartada explícitamente (US-013: 2.z) o salida de cola (US-020).
    3. Resultado de visita → descarte (US-011: 2.z).
    4. Reserva cancelada (estado `reserva_cancelada`, bloqueo firme convertido a liberación).
- Supuestos:
  - El cron de barrido periódico ejecuta el endpoint de expiración con idempotencia; varias ejecuciones del mismo barrido sobre la misma fecha expirada no producen efectos duplicados.
  - La promoción de cola (US-018) se delega como llamada dentro de la misma transacción de liberación o como evento inmediato post-commit. La consistencia eventual (post-commit) es aceptable si la cola permanece en sub_estado `2.d` hasta que la promoción completa.
- Dependencias:
  - Depende de que exista el bloqueo creado por US-040 (sin bloqueo previo no hay nada que liberar).
  - Dispara US-018 (promoción automática) si hay cola activa.
  - Es invocada por: US-012 (expiración automática), US-013 (descarte por cliente), US-011 (descarte post-visita), US-019 (promoción manual, que libera la bloqueante activa), y el flujo de cancelación de reserva confirmada.
- Notas de alcance: UC-31 incluye la promoción de cola como consecuencia directa. La mecánica de reordenación de cola y el email al cliente promovido están en US-018 (🔁 automática) — `📐 Solo diseñado` para los emails de cola. Esta historia solo garantiza que US-018 sea disparado; no redefine su lógica.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

#### Liberación por TTL agotado (bloqueo blando, sin cola)
- **Dado** que existe un registro en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'`, `ttl_expiracion < now()`, y no hay ninguna `RESERVA` con `sub_estado = '2d'` apuntando a esa reserva
  **Cuando** el cron de barrido periódico detecta el TTL expirado y ejecuta la liberación
  **Entonces** el registro se elimina de `FECHA_BLOQUEADA`; la fecha queda disponible (sin ningún bloqueo activo para ese `tenant_id`); no se dispara ninguna promoción de cola

#### Liberación por TTL agotado (bloqueo blando, con cola activa)
- **Dado** que la fecha D tiene bloqueo blando expirado y hay 2 reservas en `sub_estado = '2d'` con `consulta_bloqueante_id` apuntando a la reserva bloqueante
  **Cuando** el Sistema ejecuta la liberación
  **Entonces** se elimina el registro de `FECHA_BLOQUEADA` y se dispara la mecánica de promoción automática (US-018): la primera reserva en cola (`posicion_cola = 1`) pasa a `sub_estado = '2b'` con nuevo bloqueo blando de 3 días; las demás actualizan su `consulta_bloqueante_id` al nuevo bloqueante

#### Liberación por descarte explícito del gestor (bloqueo blando)
- **Dado** que el Gestor ha marcado una reserva como `2.z` (descartada por cliente) y la reserva tenía bloqueo blando activo
  **Cuando** el flujo de descarte (US-013) invoca la liberación
  **Entonces** el registro de `FECHA_BLOQUEADA` es eliminado; si hay cola, se dispara la promoción (US-018)

#### Liberación al cancelar una reserva confirmada (bloqueo firme)
- **Dado** que una `RESERVA` en estado `reserva_confirmada` (bloqueo firme) transiciona a `reserva_cancelada`
  **Cuando** el Sistema ejecuta la liberación del bloqueo firme
  **Entonces** el registro de `FECHA_BLOQUEADA` con `tipo_bloqueo = 'firme'` es eliminado; la fecha queda disponible; se dispara promoción de cola si existe

### ⚠️ Flujos Alternativos y Edge Cases

#### Liberación de fecha sin bloqueo activo (idempotencia)
- **Dado** que no existe ningún registro en `FECHA_BLOQUEADA` para `(tenant_id, fecha_evento)` de la reserva (ya fue liberado antes, o nunca se bloqueó)
  **Cuando** el Sistema ejecuta la operación de liberación
  **Entonces** la operación termina sin error (0 filas afectadas); el sistema registra en `AUDIT_LOG` la tentativa idempotente; no se lanza excepción
- Comportamiento del sistema: DELETE con 0 rows affected = éxito silencioso; garantiza que los retries del cron no generan errores.

#### Intento de liberar bloqueo firme sin cancelación de reserva
- **Dado** que existe un bloqueo firme para `(tenant_id, fecha)` y la `RESERVA` sigue en estado `reserva_confirmada` (activa)
  **Cuando** algún flujo intenta liberar el bloqueo sin haber transitado la reserva a `reserva_cancelada`
  **Entonces** la operación es rechazada; el bloqueo firme permanece intacto; se registra el intento en `AUDIT_LOG`
- Comportamiento del sistema: validación de dominio previa al DELETE; protege la integridad del bloqueo firme.

#### Barrido de TTLs con múltiples fechas expiradas simultáneamente
- **Dado** que el cron detecta N fechas con `ttl_expiracion < now()` en un mismo barrido
  **Cuando** el Sistema ejecuta la liberación en lote
  **Entonces** cada fecha se libera en una transacción independiente; el fallo de una liberación no bloquea las demás; todas las liberaciones exitosas disparan la promoción de cola si corresponde
- Comportamiento del sistema: transacciones independientes por fecha para minimizar el impacto de fallos parciales.

#### Cola reordenada correctamente tras liberación con múltiples consultas en espera
- **Dado** que hay 3 reservas en cola (`posicion_cola` = 1, 2, 3) para la fecha D
  **Cuando** el bloqueo de D expira y se ejecuta la liberación + promoción
  **Entonces** la reserva con `posicion_cola = 1` pasa a `2.b` y obtiene el bloqueo de D; la reserva con `posicion_cola = 2` queda con `posicion_cola = 1`; la de `posicion_cola = 3` queda con `posicion_cola = 2`; todos los `consulta_bloqueante_id` se actualizan al nuevo bloqueante
- Comportamiento del sistema: la reordenación de cola es responsabilidad de US-018; esta historia solo garantiza el trigger correcto.

### 🔒 Concurrencia / Race Conditions (zona crítica — TDD primero)

#### Race condition: dos liberaciones concurrentes de la misma fecha
- **Dado** dos ejecuciones concurrentes del cron de barrido (p. ej. restart + barrido en curso) que intentan liberar el mismo `(tenant_id, fecha)` simultáneamente
  **Cuando** ambas ejecutan `DELETE FROM FECHA_BLOQUEADA WHERE tenant_id = T AND fecha = D`
  **Entonces** una elimina el registro (1 row affected) y la otra obtiene 0 rows affected sin error; el estado final de `FECHA_BLOQUEADA` no tiene registro para `(T, D)`; la promoción de cola se dispara exactamente una vez (no dos veces); no hay doble promoción

#### Race condition: liberación concurrente con nuevo intento de bloqueo
- **Dado** que el TTL de la fecha D ha expirado y el cron inicia su liberación, mientras simultáneamente llega un nuevo lead que intenta bloquear D
  **Cuando** la liberación y el nuevo bloqueo ocurren en ventana solapada
  **Entonces** la transacción de liberación completa primero (DELETE + posible promoción de cola) y la nueva solicitud de bloqueo se resuelve con éxito (INSERT en `FECHA_BLOQUEADA`) o entra en cola si la promoción ya bloqueó D; no existe estado intermedio donde D quede doble-bloqueada

### 🚫 Reglas de Validación
- Solo se puede liberar un bloqueo de tipo `'firme'` si la `RESERVA` referenciada tiene `estado = 'reserva_cancelada'`; cualquier otro estado es rechazo.
- La operación de liberación **no** modifica directamente el `estado` ni el `sub_estado` de la `RESERVA`; esa transición la gestiona el flujo invocante (US-012, US-013, etc.).
- Si la liberación dispara la promoción de cola (US-018), la promoción debe completarse en la misma transacción o como paso inmediato y atómico post-liberación; no puede quedar en estado intermedio donde la fecha está libre pero la cola no ha sido notificada.
- Toda liberación exitosa queda registrada en `AUDIT_LOG` con `accion = 'eliminar'`, `entidad = 'FECHA_BLOQUEADA'`, y la causa de liberación (TTL / descarte / cancelación).

## 📊 Impacto de Negocio
- Impacto esperado: las fechas bloqueadas vuelven al mercado automáticamente al expirar el TTL, sin intervención manual del gestor. Los leads en cola son notificados (en MVP: el gestor los notifica manualmente; el email automático es `📐 Solo diseñado`). Elimina el riesgo de fechas permanentemente bloqueadas por consultas muertas.
- Criterio de éxito: en el banco de tests de concurrencia, 0 casos de doble promoción de cola (2 workers liberando simultáneamente → exactamente 1 promoción exitosa). Tasa de liberación automática por TTL: ≥ 99% de los casos sin intervención manual en el entorno de staging.
