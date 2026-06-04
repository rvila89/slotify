---
id: US-010
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Registrar resultado de visita — reserva inmediata (2.v → pre_reserva)

## 🆔 Metadatos
- ID: US-010
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** registrar que la visita se realizó y el cliente quiere reservar inmediatamente, disponiendo de todos los datos necesarios, y transicionar directamente a pre_reserva
**Para** ahorrar los pasos intermedios de 2.b cuando el cliente ha decidido en el acto, iniciando el proceso de presupuesto sin dilación

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-08 (FA-01 — reserva inmediata)
- Entidades implicadas: RESERVA, FECHA_BLOQUEADA, AUDIT_LOG
- Dolor(es) que resuelve: D2 (conversión directa visible en pipeline), D3 (transición clara, sin paso intermedio innecesario), D6 (facilita cierre inmediato y arranque de facturación)
- Automatización relacionada: A2 (Gestor activa pre-reserva → PDF presupuesto en borrador + E2) se dispara desde UC-14, no directamente desde esta historia. Esta historia solo ejecuta la transición de estado y el bloqueo
- Email relacionado: ninguno propio. E2 (presupuesto adjunto) se dispara desde UC-14/US-XXX al generar el presupuesto formal en el área "Pre-reserva y Presupuestos"
- Reglas de negocio:
  - La RESERVA debe estar en sub_estado = '2v'
  - La transición directa a pre_reserva requiere datos obligatorios completos: fecha_evento, duracion_horas, tipo_evento, num_adultos_ninos_mayores4, y datos fiscales de CLIENTE (dni_nif, direccion, codigo_postal, poblacion, provincia) — mismos requisitos que UC-14
  - `visita_realizada` = true
  - La RESERVA pasa a estado = 'pre_reserva'; sub_estado queda NULL (pre_reserva no tiene sub_estado de consulta)
  - `ttl_expiracion` = now + TENANT_SETTINGS.ttl_prereserva_dias (default 7 días)
  - La fila de FECHA_BLOQUEADA actualiza: tipo_bloqueo = 'blando', ttl_expiracion = nuevo valor (7 días)
  - Si había cola activa (RESERVA en '2d' con consulta_bloqueante_id = esta reserva): se vacía atómicamente (todas pasan a sub_estado = '2y', posicion_cola = NULL, consulta_bloqueante_id = NULL), igual que al activar pre_reserva por UC-14 (A16)
  - La transición completa (RESERVA + FECHA_BLOQUEADA + vaciado de cola) es atómica
- Supuestos: el cliente ha confirmado su decisión en el acto y el gestor tiene todos los datos necesarios en ese momento (o los introduce en el mismo formulario de registro del resultado)
- Dependencias: US-008 (RESERVA en '2v'). Datos completos de CLIENTE (dni_nif, datos fiscales). US-001 (sesión activa). La generación del presupuesto PDF y el envío de E2 se delegan a UC-14
- Notas de alcance:
  - La generación del presupuesto PDF, el envío de E2 y el flujo completo de UC-14 son responsabilidad del área "Pre-reserva y Presupuestos". Esta historia cubre exclusivamente la transición de estado y el bloqueo
  - El vaciado de cola (A16) es parte de esta transacción atómica, igual que en US-007 (2.c) y el flujo de UC-14

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — datos completos, sin cola
- **Dado** que el Gestor abre la ficha de una RESERVA en sub_estado = '2v' con todos los datos obligatorios completos en RESERVA y CLIENTE (fecha_evento, duracion_horas, tipo_evento, num_adultos_ninos_mayores4, dni_nif, direccion, codigo_postal, poblacion, provincia)
  **Cuando** el gestor selecciona "Registrar resultado" → "Cliente quiere reservar ahora"
  **Entonces** la RESERVA actualiza: visita_realizada = true, estado = 'pre_reserva', sub_estado = NULL, ttl_expiracion = now + TENANT_SETTINGS.ttl_prereserva_dias

- **Dado** que la RESERVA ha pasado a pre_reserva
  **Cuando** el sistema completa la transición
  **Entonces** la fila de FECHA_BLOQUEADA con reserva_id = esta reserva actualiza: tipo_bloqueo = 'blando', ttl_expiracion = RESERVA.ttl_expiracion (7 días)

- **Dado** que la transición ha completado
  **Cuando** el sistema registra la operación
  **Entonces** se registra en AUDIT_LOG con accion = 'transicion', entidad = 'RESERVA', datos_anteriores.sub_estado = '2v', datos_nuevos.estado = 'pre_reserva', datos_nuevos.sub_estado = NULL, datos_nuevos.visita_realizada = true

### 🎯 Happy Path — con cola activa
- **Dado** que la RESERVA en '2v' es consulta_bloqueante de N consultas en sub_estado '2d' (con consulta_bloqueante_id = id de esta reserva)
  **Cuando** el gestor transiciona a pre_reserva
  **Entonces** en la misma transacción atómica, todas las RESERVA con consulta_bloqueante_id = esta reserva y sub_estado = '2d' actualizan: sub_estado = '2y', posicion_cola = NULL, consulta_bloqueante_id = NULL

- **Dado** que la cola ha sido vaciada (mecánica A16)
  **Cuando** el sistema finaliza la transacción
  **Entonces** no hay RESERVA en sub_estado '2d' con consulta_bloqueante_id apuntando a la reserva transitada; el AUDIT_LOG registra las actualizaciones de las consultas vaciadas

### ⚠️ Flujos Alternativos y Edge Cases

#### FA: Datos obligatorios incompletos — transición bloqueada
- **Dado** que la RESERVA en '2v' tiene datos obligatorios incompletos (p. ej. falta dni_nif del CLIENTE)
  **Cuando** el gestor intenta la transición a pre_reserva
  **Entonces** el sistema muestra los campos faltantes y bloquea la transición; la RESERVA permanece en sub_estado '2v' sin ningún cambio
- Comportamiento del sistema: la misma validación que UC-14 FA-01; el formulario puede permitir completar los datos en el mismo paso antes de confirmar

#### FA: RESERVA no en 2.v
- **Dado** que la RESERVA no está en sub_estado = '2v'
  **Cuando** el gestor intenta registrar "reserva inmediata"
  **Entonces** el sistema rechaza la acción con error de validación; la RESERVA no se modifica

#### FA: Cola vacía — transición igualmente válida
- **Dado** que la RESERVA en '2v' no tiene consultas en '2d' apuntando a ella
  **Cuando** el gestor transiciona a pre_reserva
  **Entonces** el sistema completa la transición correctamente; el vaciado de cola es una operación vacía (0 filas afectadas) y no genera error

### 🔒 Concurrencia / Race Conditions
- **Dado** que la transición a pre_reserva modifica RESERVA + actualiza FECHA_BLOQUEADA + vacía cola en una transacción
  **Cuando** otra transacción concurrente intenta insertar un nuevo bloqueo para la misma (tenant_id, fecha_evento) en FECHA_BLOQUEADA (nuevo lead solicitando la misma fecha)
  **Entonces** la restricción UNIQUE(tenant_id, fecha) en FECHA_BLOQUEADA garantiza que solo una fila puede existir para esa combinación; la transacción concurrente recibe violación de unicidad — no puede haber doble bloqueo (D4)

- **Dado** que el vaciado de cola (2.d → 2.y) es parte de la misma transacción
  **Cuando** otra transacción concurrente intenta modificar el posicion_cola de una consulta en '2d' de esa misma cola
  **Entonces** el bloqueo de fila (FOR UPDATE) garantiza que el vaciado y la modificación concurrente no producen un estado inconsistente; una de las dos transacciones espera o falla controladamente

### 🚫 Reglas de Validación
- sub_estado debe ser '2v' para iniciar la transición
- Datos obligatorios de UC-14: fecha_evento, duracion_horas, tipo_evento, num_adultos_ninos_mayores4, datos fiscales de CLIENTE (dni_nif, direccion, codigo_postal, poblacion, provincia)
- La transición (RESERVA + FECHA_BLOQUEADA + cola) es atómica; no se permite éxito parcial
- pre_reserva no tiene sub_estado; sub_estado = NULL tras la transición
- El vaciado de cola opera aunque haya 0 consultas en '2d' (operación vacía = válida)

## 📊 Impacto de Negocio
- Impacto esperado: Reduce la fricción operativa cuando el cliente decide en el acto tras la visita, eliminando pasos intermedios (2.v → 2.b → pre_reserva) y acelerando el inicio de la fase de presupuesto y facturación (D6). Mantiene la consistencia del pipeline (D2) y libera la cola atómicamente (D13)
- Criterio de éxito: transición 2.v → pre_reserva completada atómicamente incluyendo FECHA_BLOQUEADA y vaciado de cola; 0 inconsistencias (ninguna RESERVA en '2d' con consulta_bloqueante_id apuntando a una RESERVA ya en pre_reserva)
