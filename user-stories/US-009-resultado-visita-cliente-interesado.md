# 🧾 Historia de Usuario: Registrar resultado de visita — cliente interesado (2.v → 2.b)

## 🆔 Metadatos
- ID: US-009
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central), M2 — Calendario & Disponibilidad
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** registrar que una visita al espacio se ha realizado y el cliente ha confirmado su interés, devolviendo la consulta al sub-estado 2.b con un TTL fresco
**Para** que el bloqueo de fecha se reanude formalmente y el cliente reciba confirmación automática del plazo disponible para decidir

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-08 (flujo básico — cliente confirma interés)
- Entidades implicadas: RESERVA, FECHA_BLOQUEADA, COMUNICACION, AUDIT_LOG, TENANT_SETTINGS
- Dolor(es) que resuelve: D2 (pipeline actualizado tras la visita), D3 (transición clara 2.v → 2.b con TTL fresco), D9 (E7 automático elimina comunicación manual post-visita)
- Automatización relacionada:
  - A20: Día posterior a la visita sin marcar resultado → alerta al gestor (trigger que recuerda al gestor que debe registrar el resultado)
- Email relacionado: E7 — Confirmación de bloqueo post-visita (3 días). Automático
- Reglas de negocio:
  - La RESERVA debe estar en sub_estado = '2v'
  - Al registrar resultado "cliente interesado": `visita_realizada` = true
  - La RESERVA pasa a sub_estado = '2b'
  - `ttl_expiracion` = now + TENANT_SETTINGS.ttl_consulta_dias (default 3 días). Es un TTL "fresco", calculado desde el momento de la transición, no acumulado sobre el anterior
  - La fila de FECHA_BLOQUEADA con reserva_id = esta reserva actualiza su `ttl_expiracion` al mismo valor; tipo_bloqueo permanece 'blando'
  - Se envía email E7 automáticamente al cliente
  - La actualización de RESERVA y FECHA_BLOQUEADA es atómica (una única transacción de BD)
- Supuestos: la visita se ha celebrado (o el gestor decide registrar el resultado sin importar si la visita tuvo lugar exactamente en la fecha prevista)
- Dependencias: US-008 (debe existir una RESERVA en sub_estado = '2v' con visita_programada_fecha definida). US-001 (sesión activa)
- Notas de alcance: ninguna — este flujo está íntegramente ✅ Implementado. Los otros resultados de visita (reserva inmediata, descarte) son US-010 y US-011

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path
- **Dado** que el Gestor abre la ficha de una RESERVA con sub_estado = '2v' y visita_programada_fecha definida
  **Cuando** el gestor selecciona "Registrar resultado de visita" → "Cliente interesado"
  **Entonces** la RESERVA actualiza: visita_realizada = true, sub_estado = '2b', ttl_expiracion = now + TENANT_SETTINGS.ttl_consulta_dias

- **Dado** que la RESERVA ha actualizado sub_estado a '2b'
  **Cuando** el sistema completa la transición
  **Entonces** la fila de FECHA_BLOQUEADA con reserva_id = esta reserva actualiza ttl_expiracion = RESERVA.ttl_expiracion (nuevo valor); tipo_bloqueo permanece 'blando'

- **Dado** que FECHA_BLOQUEADA ha sido actualizada
  **Cuando** el sistema completa la transición
  **Entonces** se envía email E7 al cliente confirmando el bloqueo post-visita; se registra en COMUNICACION con codigo_email = 'E7', estado = 'enviado', reserva_id = esta reserva

- **Dado** que la transición ha completado
  **Cuando** el sistema registra la operación
  **Entonces** se registra en AUDIT_LOG con accion = 'transicion', entidad = 'RESERVA', datos_anteriores.sub_estado = '2v', datos_anteriores.visita_realizada = false, datos_nuevos.sub_estado = '2b', datos_nuevos.visita_realizada = true

### ⚠️ Flujos Alternativos y Edge Cases

#### FA: Gestor registra resultado antes de la fecha de visita
- **Dado** que la RESERVA está en sub_estado = '2v' y visita_programada_fecha > hoy (la visita aún no ha llegado en el calendario)
  **Cuando** el gestor registra "cliente interesado"
  **Entonces** el sistema permite la acción (visita_programada_fecha es informativa; no es una precondición de validación estricta); la transición procede normalmente
- Comportamiento del sistema: la fecha de visita se usa para calcular el TTL del bloqueo (A18/US-008) y para recordatorios (A19/A20), pero no bloquea el registro del resultado

#### FA-03 parcial: Visita no realizada — gestor desea reprogramar
- **Dado** que la RESERVA está en sub_estado = '2v' y la visita no se celebró (cliente no se presentó)
  **Cuando** el gestor decide reprogramar en lugar de registrar un resultado
  **Entonces** el gestor puede volver al flujo de US-008 (programar visita) si el nuevo fecha_visita sigue dentro del límite de TENANT_SETTINGS.max_dias_programar_visita desde la solicitud original; la RESERVA permanece en '2v' durante la reprogramación
- Comportamiento del sistema: "Reprogramar visita" reutiliza el flujo de US-008 desde sub_estado '2v'; si el límite de días ha expirado, el gestor debe extender el TTL primero (US-006) o dejar que expire (US-012)

#### FA: RESERVA no en 2.v — transición inválida
- **Dado** que la RESERVA no está en sub_estado = '2v'
  **Cuando** el gestor intenta registrar "cliente interesado"
  **Entonces** el sistema rechaza la acción con error de validación; la RESERVA no se modifica

#### FA: RESERVA en estado terminal
- **Dado** que la RESERVA está en un sub_estado terminal (2.x, 2.y, 2.z) o estado terminal (reserva_cancelada, reserva_completada)
  **Cuando** el gestor intenta registrar el resultado de visita
  **Entonces** el sistema rechaza la acción; los estados terminales son inmutables

### 🔒 Concurrencia / Race Conditions
- **Dado** que la transición (RESERVA → '2b' + FECHA_BLOQUEADA TTL fresco) debe ser atómica
  **Cuando** el barrido periódico de TTLs (US-012/A21) intenta expirar simultáneamente la misma RESERVA (el bloqueo de visita ha vencido — ttl_expiracion = día post-visita)
  **Entonces** la transacción que commitea primero tiene éxito; si US-012 llega primero, la RESERVA pasa a '2x' y el registro del resultado falla controladamente (la RESERVA ya no está en '2v'); si el registro del resultado llega primero, US-012 no encuentra la RESERVA candidata en '2v' y no actúa sobre ella; nunca hay estado intermedio (RESERVA en '2b' sin FECHA_BLOQUEADA actualizada)

### 🚫 Reglas de Validación
- sub_estado debe ser '2v' para iniciar la transición
- La transición a '2b' y la actualización de FECHA_BLOQUEADA son atómicas
- El TTL se calcula desde el momento de la transición (now + TENANT_SETTINGS.ttl_consulta_dias), no desde visita_programada_fecha
- El envío de E7 se registra en COMUNICACION; si falla el envío (proveedor externo), el error se registra en COMUNICACION.estado = 'fallido' sin revertir la transición de estado
- visita_realizada se establece a true en el momento de registrar cualquier resultado (también en US-010/US-011)

## 📊 Impacto de Negocio
- Impacto esperado: Cierra el ciclo de la visita de forma formal, dando al cliente un plazo claro para decidir (D3) y manteniendo el pipeline actualizado sin comunicación manual adicional (D2, D9)
- Criterio de éxito: 100 % de registros "cliente interesado" generan sub_estado '2b' + TTL fresco en FECHA_BLOQUEADA + E7 enviado, todo dentro de una transacción atómica
