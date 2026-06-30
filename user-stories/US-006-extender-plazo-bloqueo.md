---
id: US-006
estado: backlog
branch: feature/us-006-extender-plazo-bloqueo
pr: null
---

# 🧾 Historia de Usuario: Extender plazo de bloqueo de fecha

## 🆔 Metadatos
- ID: US-006
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central), M2 — Calendario & Disponibilidad
- Prioridad: Media
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** extender el TTL del bloqueo activo de una consulta o pre-reserva antes de que expire
**Para** ganar tiempo adicional mientras el cliente decide, sin liberar la fecha ni disparar la promoción automática de la cola de forma prematura

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-05
- Entidades implicadas: RESERVA, FECHA_BLOQUEADA, AUDIT_LOG
- Dolor(es) que resuelve: D4 (evitar liberar una fecha por expiración no gestionada cuando el gestor tiene intención de mantener el bloqueo), D11 (los recordatorios automáticos se reprograman a la nueva fecha de expiración, evitando notificaciones prematuras)
- Automatización relacionada: override manual sobre A4 (expiración de consulta en 2.b) y A5 (expiración de pre_reserva). La extensión pospone el trigger de ambas automatizaciones
- Email relacionado: ninguno. UC-05 no describe envío de email al cliente al extender el plazo; el gestor puede comunicarlo manualmente si lo considera oportuno
- Reglas de negocio:
  - La extensión solo está disponible cuando existe un bloqueo activo: sub_estado ∈ {2b, 2c, 2v} O estado = 'pre_reserva'
  - El TTL de la RESERVA (`ttl_expiracion`) debe ser > ahora (bloqueo no expirado) para poder extender
  - La extensión se especifica en días enteros positivos (≥ 1)
  - El sistema actualiza `RESERVA.ttl_expiracion` = ttl_expiracion actual + N días
  - Si `FECHA_BLOQUEADA.tipo_bloqueo` = 'blando': también se actualiza `FECHA_BLOQUEADA.ttl_expiracion` al mismo valor
  - Los recordatorios automáticos (A3, A4, A5 según el estado) se reprograman a la nueva fecha de expiración
  - Si el bloqueo es de tipo 'firme' (reserva_confirmada, sin TTL), no aplica extensión porque no hay TTL que extender
  - La extensión se registra en AUDIT_LOG como actualización manual del gestor
- Supuestos: El gestor ha accedido a la ficha de la consulta o pre-reserva con bloqueo activo. Esta acción es el override manual descrito en §6.3 SlotifyGeneralSpecs
- Dependencias: US-004 o US-005 (debe existir una RESERVA con bloqueo activo creado por alguna de estas historias). US-001 (sesión activa)
- Notas de alcance: La extensión en pre_reserva prorroga el TTL de 7 días de la pre-reserva (TENANT_SETTINGS.ttl_prereserva_dias). En reserva_confirmada el bloqueo es firme (sin TTL) y la extensión no aplica ni tiene sentido

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — consulta en 2.b con TTL activo
- **Dado** que el Gestor abre la ficha de una RESERVA con sub_estado = '2b' (o '2c', '2v', o estado = 'pre_reserva') cuyo `ttl_expiracion` es posterior a ahora
  **Cuando** el gestor selecciona "Extender bloqueo", introduce N días (entero ≥ 1) y confirma
  **Entonces** el sistema actualiza `RESERVA.ttl_expiracion` = ttl_expiracion_actual + N días

- **Dado** que el RESERVA.ttl_expiracion se ha actualizado y FECHA_BLOQUEADA.tipo_bloqueo = 'blando'
  **Cuando** el sistema procesa la extensión
  **Entonces** `FECHA_BLOQUEADA.ttl_expiracion` para la fila con reserva_id de esta RESERVA se actualiza al mismo nuevo valor

- **Dado** que los TTL se han actualizado
  **Cuando** el sistema finaliza la operación
  **Entonces** los recordatorios automáticos (A3 a día+2, A4/A5 al día del nuevo vencimiento) se reprograman a la nueva `ttl_expiracion`

- **Dado** que la extensión se ha procesado
  **Cuando** el sistema registra la operación
  **Entonces** se registra en AUDIT_LOG con accion = 'actualizar', entidad = 'RESERVA', datos_anteriores.ttl_expiracion = valor previo, datos_nuevos.ttl_expiracion = nuevo valor

### ⚠️ Flujos Alternativos y Edge Cases

#### FA: TTL ya expirado — extensión no permitida
- **Dado** que la RESERVA tiene `ttl_expiracion` < ahora (bloqueo ya expirado)
  **Cuando** el gestor intenta extender el bloqueo
  **Entonces** el sistema muestra un mensaje de error indicando que el bloqueo ha expirado y no permite la extensión; la RESERVA y FECHA_BLOQUEADA no se modifican
- Comportamiento del sistema: si el bloqueo expiró, la expiración automática (A4/A5) ya debería haber procesado el cambio de sub_estado a 2.x (o reserva_cancelada). La extensión no puede "deshacer" una expiración ya ejecutada

#### FA: RESERVA en estado sin bloqueo activo (2.a, terminales, reserva_confirmada)
- **Dado** que la RESERVA está en sub_estado '2a' (sin fecha bloqueada), en un estado terminal (2.x, 2.y, 2.z, reserva_completada, reserva_cancelada), o en estado 'reserva_confirmada' (bloqueo firme)
  **Cuando** el gestor intenta extender el bloqueo
  **Entonces** la opción "Extender bloqueo" no aparece disponible en la UI para estos estados; si la petición llega al servidor por cualquier otro medio, retorna error de validación indicando que no hay bloqueo activo extensible

#### FA: Valor de extensión inválido (cero, negativo o no entero)
- **Dado** que el gestor introduce 0, un número negativo o un valor no entero como número de días de extensión
  **Cuando** intenta confirmar la extensión
  **Entonces** el sistema rechaza la entrada con error de validación: "El número de días de extensión debe ser un entero positivo (≥ 1)"; no se modifica ningún registro

#### FA: pre_reserva — extensión del TTL de 7 días
- **Dado** que la RESERVA está en estado 'pre_reserva' con `ttl_expiracion` activo y FECHA_BLOQUEADA.tipo_bloqueo = 'blando'
  **Cuando** el gestor extiende N días
  **Entonces** el sistema actualiza RESERVA.ttl_expiracion y FECHA_BLOQUEADA.ttl_expiracion con las mismas reglas que en 2.b/2.c, y reprograma A5 (expiración de pre_reserva) a la nueva fecha

### 🚫 Reglas de Validación
- `sub_estado` ∈ {'2b', '2c', '2v'} OR `estado` = 'pre_reserva' para permitir la extensión
- `RESERVA.ttl_expiracion` > ahora (TTL no expirado en el momento de la petición)
- Días de extensión: entero ≥ 1
- Se actualiza `FECHA_BLOQUEADA.ttl_expiracion` solo si la fila existe y tipo_bloqueo = 'blando'
- No se modifica el sub_estado ni el estado de la RESERVA
- No se modifica el tipo_bloqueo ni la fecha de FECHA_BLOQUEADA
- El resultado de la operación se registra siempre en AUDIT_LOG

## 📊 Impacto de Negocio
- Impacto esperado: Reduce las liberaciones prematuras de fechas por expiración cuando el gestor está en proceso de negociación activa con el cliente, manteniendo el bloqueo atómico y la trazabilidad (D4, D11)
- Criterio de éxito: 0 pérdidas de fecha por expiración no gestionada en consultas con negociación activa; tiempo de extensión < 30 segundos para el gestor