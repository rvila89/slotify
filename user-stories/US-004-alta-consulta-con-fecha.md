# 🧾 Historia de Usuario: Alta de consulta con fecha de evento disponible

## 🆔 Metadatos
- ID: US-004
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central), M2 — Calendario & Disponibilidad
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** dar de alta un nuevo lead con una fecha de evento concreta
**Para** que el sistema compruebe la disponibilidad, bloquee atómicamente la fecha durante 3 días si está libre, y registre el lead en el estado correcto según el resultado, eliminando el riesgo de doble reserva desde el primer contacto

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-03
- Entidades implicadas: RESERVA, CLIENTE, FECHA_BLOQUEADA, COMUNICACION, AUDIT_LOG, TENANT_SETTINGS, TARIFA, TEMPORADA_CALENDARIO
- Dolor(es) que resuelve: D1 (fuente única de verdad), D2 (visibilidad del pipeline), D4 (riesgo de doble reserva — crítico), D9 (automatización), D13 (leads en fechas bloqueadas gestionados sin promesas verbales)
- Automatización relacionada:
  - A1 (Lead entra → chequeo disponibilidad + crear consulta en 2.a/2.b/2.d + email E1)
  - A14 (Lead con fecha bloqueada por consulta en 2.b → crear consulta en 2.d + asignar posicion_cola)
- Email relacionado: E1 — auto-envío si campos suficientes sin comentarios; borrador si hay comentarios. Incluye tarifa estimada si fecha + nº invitados + horas están presentes
- Reglas de negocio:
  - Campos obligatorios + `fecha_evento` ≥ hoy (bloqueada en UI con selector; validada también en servidor)
  - El sistema comprueba el estado actual de la fecha en FECHA_BLOQUEADA para el tenant antes de crear el bloqueo
  - **Fecha libre** → crear RESERVA en sub_estado '2b' + insertar fila en FECHA_BLOQUEADA con tipo_bloqueo = 'blando' y ttl_expiracion = ahora + TENANT_SETTINGS.ttl_consulta_dias (default 3 días)
  - **Fecha bloqueada por consulta en 2.b** → crear RESERVA en sub_estado '2d' con posicion_cola = MAX(posicion_cola existente para esa fecha en ese tenant) + 1 y consulta_bloqueante_id = ID de la RESERVA bloqueante. No se crea fila en FECHA_BLOQUEADA para esta consulta
  - **Fecha bloqueada por consulta en 2.c, 2.v, pre_reserva, reserva_confirmada o estados posteriores** → crear RESERVA en sub_estado '2a' (exploratoria, sin bloqueo, sin cola)
  - El bloqueo en FECHA_BLOQUEADA se realiza dentro de una transacción con SELECT ... FOR UPDATE; la restricción UNIQUE(tenant_id, fecha) garantiza la no-doble-reserva en el motor de BD
  - Si fecha + nº invitados + horas están presentes: el sistema calcula tarifa estimada via UC-16 e incluye el resultado en E1
- Supuestos: Alta manual del gestor en MVP, sea cual sea el canal de origen del lead. Se crea entidad CLIENTE si no existe con ese email para este tenant
- Dependencias: US-001 (sesión activa). US-003 (define el modelo de la entidad RESERVA). El edge case de creación en 2.d tiene dependencia funcional con las historias de gestión de cola (UC-11/12/13) para las operaciones de promoción y vaciado posteriores
- Notas de alcance:
  - **Entrada en cola (2.d)**: el punto de entrada a la cola al crear el lead está ✅ en MVP (A14). La gestión posterior de la cola (promoción, vaciado, reordenación) se especifica en las historias de UC-11 a UC-13
  - **Emails de cola**: los emails automáticos al cliente indicando su posición en cola son 📐 Solo diseñado en MVP. En MVP, el gestor ve la posición en cola desde la UI (UC-11), pero el cliente no recibe email automático de confirmación de posición
  - **Detección de recurrencia**: 📐 fuera de MVP; no implementada en esta historia

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — fecha disponible, sin comentarios
- **Dado** que el Gestor está autenticado y accede al formulario "Nueva consulta"
  **Cuando** introduce los campos obligatorios más `fecha_evento` ≥ hoy que no tiene fila activa en FECHA_BLOQUEADA para este tenant, sin comentarios, y confirma el alta
  **Entonces** el sistema crea una entidad RESERVA con estado = 'consulta', sub_estado = '2b', `fecha_evento` = la fecha introducida, `ttl_expiracion` = ahora + TENANT_SETTINGS.ttl_consulta_dias (default 3 días)

- **Dado** que la RESERVA se ha creado en 2.b
  **Cuando** el sistema procesa el alta
  **Entonces** se inserta una fila en FECHA_BLOQUEADA con tenant_id del tenant activo, fecha = fecha_evento de la reserva, reserva_id = id de la nueva RESERVA, tipo_bloqueo = 'blando', ttl_expiracion = mismo valor que RESERVA.ttl_expiracion

- **Dado** que el alta y el bloqueo se han completado, con fecha + nº invitados + horas presentes y sin comentarios
  **Cuando** el sistema envía E1
  **Entonces** E1 se envía automáticamente al email del cliente con la tarifa estimada calculada via UC-16, y se registra en COMUNICACION con codigo_email = 'E1', estado = 'enviado'

- **Dado** que el alta se ha completado
  **Cuando** el sistema finaliza la operación
  **Entonces** se registra en AUDIT_LOG con accion = 'crear', entidad = 'RESERVA', datos completos de la nueva RESERVA en `datos_nuevos`

### ⚠️ Flujos Alternativos y Edge Cases

#### FA: Lead con comentarios — E1 queda en borrador
- **Dado** que el gestor introduce los datos incluyendo fecha disponible y campo `comentarios` con texto
  **Cuando** confirma el alta
  **Entonces** el sistema crea la RESERVA en 2.b, aplica el bloqueo en FECHA_BLOQUEADA, y genera E1 como borrador en COMUNICACION con estado = 'borrador' sin enviarlo
- Comportamiento del sistema: el gestor recibe aviso en UI de borrador pendiente; puede editarlo y confirmar el envío manualmente

#### FA: Fecha bloqueada por consulta en 2.b — entrada en cola (→ 2.d)
- **Dado** que la `fecha_evento` introducida ya tiene una RESERVA bloqueante en sub_estado '2b' para este tenant (fila activa en FECHA_BLOQUEADA)
  **Cuando** el gestor confirma el alta del nuevo lead con esa fecha
  **Entonces** el sistema crea la RESERVA en sub_estado '2d', asigna posicion_cola = (posición máxima existente para esa fecha en este tenant) + 1, establece consulta_bloqueante_id apuntando a la RESERVA bloqueante, y NO crea entrada en FECHA_BLOQUEADA para esta nueva consulta (la fecha ya está bloqueada por la bloqueante)
- Comportamiento del sistema: el gestor puede ver la posición en cola desde la vista de la fecha en el calendario (UC-11). Los emails automáticos al cliente informando de su posición en cola son 📐 fuera de MVP

#### FA: Fecha bloqueada por 2.c, 2.v, pre_reserva o reserva_confirmada — va a 2.a
- **Dado** que la `fecha_evento` introducida está bloqueada por una RESERVA en sub_estado '2c', '2v', o en estado 'pre_reserva', 'reserva_confirmada' o posteriores
  **Cuando** el gestor confirma el alta
  **Entonces** el sistema crea la RESERVA en sub_estado '2a' (exploratoria, sin bloqueo, sin cola) y el gestor ve un aviso informativo indicando que la fecha no está disponible
- Comportamiento del sistema: no se crea entrada en FECHA_BLOQUEADA; la consulta queda como exploratoria sin fecha bloqueada

#### FA-01: Fecha pasada — bloqueada en UI y validada en servidor
- **Dado** que el selector de fecha del formulario no permite seleccionar fechas < hoy
  **Cuando** el gestor intenta seleccionar una fecha anterior a la fecha actual
  **Entonces** el selector de UI no permite la selección
- **Dado** que una petición con `fecha_evento` < hoy llega al servidor por bypass de la UI
  **Cuando** el sistema valida la solicitud
  **Entonces** retorna error de validación sin crear RESERVA ni FECHA_BLOQUEADA

#### FA-03: Datos obligatorios incompletos
- **Dado** que el gestor introduce el lead en el formulario sin algún campo obligatorio
  **Cuando** intenta confirmar el alta
  **Entonces** el sistema no crea RESERVA ni FECHA_BLOQUEADA y muestra errores de validación en los campos faltantes

#### FA: Solo fecha sin datos de tarifa completos — E1 sin precio exacto
- **Dado** que el gestor introduce fecha pero no el nº de invitados o las horas, sin comentarios
  **Cuando** confirma el alta
  **Entonces** el sistema crea la RESERVA en 2.b con bloqueo, y E1 se envía automáticamente con el dossier de tarifas general pero sin precio exacto calculado

### 🔒 Concurrencia / Race Conditions
- **Dado** que dos peticiones concurrentes intentan simultáneamente dar de alta dos leads con la misma tenant_id y fecha_evento, ambas iniciando la transacción con SELECT ... FOR UPDATE sobre FECHA_BLOQUEADA
  **Cuando** ambas transacciones intentan insertar una fila en FECHA_BLOQUEADA con la misma (tenant_id, fecha)
  **Entonces** exactamente una transacción tiene éxito (RESERVA en 2.b + FECHA_BLOQUEADA insertada), y la otra recibe la violación de la restricción UNIQUE(tenant_id, fecha) — el sistema maneja este caso creando la segunda RESERVA en 2.d (si la ganadora es 2.b) sin posibilidad de doble bloqueo (D4 eliminado)
- Esta garantía es determinista y reside en el motor de BD (PostgreSQL), no en lógica aplicativa

### 🚫 Reglas de Validación
- `fecha_evento` ≥ hoy (validada en UI + en servidor)
- La inserción en FECHA_BLOQUEADA solo se realiza si la fecha está libre; UNIQUE(tenant_id, fecha) impide duplicados
- tipo_bloqueo = 'blando' para sub-estado 2.b
- ttl_expiracion = ahora + TENANT_SETTINGS.ttl_consulta_dias (entero positivo, default 3)
- posicion_cola se asigna solo en sub-estado '2d'; NULL para 2.b y 2.a
- consulta_bloqueante_id se asigna solo en sub-estado '2d'; NULL para 2.b y 2.a
- No se crea fila en FECHA_BLOQUEADA para consultas creadas en 2.a o 2.d

## 📊 Impacto de Negocio
- Impacto esperado: Eliminación del riesgo de doble reserva desde el primer contacto con fecha (D4 — crítico); centralización de todos los leads con fecha en la fuente única de verdad (D1, D2); gestión estructurada y trazable de leads en fechas bloqueadas sin promesas verbales (D13)
- Criterio de éxito: 0 dobles reservas (garantizado por UNIQUE constraint en FECHA_BLOQUEADA); tiempo de alta ≤ 2 minutos; 100% de fechas bloqueadas trazables en FECHA_BLOQUEADA
