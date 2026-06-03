# 🧾 Historia de Usuario: Transicionar consulta a pendiente de número de invitados (2.c)

## 🆔 Metadatos
- ID: US-007
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central), M2 — Calendario & Disponibilidad
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** marcar una consulta con fecha bloqueada como "pendiente del número de invitados"
**Para** extender el bloqueo de la fecha 3 días adicionales, vaciar atómicamente la cola de espera de esa fecha, y dejar constancia de que el cliente tiene intención firme pero aún no ha confirmado el aforo

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-06
- Entidades implicadas: RESERVA, FECHA_BLOQUEADA, COMUNICACION, AUDIT_LOG, TENANT_SETTINGS
- Dolor(es) que resuelve: D2 (visibilidad del pipeline — estado diferenciado que refleja intención firme), D3 (estados claros), D4 (bloqueo de fecha extendido con intención firme), D13 (la cola se vacía porque la consulta bloqueante tiene intención real de continuar)
- Automatización relacionada: A16 (Consulta bloqueante avanza a 2.c → vaciar toda la cola → todas las RESERVA en 2.d pasan a 2.y)
- Email relacionado:
  - UC-06 paso 7 describe un email al cliente solicitando el número de invitados. Este email no tiene código E asignado en §9.3 (E1-E8). Ver Notas de alcance
  - A16 describe emails a los clientes de la cola notificando el vaciado: 📐 Solo diseñado en MVP, no implementado
- Reglas de negocio:
  - La RESERVA debe estar en sub_estado '2b' (o '2a' con fecha bloqueada activa, según UC-06 precondición). Si la RESERVA no tiene fecha bloqueada, la transición no está permitida (UC-06 FA-01)
  - El happy path canónico es 2.b → 2.c
  - Al transicionar a 2.c:
    1. `RESERVA.sub_estado` = '2c'
    2. `RESERVA.ttl_expiracion` += TENANT_SETTINGS.ttl_consulta_dias (default +3 días)
    3. `FECHA_BLOQUEADA.ttl_expiracion` para la fila de esta reserva se actualiza al mismo valor
    4. Todas las RESERVA con consulta_bloqueante_id = esta reserva y sub_estado = '2d' (consultas en cola para esta fecha) pasan a sub_estado = '2y' (consulta_descartada_por_cola). Sus campos posicion_cola y consulta_bloqueante_id se anulan (NULL)
  - Las 4 operaciones anteriores son **atómicas** (una única transacción de BD)
  - El vaciado de la cola es irreversible: 2.y es un estado terminal
  - Si la cola está vacía (sin RESERVA en 2.d con consulta_bloqueante_id = esta reserva), la transición se completa igualmente sin error
- Supuestos: El gestor accede a la ficha de la consulta en 2.b
- Dependencias: US-004 o US-005 (debe existir una RESERVA en 2.b con fecha bloqueada activa). US-001 (sesión activa)
- Notas de alcance:
  - **Emails al cliente solicitando nº de invitados**: UC-06 paso 7 describe esta comunicación pero §9.3 no le asigna código E (E1-E8). El prompt prohíbe referenciar emails fuera de E1-E8. Se identifica como posible gap en la spec. A confirmar con el product owner si debe catalogarse como un nuevo E-code o gestionarse manualmente desde el log de comunicaciones en MVP
  - **Emails de vaciado de cola (A16)**: los emails automáticos a los clientes en 2.d notificando que su consulta ha sido descartada son 📐 Solo diseñado en MVP. La **mecánica** del vaciado (2.d → 2.y) sí está ✅ implementada. El gestor puede ver el resultado en la UI de cola (UC-11)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — consulta en 2.b sin cola
- **Dado** que el Gestor abre la ficha de una RESERVA con sub_estado = '2b', `ttl_expiracion` > ahora, y ninguna RESERVA con consulta_bloqueante_id = esta reserva en sub_estado '2d'
  **Cuando** el gestor selecciona "Marcar como pendiente de invitados" y confirma
  **Entonces** la RESERVA actualiza sub_estado a '2c' y `ttl_expiracion` = ttl_expiracion_actual + TENANT_SETTINGS.ttl_consulta_dias

- **Dado** que la RESERVA ha actualizado su sub_estado y ttl_expiracion
  **Cuando** el sistema completa la transición
  **Entonces** `FECHA_BLOQUEADA.ttl_expiracion` para la fila con reserva_id de esta RESERVA se actualiza al nuevo valor de RESERVA.ttl_expiracion

- **Dado** que la transición ha completado
  **Cuando** el sistema registra la operación
  **Entonces** se registra en AUDIT_LOG con accion = 'transicion', entidad = 'RESERVA', datos_anteriores.sub_estado = '2b', datos_nuevos.sub_estado = '2c', datos_nuevos.ttl_expiracion = nuevo valor

### 🎯 Happy Path — consulta en 2.b con cola activa (mecánica A16)
- **Dado** que la RESERVA en 2.b es consulta_bloqueante de N consultas en sub_estado '2d' (con consulta_bloqueante_id = id de esta RESERVA)
  **Cuando** el gestor transiciona a 2.c y el sistema procesa la transición
  **Entonces** en la misma transacción de BD, todas las RESERVA con consulta_bloqueante_id = esta reserva y sub_estado = '2d' actualizan su sub_estado a '2y', posicion_cola a NULL y consulta_bloqueante_id a NULL

- **Dado** que la cola ha sido vaciada
  **Cuando** el sistema finaliza la transacción
  **Entonces** no se envían emails automáticos a los clientes de la cola en MVP (emails de cola son 📐); el gestor puede ver las consultas vaciadas en estado 2.y desde la UI

- **Dado** que la transacción atómica (2.c + TTL extendido + cola vaciada) se ha completado
  **Cuando** el sistema registra la operación
  **Entonces** se registra en AUDIT_LOG la transición de la RESERVA principal, y se registran las actualizaciones de cada RESERVA vaciada de la cola (sub_estado '2d' → '2y')

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: RESERVA sin fecha bloqueada — transición no permitida
- **Dado** que el Gestor intenta marcar como "pendiente de invitados" una RESERVA en sub_estado '2a' que no tiene fila activa en FECHA_BLOQUEADA (sin fecha bloqueada)
  **Cuando** intenta confirmar la transición
  **Entonces** el sistema muestra un error indicando que la transición a 2.c requiere una fecha bloqueada activa; la RESERVA permanece en 2.a sin ningún cambio
- Comportamiento del sistema: la opción "Marcar como pendiente de invitados" puede estar deshabilitada en la UI cuando no hay bloqueo activo; validación defensiva también en servidor

#### FA: TTL expirado — consulta ya en 2.x
- **Dado** que la RESERVA en 2.b tiene `ttl_expiracion` < ahora (el bloqueo ya expiró, la expiración automática A4 debería haberla pasado a 2.x)
  **Cuando** el gestor intenta la transición a 2.c
  **Entonces** el sistema informa de que el bloqueo ha expirado y no permite la transición; la RESERVA no se modifica

#### FA: Cola vacía — transición igualmente válida
- **Dado** que la RESERVA en 2.b no tiene ninguna RESERVA en 2.d con consulta_bloqueante_id apuntándola
  **Cuando** el gestor transiciona a 2.c
  **Entonces** el sistema completa la transición correctamente (sub_estado = '2c', TTL extendido) sin errores; el vaciado de cola es una operación vacía (afecta a 0 filas) y no altera ningún registro adicional

#### FA: Estado terminal — transición bloqueada
- **Dado** que la RESERVA está en un estado terminal (2.x, 2.y, 2.z, reserva_cancelada, reserva_completada)
  **Cuando** el gestor intenta la transición a 2.c
  **Entonces** el sistema retorna error de validación; los estados terminales son inmutables

### 🔒 Concurrencia / Race Conditions
- **Dado** que las 4 operaciones de la transición a 2.c (actualizar sub_estado, extender TTL en RESERVA, actualizar FECHA_BLOQUEADA y vaciar cola en 2.d → 2.y) deben ser atómicas
  **Cuando** se ejecuta la transición bajo carga concurrente (por ejemplo, otra petición intenta simultáneamente promover o vaciar la cola de esa misma fecha via UC-12 o UC-13)
  **Entonces** todas las operaciones se completan dentro de una única transacción de BD, de modo que el sistema no puede quedar en un estado intermedio donde el sub_estado sea '2c' pero la cola no se haya vaciado, o viceversa — un fallo parcial revierte toda la transacción (rollback)

### 🚫 Reglas de Validación
- sub_estado debe ser '2b' (o '2a' con fila activa en FECHA_BLOQUEADA) para iniciar la transición
- Debe existir fila activa en FECHA_BLOQUEADA para (tenant_id, fecha_evento) de esta RESERVA
- `RESERVA.ttl_expiracion` > ahora (bloqueo vigente)
- El vaciado de cola (2.d → 2.y) es parte de la misma transacción; no se permite éxito parcial
- Los sub_estados y estados terminales son inmutables: no pueden ser origen de esta transición
- La extensión de TTL usa TENANT_SETTINGS.ttl_consulta_dias (default 3 días), no un valor hardcoded

## 📊 Impacto de Negocio
- Impacto esperado: Permite al gestor diferenciar leads maduros (cliente comprometido con fecha, solo falta el aforo) de los exploratorios, liberando la cola de espera para futuras oportunidades al señalizar intención firme. Mejora la fiabilidad del pipeline y la gestión de la cola (D2, D3, D4, D13)
- Criterio de éxito: 100% de transiciones a 2.c vacían la cola atómicamente (0 consultas en 2.d inconsistentes tras la transición); TTL extendido correctamente en RESERVA y FECHA_BLOQUEADA
