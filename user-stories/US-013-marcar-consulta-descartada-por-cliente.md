# 🧾 Historia de Usuario: Marcar consulta como descartada por cliente (→ 2.z)

## 🆔 Metadatos
- ID: US-013
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central), M2 — Calendario & Disponibilidad
- Prioridad: Media
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** marcar una consulta como descartada por el propio cliente, desde cualquier sub-estado no terminal
**Para** limpiar el pipeline, liberar la fecha bloqueada si la había, y reordenar o promover la cola si la consulta era bloqueante, manteniendo el historial completo de la consulta en el sistema

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-10
- Entidades implicadas: RESERVA, FECHA_BLOQUEADA, AUDIT_LOG
- Dolor(es) que resuelve: D2 (pipeline limpio, sin leads fantasma que distorsionan la visibilidad), D3 (estado terminal claro: 2.z = descartado explícitamente por el cliente), D4 (fecha liberada si había bloqueo)
- Automatización relacionada: A17 — Cliente pulsa "Salir de la cola" → consulta pasa a 2.z + reordenación de cola. En MVP no hay portal de cliente; A17 se mapea a la acción manual del gestor en nombre del cliente cuando este comunica su desistimiento
- Email relacionado: ninguno en el catálogo E1-E8. Esta acción no genera email automático al cliente en MVP
- Reglas de negocio:
  - La RESERVA puede estar en cualquier sub_estado no terminal: '2a', '2b', '2c', '2d' o '2v'
  - La RESERVA pasa a sub_estado = '2z' (descartada por cliente)
  - 2.z es un estado terminal: inmutable a partir de este punto
  - Si la RESERVA tenía bloqueo (sub_estados '2b', '2c', '2v'): la fila de FECHA_BLOQUEADA se elimina (fecha liberada)
  - Si la RESERVA estaba en '2b' y tenía cola activa (RESERVA en '2d' apuntando a ella): al liberarse la fecha, se ejecuta la promoción del primer elemento de cola (mecánica UC-12/A15), con creación de nueva fila en FECHA_BLOQUEADA para la promovida y reordenación del resto
  - Si la RESERVA estaba en '2d' (en cola): se elimina de la cola. El resto de RESERVA en '2d' con el mismo consulta_bloqueante_id decrementa posicion_cola en 1
  - Si la RESERVA estaba en '2a': solo se marca '2z'; no hay FECHA_BLOQUEADA que eliminar ni cola que reordenar
  - Si la RESERVA estaba en '2c': se marca '2z' + FECHA_BLOQUEADA eliminada; la cola ya fue vaciada al entrar en '2c' (no hay cola posible)
  - Si la RESERVA estaba en '2v': se marca '2z' + FECHA_BLOQUEADA eliminada; si había cola heredada (posible si llegó a '2v' desde '2b'), se ejecuta la promoción A15
  - El gestor puede registrar opcionalmente el motivo del descarte (RESERVA.notas)
  - La transición y todas sus consecuencias (FECHA_BLOQUEADA + reordenación/promoción de cola) son atómicas en una única transacción de BD
- Supuestos: el cliente ha comunicado explícitamente al gestor que no desea continuar con la consulta
- Dependencias: US-001 (sesión activa). Existe una RESERVA en sub_estado no terminal. No hay otras dependencias estrictas (el origen puede ser cualquier sub_estado)
- Notas de alcance: ninguna — este flujo está íntegramente ✅ Implementado. La distinción con US-011 (descarte tras visita, específico de sub_estado '2v') es que US-013 cubre el descarte desde cualquier sub_estado, como acción operativa general del gestor

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — RESERVA en 2.a (sin bloqueo ni cola)
- **Dado** que el Gestor abre la ficha de una RESERVA con sub_estado = '2a' (sin fecha bloqueada)
  **Cuando** el gestor selecciona "Marcar como descartada por cliente" (con o sin motivo opcional)
  **Entonces** la RESERVA actualiza sub_estado = '2z'; RESERVA.notas se actualiza con el motivo si se proporcionó; no hay fila en FECHA_BLOQUEADA que eliminar

- **Dado** que la transición ha completado
  **Cuando** el sistema registra la operación
  **Entonces** se registra en AUDIT_LOG con accion = 'transicion', entidad = 'RESERVA', datos_anteriores.sub_estado = '2a', datos_nuevos.sub_estado = '2z'

### 🎯 Happy Path — RESERVA en 2.b con bloqueo, sin cola
- **Dado** que la RESERVA tiene sub_estado = '2b' con fila activa en FECHA_BLOQUEADA y sin consultas en '2d' apuntando a ella
  **Cuando** el gestor la marca como descartada
  **Entonces** en la misma transacción atómica: RESERVA → sub_estado = '2z'; FECHA_BLOQUEADA con reserva_id = esta reserva eliminada; fecha queda disponible

### 🎯 Happy Path — RESERVA en 2.b con bloqueo y cola activa
- **Dado** que la RESERVA en '2b' es consulta_bloqueante de N consultas en sub_estado '2d'
  **Cuando** el gestor la marca como descartada
  **Entonces** en la misma transacción atómica:
  - RESERVA → sub_estado = '2z', FECHA_BLOQUEADA eliminada
  - Primera en cola (posicion_cola = 1) → sub_estado = '2b', ttl_expiracion = now + TENANT_SETTINGS.ttl_consulta_dias, posicion_cola = NULL, consulta_bloqueante_id = NULL
  - Nueva fila FECHA_BLOQUEADA creada para la promovida con tipo_bloqueo = 'blando', ttl_expiracion = ttl de la promovida
  - Resto de la cola: posicion_cola decrementado en 1, consulta_bloqueante_id = id de la promovida

### 🎯 Happy Path — RESERVA en 2.d (en cola de espera)
- **Dado** que la RESERVA tiene sub_estado = '2d' con posicion_cola = P y consulta_bloqueante_id = B
  **Cuando** el gestor la marca como descartada (A17 manual)
  **Entonces** en la misma transacción atómica:
  - RESERVA → sub_estado = '2z', posicion_cola = NULL, consulta_bloqueante_id = NULL
  - Todas las RESERVA en '2d' con el mismo consulta_bloqueante_id = B y posicion_cola > P decrementan posicion_cola en 1
  - La RESERVA bloqueante (consulta_bloqueante_id = B) no se modifica; la cola simplemente pierde un elemento

### 🎯 Happy Path — RESERVA en 2.c (con bloqueo, sin cola posible)
- **Dado** que la RESERVA tiene sub_estado = '2c' (la cola fue vaciada al entrar en '2c')
  **Cuando** el gestor la marca como descartada
  **Entonces** en la misma transacción: RESERVA → '2z'; FECHA_BLOQUEADA eliminada; no hay cola que reordenar (operación vacía sobre cola = válida)

### 🎯 Happy Path — RESERVA en 2.v (con bloqueo, posible cola heredada)
- **Dado** que la RESERVA tiene sub_estado = '2v'
  **Cuando** el gestor la marca como descartada
  **Entonces** RESERVA → '2z' + FECHA_BLOQUEADA eliminada; si había cola heredada, se ejecuta la promoción A15 igual que en el caso de '2b' con cola

### ⚠️ Flujos Alternativos y Edge Cases

#### FA: RESERVA en estado terminal — acción bloqueada
- **Dado** que la RESERVA está en un sub_estado terminal (2.x, 2.y, 2.z) o estado terminal (reserva_cancelada, reserva_completada)
  **Cuando** el gestor intenta marcarla como descartada
  **Entonces** el sistema rechaza la acción con error: "Esta consulta ya está en un estado terminal y no puede modificarse"
- Comportamiento del sistema: el botón "Marcar como descartada" está deshabilitado en UI para estados terminales; validación defensiva también en servidor

#### FA: Cola vacía al descartar desde 2.b
- **Dado** que la RESERVA en '2b' no tenía consultas en '2d' apuntando a ella
  **Cuando** se marca como descartada
  **Entonces** la transición completa sin error; la búsqueda de cola devuelve 0 resultados y no genera ninguna acción adicional

#### FA: Motivo de descarte no proporcionado
- **Dado** que el gestor no introduce motivo de descarte
  **Cuando** confirma la acción
  **Entonces** el sistema completa la transición normalmente; RESERVA.notas permanece sin cambios (o vacío si ya era NULL)

### 🔒 Concurrencia / Race Conditions

#### RC-1: Descarte vs barrido de TTLs concurrente
- **Dado** que el gestor marca la consulta como descartada exactamente al mismo instante que el cron de US-012 intenta expirarla (ttl_expiracion acaba de vencer)
  **Cuando** ambas transacciones compiten sobre la misma RESERVA
  **Entonces** la primera en commitear tiene éxito; la segunda no encuentra la RESERVA en sub_estado activo y no actúa; el resultado es coherente (RESERVA en '2z' o '2x', nunca en ambos simultáneamente)

#### RC-2: Descarte vs nueva solicitud de bloqueo para la misma fecha
- **Dado** que la eliminación de FECHA_BLOQUEADA libera una fecha, y concurrentemente un nuevo lead intenta bloquear esa misma fecha
  **Cuando** la eliminación y la nueva inserción compiten en FECHA_BLOQUEADA (con la promoción de cola si aplica)
  **Entonces** la restricción UNIQUE(tenant_id, fecha) garantiza que no puede haber dos filas para la misma (tenant_id, fecha); la secuencia es determinista: primero se elimina (dentro de la transacción de descarte), luego puede insertarse la nueva fila — nunca hay doble bloqueo (D4)

#### RC-3: Dos gestores descartan la misma consulta simultáneamente
- **Dado** que dos pestañas/sesiones del gestor intentan marcar la misma RESERVA como descartada al mismo tiempo
  **Cuando** ambas transacciones compiten
  **Entonces** la primera tiene éxito y la RESERVA pasa a '2z'; la segunda recibe un error controlado (la RESERVA ya está en '2z', estado terminal inmutable) y se muestra al gestor un mensaje informativo

### 🚫 Reglas de Validación
- sub_estado de origen debe ser '2a', '2b', '2c', '2d' o '2v' (cualquier sub_estado no terminal)
- 2.z es inmutable tras la transición
- La transición y todas sus consecuencias (FECHA_BLOQUEADA + cola) son atómicas
- Si sub_estado no tiene bloqueo asociado ('2a'), no se busca ni se intenta eliminar fila en FECHA_BLOQUEADA
- El motivo de descarte es opcional; su ausencia no bloquea la transición
- La reordenación de cola (si RESERVA en '2d') se limita a las RESERVA con el mismo consulta_bloqueante_id; no afecta a otras colas de otras fechas

## 📊 Impacto de Negocio
- Impacto esperado: Permite al gestor cerrar consultas de forma limpia cuando el cliente desiste (D2), sin dejar fechas bloqueadas innecesariamente (D4) ni posiciones de cola huérfanas (D13). El historial de la consulta permanece en RESERVA.sub_estado = '2z' para análisis de conversión
- Criterio de éxito: 100 % de descartes por cliente (desde cualquier sub_estado no terminal) completan atómicamente la transición a '2z', la liberación de FECHA_BLOQUEADA (cuando aplica) y la reordenación/promoción de cola (cuando aplica); 0 RESERVA en '2z' con fila activa en FECHA_BLOQUEADA; 0 RESERVA en '2d' con posicion_cola inconsistente tras el descarte
