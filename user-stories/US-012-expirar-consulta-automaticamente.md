# 🧾 Historia de Usuario: Expirar consulta automáticamente por TTL agotado

## 🆔 Metadatos
- ID: US-012
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central), M2 — Calendario & Disponibilidad
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** que `RESERVA.ttl_expiracion` < now y el estado/sub_estado de la RESERVA es activo con bloqueo (sub_estado ∈ {2.b, 2.c, 2.v} o estado = 'pre_reserva')
**Ejecuto** la transición al estado terminal correspondiente, la eliminación del bloqueo de fecha en FECHA_BLOQUEADA, y (si hay cola) la promoción automática del primer lead en espera
**Para** garantizar que ninguna fecha permanezca bloqueada indefinidamente sin justificación, preservando la disponibilidad real del espacio y el orden de la cola de espera sin intervención manual del gestor

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-09
- Entidades implicadas: RESERVA, FECHA_BLOQUEADA, AUDIT_LOG
- Dolor(es) que resuelve: D4 (fecha liberada automáticamente, sin riesgo de bloqueo crónico), D1 (pipeline limpio sin leads zombi), D13 (cola promovida automáticamente)
- Automatización relacionada:
  - A4: Día +3 en consulta.2.b sin respuesta (TTL agotado) → Liberar fecha + notificar gestor + promoción automática del primero en cola
  - A21: Día +1 post-visita (bloqueo de 2.v agotado) → Liberar fecha + pasar a 2.x + notificar gestor
  - A5: Día +7 en pre_reserva sin justificante de señal → Liberar fecha + cancelar reserva (→ reserva_cancelada) + notificar gestor
  - A21b: Día +7 desde solicitud sin programar visita (bloqueo de visita nunca establecido) → Expiración → 2.x
- Trigger: barrido periódico (cron job idempotente) que invoca endpoint interno protegido con autenticación service-to-service; lee todas las RESERVA con ttl_expiracion < now en los estados candidatos
- Email relacionado: ninguno en el catálogo E1-E8. Las notificaciones de expiración al cliente no tienen código E asignado en §9.3 y son 📐 Solo diseñado en MVP. La notificación al gestor es una alerta interna (dashboard/notificaciones)
- Reglas de negocio:
  - El barrido evalúa: `RESERVA.ttl_expiracion < now` AND (sub_estado ∈ {'2b', '2c', '2v'} OR estado = 'pre_reserva')
  - Mapa de transiciones terminales:
    - sub_estado = '2b' → sub_estado = '2x' (A4)
    - sub_estado = '2c' → sub_estado = '2x' (A4, mismo mecanismo)
    - sub_estado = '2v' → sub_estado = '2x' (A21)
    - estado = 'pre_reserva' → estado = 'reserva_cancelada', sub_estado = NULL (A5)
  - Para cada expiración: la fila de FECHA_BLOQUEADA con reserva_id = esta reserva se elimina
  - Si la RESERVA expirada tenía cola (sub_estado '2b' con RESERVA en '2d' apuntando a ella): en la misma transacción, la primera en cola (posicion_cola = 1) pasa a sub_estado = '2b' con ttl_expiracion = now + TENANT_SETTINGS.ttl_consulta_dias; se crea nueva fila en FECHA_BLOQUEADA para la promovida; el resto de la cola decrementa posicion_cola en 1 y actualiza consulta_bloqueante_id (mecánica A15)
  - Nota: 2.c no puede tener cola activa (la cola se vacía al entrar en 2.c). 2.v puede heredar cola si llegó a 2.v desde 2.b sin que la cola hubiera sido vaciada previamente
  - La operación es idempotente: si el cron ejecuta dos veces sobre la misma RESERVA ya en estado terminal, la segunda ejecución no hace nada
  - La transición + eliminación de FECHA_BLOQUEADA + (si aplica) promoción de cola es atómica por RESERVA procesada
  - 2.x y reserva_cancelada son estados terminales: inmutables tras la transición
  - El endpoint de barrido está protegido; no es accesible externamente (solo service-to-service)
- Supuestos: el cron job sigue el patrón "estado en fila + barrido periódico" descrito en AGENTS.md; la frecuencia de ejecución garantiza que el retraso máximo desde la expiración teórica hasta la expiración efectiva es acotado (sin comprometer consistencia)
- Dependencias: US-004/US-005/US-006/US-007/US-008 (crean RESERVA con ttl_expiracion). La mecánica de promoción de cola (cuando aplica) es la misma que UC-12 (área Cola de Espera, lote siguiente). US-001 no aplica (actor: Sistema)
- Notas de alcance:
  - Los emails al cliente notificando la expiración NO están en MVP (no tienen código E en §9.3); la comunicación al cliente sobre la expiración es responsabilidad manual del gestor si decide hacerla
  - A3 (recordatorio amable día +2 en 2.b) es 📐 Solo diseñado en MVP. Esta historia cubre solo la expiración final (A4/A5/A21), no los recordatorios previos
  - La notificación al gestor es una alerta interna del dashboard/sistema de notificaciones (no email al cliente)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — expiración en 2.b, sin cola (A4)
- **Dado** que una RESERVA tiene sub_estado = '2b' y ttl_expiracion < now y no tiene RESERVA en '2d' apuntando a ella
  **Cuando** el cron de barrido ejecuta el endpoint de expiración
  **Entonces** en una transacción atómica: la RESERVA actualiza sub_estado = '2x'; la fila de FECHA_BLOQUEADA con reserva_id = esta reserva se elimina; se registra en AUDIT_LOG con accion = 'transicion', datos_anteriores.sub_estado = '2b', datos_nuevos.sub_estado = '2x'

- **Dado** que la expiración ha completado
  **Cuando** el sistema procesa la notificación
  **Entonces** el gestor recibe una alerta interna: "Consulta [codigo] expirada. Fecha [fecha_evento] liberada."

### 🎯 Happy Path — expiración en 2.b, con cola activa (A4 + A15)
- **Dado** que una RESERVA con sub_estado = '2b' y ttl_expiracion < now es consulta_bloqueante de N consultas en '2d'
  **Cuando** el cron ejecuta la expiración
  **Entonces** en la misma transacción atómica:
  - RESERVA → sub_estado = '2x', FECHA_BLOQUEADA eliminada
  - Primera en cola (posicion_cola = 1) → sub_estado = '2b', ttl_expiracion = now + TENANT_SETTINGS.ttl_consulta_dias, posicion_cola = NULL, consulta_bloqueante_id = NULL
  - Nueva fila en FECHA_BLOQUEADA creada para la reserva promovida con tipo_bloqueo = 'blando', ttl_expiracion = ttl de la promovida
  - Resto de la cola: posicion_cola decrementado en 1, consulta_bloqueante_id = id de la promovida (nueva bloqueante)

### 🎯 Happy Path — expiración en 2.c (A4, sin cola posible)
- **Dado** que una RESERVA tiene sub_estado = '2c' y ttl_expiracion < now
  **Cuando** el cron ejecuta el barrido
  **Entonces** RESERVA actualiza sub_estado = '2x'; FECHA_BLOQUEADA eliminada; AUDIT_LOG registrado
  (nota: 2.c no tiene cola activa; la cola fue vaciada al transicionar a 2.c vía US-007)

### 🎯 Happy Path — expiración en 2.v (A21)
- **Dado** que una RESERVA tiene sub_estado = '2v' y ttl_expiracion < now (bloqueo hasta día post-visita agotado)
  **Cuando** el cron ejecuta el barrido
  **Entonces** RESERVA actualiza sub_estado = '2x'; FECHA_BLOQUEADA eliminada; si había cola heredada desde 2.b (posible), se ejecuta la promoción A15

### 🎯 Happy Path — expiración en pre_reserva (A5)
- **Dado** que una RESERVA tiene estado = 'pre_reserva' y ttl_expiracion < now (7 días sin justificante de señal)
  **Cuando** el cron ejecuta el barrido
  **Entonces** en una transacción atómica: RESERVA actualiza estado = 'reserva_cancelada', sub_estado = NULL; FECHA_BLOQUEADA eliminada; AUDIT_LOG registrado con datos_anteriores.estado = 'pre_reserva', datos_nuevos.estado = 'reserva_cancelada'

### ⚠️ Flujos Alternativos y Edge Cases

#### FA: Idempotencia — RESERVA ya en estado terminal
- **Dado** que el cron barrido encuentra una RESERVA con ttl_expiracion < now pero sub_estado ya es '2x' (expirada en una ejecución anterior)
  **Cuando** el cron intenta procesar la expiración nuevamente
  **Entonces** el sistema no realiza ninguna modificación (la RESERVA no está en los estados candidatos); no se generan registros duplicados en AUDIT_LOG; la operación es idempotente

#### FA: TTL extendido manualmente antes del barrido
- **Dado** que el gestor ha extendido el TTL de una RESERVA (US-006) antes de que el cron ejecute el barrido
  **Cuando** el cron evalúa la RESERVA
  **Entonces** ttl_expiracion ya no es < now; la RESERVA no se modifica (la extensión manual prevalece sobre la expiración automática)

#### FA: pre_reserva expirada sin cola
- **Dado** que una RESERVA en pre_reserva expira (al pasar a pre_reserva, la cola fue vaciada vía A16/US-007 o UC-14)
  **Cuando** el cron ejecuta la expiración
  **Entonces** RESERVA → reserva_cancelada + FECHA_BLOQUEADA eliminada; sin promoción de cola (imposible tener cola en pre_reserva)

#### FA: RESERVA expirada pero FECHA_BLOQUEADA ya eliminada (doble expiración parcial)
- **Dado** que un fallo previo eliminó la fila de FECHA_BLOQUEADA pero no actualizó el sub_estado de RESERVA
  **Cuando** el cron ejecuta el barrido y encuentra la RESERVA todavía en sub_estado = '2b' con ttl_expiracion < now
  **Entonces** el cron actualiza el sub_estado a '2x'; si no existe fila en FECHA_BLOQUEADA (ya eliminada), no genera error — la operación es idempotente respecto a la ausencia de la fila

### 🔒 Concurrencia / Race Conditions

#### RC-1: Doble ejecución del cron sobre la misma RESERVA
- **Dado** que dos instancias del cron intentan expirar simultáneamente la misma RESERVA (p. ej. por reinicio del proceso)
  **Cuando** ambas transacciones intentan actualizar sub_estado de '2b' a '2x'
  **Entonces** la primera transacción tiene éxito y actualiza sub_estado = '2x'; la segunda, al evaluar dentro de su propia transacción, no encuentra la RESERVA en sub_estado candidato ('2b') y no actúa — idempotencia garantizada sin efectos duplicados

#### RC-2: Expiración vs extensión manual concurrente
- **Dado** que el gestor intenta extender el TTL de una RESERVA (US-006) exactamente al mismo instante que el cron la expira
  **Cuando** ambas transacciones compiten sobre la misma RESERVA
  **Entonces** exactamente una tiene éxito: si la expiración commitea primero, la extensión falla controladamente (RESERVA ya en '2x', inmutable); si la extensión commitea primero, la expiración no encuentra la RESERVA como candidata (ttl_expiracion ya no < now) — nunca hay estado intermedio inconsistente

#### RC-3: Expiración vs nueva solicitud de bloqueo para la misma fecha
- **Dado** que la expiración elimina la fila de FECHA_BLOQUEADA liberando una fecha, y concurrentemente un nuevo lead solicita bloquear esa misma fecha
  **Cuando** la eliminación y la nueva inserción compiten en FECHA_BLOQUEADA
  **Entonces** ambas operaciones son correctas: o la fecha queda libre (expiración commitea primero) y luego puede bloquearse por el nuevo lead, o el nuevo lead no puede insertar todavía (fila existe hasta que la expiración commitea); la restricción UNIQUE(tenant_id, fecha) previene duplicados

### 🚫 Reglas de Validación
- Solo se procesan RESERVA con ttl_expiracion < now Y sub_estado ∈ {'2b', '2c', '2v'} O estado = 'pre_reserva'
- La operación es idempotente: si la RESERVA ya está en estado terminal, se omite sin error
- La transición + eliminación de FECHA_BLOQUEADA + promoción de cola (si aplica) son atómicas por RESERVA
- El endpoint de barrido requiere autenticación service-to-service; no es accesible desde el exterior
- 2.x y reserva_cancelada son inmutables tras la transición; ninguna operación posterior puede cambiarlos
- La promoción de cola (cuando aplica) sigue las mismas reglas que UC-12/A15

## 📊 Impacto de Negocio
- Impacto esperado: Garantiza que ninguna fecha quede bloqueada indefinidamente, preservando la disponibilidad real del espacio (D4) y manteniendo el pipeline limpio sin intervención manual del gestor (D1, D9). La promoción automática de la cola maximiza el aprovechamiento de fechas liberadas (D13)
- Criterio de éxito: 0 RESERVA con ttl_expiracion < now en estado activo (2.b/2.c/2.v/pre_reserva) más de [frecuencia_cron] minutos después de la expiración teórica; 100 % de expiraciones idempotentes (N ejecuciones del cron sobre la misma RESERVA = 1 sola transición registrada en AUDIT_LOG)
