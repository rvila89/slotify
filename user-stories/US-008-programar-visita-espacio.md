# 🧾 Historia de Usuario: Programar visita al espacio (→ 2.v)

## 🆔 Metadatos
- ID: US-008
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central), M2 — Calendario & Disponibilidad
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** programar una visita al espacio para un cliente interesado y transicionar la consulta al sub-estado 2.v
**Para** dar tiempo formal al cliente para tomar una decisión presencial, bloqueando la fecha del evento hasta el día posterior a la visita y enviando confirmación automática al cliente

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-07
- Entidades implicadas: RESERVA, FECHA_BLOQUEADA, COMUNICACION, AUDIT_LOG, TENANT_SETTINGS
- Dolor(es) que resuelve: D2 (visibilidad del pipeline — estado diferenciado para visitas, visible en calendario), D3 (estado claro: 2.v indica que el lead está en fase de decisión presencial), D9 (E6 y recordatorio A19 automáticos eliminan seguimiento manual)
- Automatización relacionada:
  - A18: Gestor acepta solicitud de visita → RESERVA pasa a 2.v + bloqueo FECHA_BLOQUEADA hasta día post-visita + email E6 al cliente + recordatorio al gestor
  - A19: Día de la visita programada → recordatorio al gestor: "Hoy tienes visita con [cliente]"
  - A20: Día posterior a la visita sin marcar resultado → alerta al gestor: "Ayer tenías visita. ¿Se realizó?"
- Email relacionado: E6 — Confirmación de visita programada con fecha/hora (Automático)
- Reglas de negocio:
  - La RESERVA debe estar en sub_estado '2a', '2b' o '2c'. Consultas en cola (sub_estado = '2d') no pueden transicionar directamente a 2.v (UC-07 FA-01)
  - La fecha de visita debe ser futura (fecha_visita ≥ mañana) y dentro del límite de TENANT_SETTINGS.max_dias_programar_visita días desde hoy (default 7)
  - Para RESERVA en '2a': la fecha_evento debe estar definida antes de programar la visita
  - El bloqueo de FECHA_BLOQUEADA se extiende hasta el día posterior a la visita: `ttl_expiracion` = visita_programada_fecha + 1 día (23:59:59)
  - Si la RESERVA ya tenía fila en FECHA_BLOQUEADA (sub_estados 2.b/2.c), se actualiza la `ttl_expiracion` de la fila existente; no se crea una fila nueva
  - Si la RESERVA estaba en '2a' sin bloqueo, se crea una nueva fila en FECHA_BLOQUEADA con tipo_bloqueo = 'blando'
  - `visita_realizada` se inicializa a false; permanece así hasta que el gestor registre el resultado (US-009/US-010/US-011)
  - La actualización de RESERVA y FECHA_BLOQUEADA es atómica (una única transacción de BD)
  - E6 se registra en COMUNICACION independientemente de si el bloqueo es nuevo o actualizado
- Supuestos: el cliente ha solicitado ver el espacio presencialmente antes de tomar una decisión
- Dependencias: US-001 (sesión activa). US-004 o US-005 o US-007 (si la consulta está en 2.b/2.c, existe fila activa en FECHA_BLOQUEADA que se actualiza). Para '2a', la fecha_evento debe haber sido introducida previamente por el gestor
- Notas de alcance:
  - A19 y A20 son automatizaciones de recordatorio/alerta al gestor (internas al sistema, no emails E-code al cliente). Están dentro del alcance ✅ de la mecánica de visita; no son recordatorios del tipo T-15d/T-3d/T-1d marcados 📐
  - A21b (día +7 desde solicitud sin haber programado visita → expiración automática) es parte de la lógica de expiración; se cubre en US-012 (UC-09)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — desde 2.b
- **Dado** que el Gestor abre la ficha de una RESERVA con sub_estado = '2b', ttl_expiracion > now y fecha_evento definida
  **Cuando** el gestor selecciona "Programar visita", introduce fecha_visita = hoy + 3 días, una hora y confirma
  **Entonces** la RESERVA actualiza: sub_estado = '2v', visita_programada_fecha = fecha introducida, visita_programada_hora = hora introducida, visita_realizada = false

- **Dado** que la RESERVA ha actualizado su sub_estado a '2v'
  **Cuando** el sistema completa la transición
  **Entonces** la fila de FECHA_BLOQUEADA con reserva_id = esta reserva actualiza ttl_expiracion = visita_programada_fecha + 1 día (23:59:59); tipo_bloqueo permanece 'blando'

- **Dado** que FECHA_BLOQUEADA ha sido actualizada
  **Cuando** el sistema completa la transición
  **Entonces** se envía email E6 al cliente con la fecha y hora de visita confirmadas; se registra en COMUNICACION con codigo_email = 'E6', estado = 'enviado', reserva_id = esta reserva, cliente_id = CLIENTE de la reserva

- **Dado** que la transición ha completado
  **Cuando** el sistema registra la operación
  **Entonces** se registra en AUDIT_LOG con accion = 'transicion', entidad = 'RESERVA', datos_anteriores.sub_estado = '2b', datos_nuevos.sub_estado = '2v', datos_nuevos.visita_programada_fecha = fecha introducida

### 🎯 Happy Path — desde 2.a (sin bloqueo previo)
- **Dado** que la RESERVA está en sub_estado = '2a' con fecha_evento definida y sin fila en FECHA_BLOQUEADA
  **Cuando** el gestor programa una visita para fecha_visita = hoy + 2 días
  **Entonces** la RESERVA actualiza sub_estado = '2v', visita_programada_fecha y visita_programada_hora; se crea una nueva fila en FECHA_BLOQUEADA con tipo_bloqueo = 'blando', ttl_expiracion = visita_programada_fecha + 1 día (23:59:59)

### 🎯 Happy Path — desde 2.c
- **Dado** que la RESERVA está en sub_estado = '2c' con bloqueo activo en FECHA_BLOQUEADA
  **Cuando** el gestor programa la visita dentro del límite de TENANT_SETTINGS.max_dias_programar_visita días
  **Entonces** el sistema transiciona a '2v' y actualiza la fila de FECHA_BLOQUEADA con el nuevo ttl_expiracion (día post-visita); el bloqueo previo de 2.c se extiende correctamente

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: Consulta en cola (2.d) — transición no permitida
- **Dado** que la RESERVA tiene sub_estado = '2d'
  **Cuando** el gestor intenta programar una visita
  **Entonces** el sistema muestra error: "No es posible programar una visita para una consulta en cola. La consulta debe ser promovida primero (UC-12)"
- Comportamiento del sistema: opción "Programar visita" deshabilitada en UI para sub_estado '2d'; validación defensiva también en servidor

#### FA: Fecha de visita superior al límite configurado
- **Dado** que el gestor introduce fecha_visita > (hoy + TENANT_SETTINGS.max_dias_programar_visita)
  **Cuando** confirma el formulario
  **Entonces** el sistema muestra error de validación: "La visita debe programarse dentro de los próximos {N} días"; la RESERVA no se modifica
- Comportamiento del sistema: selector de fecha en UI con límite máximo; validación también en servidor

#### FA: Fecha de visita igual a hoy o en el pasado
- **Dado** que el gestor introduce fecha_visita ≤ hoy
  **Cuando** confirma el formulario
  **Entonces** el sistema muestra error de validación: "La fecha de visita debe ser un día futuro"; la RESERVA no se modifica

#### FA: RESERVA en '2a' sin fecha_evento definida
- **Dado** que la RESERVA está en sub_estado = '2a' y fecha_evento es NULL
  **Cuando** el gestor intenta programar la visita
  **Entonces** el sistema informa de que debe introducirse primero la fecha del evento; la acción de visita queda bloqueada hasta que fecha_evento esté definida

#### FA: RESERVA en estado terminal
- **Dado** que la RESERVA está en sub_estado terminal (2.x, 2.y, 2.z) o estado terminal (reserva_cancelada, reserva_completada)
  **Cuando** el gestor intenta programar la visita
  **Entonces** el sistema rechaza la acción con error de validación; los estados terminales son inmutables

### 🔒 Concurrencia / Race Conditions
- **Dado** que la transición a '2v' actualiza RESERVA y FECHA_BLOQUEADA en la misma transacción
  **Cuando** el barrido periódico de TTLs (US-012/A4) intenta expirar simultáneamente la misma RESERVA (su ttl_expiracion de 2.b acaba de vencer)
  **Entonces** la transacción que commitea primero tiene éxito; la otra opera sobre una RESERVA ya modificada y no puede dejarse en estado inconsistente (no puede quedar sub_estado = '2v' sin FECHA_BLOQUEADA actualizada, ni viceversa)

### 🚫 Reglas de Validación
- sub_estado de origen debe ser '2a', '2b' o '2c' (excluidos '2d' y todos los terminales)
- fecha_visita ∈ [hoy + 1 día, hoy + TENANT_SETTINGS.max_dias_programar_visita]
- Para '2a': fecha_evento debe estar definida en la RESERVA antes de la transición
- La actualización de RESERVA y FECHA_BLOQUEADA es atómica; no se permite éxito parcial
- El envío de E6 se registra en COMUNICACION en todos los casos de transición exitosa

## 📊 Impacto de Negocio
- Impacto esperado: Permite al gestor gestionar el ciclo de visitas de manera estructurada, eliminando el seguimiento ad-hoc (D9) y proporcionando visibilidad clara del pipeline para leads en fase de decisión presencial (D2, D3). Cada visita programada genera E6 automático y alertas A19/A20, reduciendo el riesgo de que una visita pase desapercibida
- Criterio de éxito: 100 % de transiciones a 2.v actualizan FECHA_BLOQUEADA con ttl_expiracion = día post-visita; E6 enviado automáticamente en cada transición exitosa