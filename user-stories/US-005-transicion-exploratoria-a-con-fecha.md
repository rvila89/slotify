---
id: US-005
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Transicionar consulta exploratoria a consulta con fecha (2.a → 2.b)

## 🆔 Metadatos
- ID: US-005
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central), M2 — Calendario & Disponibilidad
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** añadir una fecha de evento concreta a una consulta que ya existe en estado exploratorio (2.a)
**Para** que el sistema compruebe la disponibilidad, bloquee atómicamente la fecha si está libre y la consulta avance al estado "con fecha" (2.b), sin tener que crear un nuevo lead desde cero

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-04
- Entidades implicadas: RESERVA, FECHA_BLOQUEADA, COMUNICACION, AUDIT_LOG, TENANT_SETTINGS
- Dolor(es) que resuelve: D2 (visibilidad del pipeline — la consulta avanza de estado sin duplicarse), D3 (estados claros de reserva), D4 (bloqueo atómico de fecha)
- Automatización relacionada: A1 (chequeo disponibilidad + bloqueo atómico al añadir fecha)
- Email relacionado: UC-04 paso 8 describe el envío de un email de confirmación de bloqueo provisional al cliente. Este email no tiene código E asignado en §9.3 (E1-E8). Ver Notas de alcance
- Reglas de negocio:
  - La RESERVA debe estar en sub_estado '2a' para iniciar esta transición
  - La `fecha_evento` introducida debe ser ≥ hoy
  - Si la fecha está **libre** (sin fila activa en FECHA_BLOQUEADA para este tenant y fecha): transición 2.a → 2.b + insertar FECHA_BLOQUEADA con tipo_bloqueo = 'blando' y ttl_expiracion = ahora + TENANT_SETTINGS.ttl_consulta_dias (default 3 días). Se programa el TTL de expiración (A4)
  - Si la fecha está **bloqueada por consulta en 2.b**: el sistema informa al gestor y ofrece la opción de entrar en cola (transición 2.a → 2.d); comportamiento idéntico al edge case de US-004
  - Si la fecha está **bloqueada por 2.c, 2.v, pre_reserva, reserva_confirmada o estados posteriores**: el sistema informa y sugiere alternativas; la RESERVA permanece en 2.a
  - El bloqueo se realiza mediante transacción con SELECT ... FOR UPDATE; la restricción UNIQUE(tenant_id, fecha) garantiza no-doble-reserva
  - Se actualiza `RESERVA.ttl_expiracion` y se registra la transición en AUDIT_LOG
- Supuestos: El gestor accede a la ficha de la consulta existente en 2.a
- Dependencias: US-004 (define las reglas de bloqueo atómico en FECHA_BLOQUEADA y el comportamiento de los estados resultantes 2.b, 2.d, 2.a). US-001 (sesión activa). Para el caso FA-01 de entrada en cola, dependencia funcional con historias de UC-11/12/13
- Notas de alcance:
  - **Email de confirmación de bloqueo provisional**: es una extensión de E1 para el caso de actualización de fecha
  - **Transiciones terminales**: los estados 2.x, 2.y, 2.z, reserva_cancelada y reserva_completada no pueden ser origen de esta transición (inmutables)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — fecha disponible
- **Dado** que el Gestor abre la ficha de una RESERVA con estado = 'consulta' y sub_estado = '2a'
  **Cuando** introduce una `fecha_evento` ≥ hoy que no tiene fila activa en FECHA_BLOQUEADA para este tenant y confirma la transición
  **Entonces** la RESERVA actualiza sub_estado a '2b', almacena `fecha_evento`, y establece `ttl_expiracion` = ahora + TENANT_SETTINGS.ttl_consulta_dias

- **Dado** que la RESERVA ha actualizado su sub_estado a '2b'
  **Cuando** el sistema completa la transición
  **Entonces** se inserta una fila en FECHA_BLOQUEADA con tenant_id, fecha = fecha_evento, reserva_id = id de la RESERVA, tipo_bloqueo = 'blando', ttl_expiracion = RESERVA.ttl_expiracion

- **Dado** que el bloqueo se ha aplicado
  **Cuando** el sistema registra la operación
  **Entonces** se registra en AUDIT_LOG con accion = 'transicion', entidad = 'RESERVA', datos_anteriores.sub_estado = '2a', datos_nuevos.sub_estado = '2b', datos_nuevos.fecha_evento = la fecha introducida

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: Fecha bloqueada por consulta en 2.b — oferta de entrada en cola (→ 2.d)
- **Dado** que la `fecha_evento` seleccionada ya tiene una RESERVA bloqueante en sub_estado '2b' para este tenant
  **Cuando** el gestor intenta añadir esa fecha a la consulta en 2.a
  **Entonces** el sistema informa al gestor de que la fecha está bloqueada por otra consulta y ofrece la opción de entrar en cola (sub_estado 2.d)
- Comportamiento del sistema: si el gestor acepta, la RESERVA transiciona a 2.d con posicion_cola y consulta_bloqueante_id asignados (comportamiento equivalente al edge case 2.d de US-004). Si el gestor rechaza, la RESERVA permanece en 2.a sin cambios

#### FA-02: Fecha bloqueada por 2.c, 2.v, pre_reserva, reserva_confirmada o posterior — sin cola disponible
- **Dado** que la `fecha_evento` seleccionada está bloqueada por una RESERVA en sub_estado '2c', '2v' o en estado 'pre_reserva' o superior
  **Cuando** el gestor intenta añadir esa fecha
  **Entonces** el sistema muestra un mensaje informativo indicando que la fecha no está disponible y no ofrece cola; la RESERVA permanece en 2.a sin ningún cambio
- Comportamiento del sistema: no se modifica la RESERVA ni se crea ninguna fila en FECHA_BLOQUEADA

#### FA: Fecha pasada introducida via servidor (bypass de UI)
- **Dado** que una petición llega al servidor con `fecha_evento` < hoy
  **Cuando** el sistema valida la solicitud
  **Entonces** retorna error de validación sin modificar la RESERVA ni crear FECHA_BLOQUEADA

#### FA: RESERVA no está en sub_estado '2a'
- **Dado** que el gestor intenta ejecutar esta transición sobre una RESERVA que no está en sub_estado '2a' (por ejemplo, está en 2.b, 2.c, o en un estado terminal)
  **Cuando** la petición llega al servidor
  **Entonces** el sistema retorna error de validación indicando que la transición 2.a → 2.b solo es válida desde sub_estado '2a'; la RESERVA no se modifica

### 🔒 Concurrencia / Race Conditions
- **Dado** que dos peticiones concurrentes intentan transicionar dos RESERVA distintas (ambas en 2.a, mismo tenant) hacia la misma `fecha_evento`
  **Cuando** ambas transacciones intentan insertar en FECHA_BLOQUEADA la misma (tenant_id, fecha) con SELECT ... FOR UPDATE
  **Entonces** exactamente una transacción tiene éxito (RESERVA → 2.b + FECHA_BLOQUEADA insertada), y la otra recibe la violación de UNIQUE(tenant_id, fecha) — el sistema maneja el error ofreciendo a la segunda consulta entrar en cola (2.d) sin doble bloqueo (D4)

### 🚫 Reglas de Validación
- La RESERVA debe estar en sub_estado '2a' para ejecutar esta transición
- `fecha_evento` ≥ hoy (validada en servidor además de en UI)
- La inserción en FECHA_BLOQUEADA se realiza solo si la fecha está libre; UNIQUE(tenant_id, fecha) lo garantiza
- tipo_bloqueo = 'blando', ttl_expiracion = ahora + TENANT_SETTINGS.ttl_consulta_dias
- posicion_cola y consulta_bloqueante_id son NULL para transición a 2.b; se asignan solo en transición a 2.d
- Los sub_estados y estados terminales (2.x, 2.y, 2.z, reserva_cancelada, reserva_completada) no pueden iniciar esta transición

## 📊 Impacto de Negocio
- Impacto esperado: Permite avanzar el pipeline cuando el cliente confirma una fecha después del primer contacto sin necesidad de duplicar el lead, con garantía de no-doble-reserva desde ese momento (D4, D3). Mantiene la trazabilidad completa del lead en un único registro RESERVA (D5)
- Criterio de éxito: 0 dobles reservas; visibilidad inmediata del cambio a 2.b en el calendario para el gestor; 0 registros duplicados de la misma consulta
