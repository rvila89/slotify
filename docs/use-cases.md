# Análisis de Casos de Uso — Slotify MVP

> **Documento**: Especificación de Casos de Uso  
> **Proyecto**: Slotify — Plataforma SaaS de Gestión Integral para Espacios Boutique de Eventos Privados   
> **Fuente**: SlotifyGeneralSpecs.md

---

## 1. Resumen Ejecutivo

### 1.1 Sistema Analizado

**Slotify** es una plataforma SaaS diseñada para propietarios y gestores de espacios boutique de eventos privados (masías, fincas, villas). El sistema unifica el ciclo completo de gestión de eventos: desde la captación del lead hasta el archivo en el histórico, pasando por presupuestos, facturación y ejecución operativa.

La arquitectura del sistema se fundamenta en la **reserva como entidad central**, diferenciándose de CRMs tradicionales que giran en torno al cliente. El modelo multi-tenant permite aislar datos entre diferentes espacios, aunque el MVP opera con un único tenant (Masia l'Encís).

El flujo principal sigue una **máquina de estados jerárquica** con sub-estados específicos para consultas (2.a-2.z), incluyendo gestión de cola de espera para fechas bloqueadas y sub-procesos paralelos (pre-evento, liquidación, fianza) tras la confirmación de la reserva.

### 1.2 Actores Identificados

| Actor | Descripción | Nivel de interacción |
|-------|-------------|---------------------|
| **Gestor** | Usuario principal del sistema. Gestiona todo el ciclo de vida de las reservas, desde la captación de leads hasta el archivo final. Tiene acceso completo a todas las funcionalidades del MVP. | Alto |
| **Sistema** | Actor automático que ejecuta transiciones de estado, envía emails, gestiona TTLs, promueve consultas de cola y mantiene la consistencia de datos. | Alto |
| **Cliente** | Actor externo que interactúa indirectamente con el sistema a través de emails, formularios web y comunicaciones con el gestor. En MVP no tiene acceso directo al sistema. | Medio (indirecto) |
| **Equipo** | Personal operativo que ejecuta el evento. Accede a briefings y documentación. En MVP tiene interacción limitada. | Bajo |

### 1.3 Criterios de Selección de Casos de Uso

Los casos de uso se han seleccionado aplicando los siguientes criterios:

1. **Cobertura funcional MVP**: Solo se incluyen funcionalidades marcadas como "✅ Implementado" en la matriz de alcance
2. **Valor al usuario**: Priorizando casos que resuelven los dolores operativos identificados (D1-D13)
3. **Viabilidad técnica**: Casos implementables dentro del stack tecnológico definido
4. **Trazabilidad**: Cada caso traza a requisitos específicos de la especificación funcional
5. **Completitud del flujo**: Cubriendo el ciclo completo lead → archivo

### 1.4 Estructura de la Interfaz de Usuario

La aplicación sigue un layout consistente con los siguientes elementos:

#### Sidebar (Menú lateral fijo)

Menú de navegación principal ubicado en el lateral izquierdo, siempre visible:

| Opción | Descripción |
|--------|-------------|
| **Dashboard** | Panel operativo con widgets de resumen y alertas. Primera entrada del sidebar (posición 1). La landing post-login sigue siendo `/calendario`. Implementado en US-044. |
| **Calendario** | Vista principal del calendario de disponibilidad y reservas. Es la página de inicio tras el login. |
| **Reservas** | Hub del pipeline activo — dos tabs: "Flujo de Reserva" (Kanban por fase) y "Listado" (tabla de activas). Clic en cualquier reserva navega a su FichaConsulta. Implementado en US-049 (backend) y US-050 (frontend). |
| **Métricas** | KPIs y estadísticas del negocio (diferido a V1; entrada visible pero sin contenido en MVP). |

#### Header (Cabecera fija)

Barra superior persistente con elementos de acceso rápido:

| Elemento | Descripción |
|----------|-------------|
| **Indicador reservas hoy** | Muestra el número de reservas/eventos programados para el día actual. |
| **Icono notificaciones** | Acceso a alertas y notificaciones pendientes (TTLs próximos, pagos vencidos, etc.). |
| **Botón nueva reserva** | Acceso directo al formulario de alta de nueva consulta/reserva (UC-03). |

---

## 2. Catálogo de Casos de Uso

### 2.1 Índice por Área Funcional

| Área | Casos de Uso | Cantidad |
|------|--------------|----------|
| Autenticación | UC-01, UC-02 | 2 |
| Gestión de Leads y Consultas | UC-03 a UC-10 | 8 |
| Gestión de Cola de Espera | UC-11 a UC-13 | 3 |
| Pre-reserva y Presupuestos | UC-14 a UC-16 | 3 |
| Confirmación de Reserva | UC-17 a UC-19 | 3 |
| Sub-procesos Paralelos | UC-20 a UC-22 | 3 |
| Ejecución del Evento | UC-23 a UC-25 | 3 |
| Post-evento | UC-26 a UC-28 | 3 |
| Calendario y Disponibilidad | UC-29 a UC-31 | 3 |
| Histórico | UC-32, UC-33 | 2 |
| Dashboard | UC-34 | 1 |
| Gestión del Pipeline de Reservas | UC-37, UC-38 | 2 |
| Comunicaciones | UC-35, UC-36 | 2 |
| **Total** | | **38** |

---

## 3. Casos de Uso Documentados

### ÁREA: AUTENTICACIÓN Y ACCESO

---

#### UC-01: Iniciar Sesión

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-01 |
| **Nombre** | Iniciar Sesión |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor accede al sistema mediante credenciales válidas para gestionar las reservas del tenant |
| **Precondiciones** | - El gestor tiene una cuenta activa en el sistema<br>- El tenant está configurado y activo |
| **Postcondiciones** | - El gestor tiene acceso a las funcionalidades según su rol<br>- Se registra el evento `login` en `AUDIT_LOG` (únicamente en login exitoso; los intentos fallidos no se auditan)<br>- El access token JWT (~15 min) queda en memoria de la SPA; el refresh token (~7 días) queda en cookie `httpOnly + Secure + SameSite` |
| **Prioridad** | Alta |
| **Frecuencia** | Diaria |

**Flujo Básico:**
1. El gestor accede a la URL del sistema
2. El sistema muestra el formulario de login
3. El gestor introduce email y contraseña (el frontend valida por campo antes de llamar a la API: bloquea si email o contraseña están vacíos o el email tiene formato inválido)
4. El sistema valida las credenciales contra el hash argon2 del usuario dentro del tenant
5. El sistema emite un access token JWT de vida corta (~15 min) con `{sub, tenantId, rol, email}` en el payload firmado, y establece el refresh token en cookie `httpOnly + Secure + SameSite`
6. El sistema registra el evento `login` en `AUDIT_LOG`
7. La SPA puebla la sesión en memoria y redirige al calendario

**Flujos Alternativos:**
- **FA-01** (anti-enumeration): Credenciales inválidas (email inexistente o contraseña incorrecta) → El sistema devuelve **401 genérico uniforme** con el mismo mensaje en ambos casos, sin revelar qué campo es incorrecto (OWASP A01). No se emite token ni se registra en `AUDIT_LOG`. El gestor puede reintentar.
- **FA-02**: Cuenta deshabilitada (`activo=false`) → El sistema devuelve el **mismo 401 genérico** que FA-01 (anti-enumeration: la respuesta no distingue esta causa de FA-01). No se emite token ni se registra en `AUDIT_LOG`. La reactivación de la cuenta se hace por script/seed, no por UI.
- **FA-03** (**DIFERIDO**): Sesión activa en otro dispositivo → Las sesiones en múltiples dispositivos coexisten en silencio. El flujo interactivo (continuar / cerrar la sesión anterior) requiere refresh stateful y está diferido (ver DT-AUTH-02 en [architecture.md §2.9](./architecture.md)).
- **FA-04**: Demasiados intentos de login → El sistema devuelve **429** (throttler self-contained: ventana de 5 intentos por 60 s, clave IP+email). La respuesta 429 es genérica e independiente de si el email existe.

---

#### UC-02: Cerrar Sesión

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-02 |
| **Nombre** | Cerrar Sesión |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor cierra su sesión activa de forma segura desde el botón "Cerrar sesión" ubicado en el pie del sidebar (escritorio) o en el drawer de navegación móvil (`<lg`) |
| **Precondiciones** | - El gestor tiene una sesión activa (o ninguna, en el caso del doble logout — ver FA-01) |
| **Postcondiciones** | - La cookie del refresh token queda limpiada en el dispositivo actual; el access token se elimina de la memoria de la SPA y caduca en ~15 min por su vida corta natural<br>- Se registra el evento `logout` en `AUDIT_LOG` con `entidad = 'Usuario'`, `entidad_id = usuario_id`, `usuario_id` y `tenant_id` del refresh token — **solo cuando el token identifica a un usuario válido** (si el token es ausente/expirado/inválido, no se audita)<br>- El gestor es redirigido a `/login`<br>**Nota:** con la estrategia de refresh stateless (DT-AUTH-01 en [architecture.md §2.9](./architecture.md)), el logout es best-effort: limpia la cookie del dispositivo actual pero no invalida criptográficamente el refresh token en el servidor. US-002 ratificó este enfoque (auditoría + idempotencia) y dejó la invalidación stateful real (modelo `SesionRefresh` / denylist) como deuda post-MVP. |
| **Prioridad** | Alta |
| **Frecuencia** | Diaria |

**Flujo Básico:**
1. El gestor selecciona la opción "Cerrar sesión" en el pie del sidebar o en el drawer de navegación
2. El frontend llama a `POST /auth/logout` mediante el SDK generado
3. El sistema identifica al usuario desde el refresh token de la cookie `httpOnly`
4. El sistema registra el evento `logout` en `AUDIT_LOG` (`entidad = 'Usuario'`, `entidad_id = usuario_id`)
5. El sistema limpia la cookie del refresh token y responde 200/204
6. El frontend elimina el access token y la sesión de la memoria de la SPA
7. El frontend redirige al formulario de login en `/login`

**Flujos Alternativos:**
- **FA-01** (sesión ya inválida — doble logout): refresh token expirado, invalidado o ausente → el sistema responde 200/204 idempotentemente, **no registra `AUDIT_LOG`** (no hay usuario identificable) y limpia cualquier cookie presente. Nunca devuelve 401.
- **FA-02** (error de red): la llamada a `POST /auth/logout` falla sin respuesta del servidor → el frontend **limpia igualmente** el access token y la sesión de memoria, redirige a `/login` y muestra un aviso persistente de "modo degradado" (el refresh token en cookie caducará por TTL ~7 días; el usuario queda sin acceso efectivo en el cliente).

---

### ÁREA: GESTIÓN DE LEADS Y CONSULTAS

---

#### UC-03: Dar de Alta un Nuevo Lead

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-03 |
| **Nombre** | Dar de Alta un Nuevo Lead |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor introduce manualmente los datos de un potencial cliente (lead) proveniente de cualquier canal (formulario web, email, WhatsApp, Instagram, teléfono) |
| **Precondiciones** | - El gestor está autenticado<br>- Datos mínimos del lead disponibles (nombre, email, teléfono) |
| **Postcondiciones** | - Se crea una consulta en el sub-estado correspondiente (2.a, 2.b o 2.d)<br>- Si aplica, la fecha queda bloqueada<br>- Se genera un registro `COMUNICACION` con código E1: sin comentarios → `estado='enviado'` y el email se despacha vía `EnviarEmailPort`; con comentarios → `estado='borrador'` sin envío, la UI alerta al gestor del borrador pendiente |
| **Prioridad** | Crítica |
| **Frecuencia** | Muy alta (múltiples veces al día) |

**Flujo Básico:**
1. El gestor accede al formulario "Nueva consulta"
2. El gestor introduce los campos obligatorios:
   - Nombre y apellidos
   - Email
   - Teléfono
   - Canal de entrada
3. Opcionalmente, el gestor introduce:
   - Fecha del evento (**> hoy**, estrictamente futura; el selector de UI bloquea hoy y fechas pasadas, `min = mañana`)
   - Nº aproximado de invitados
   - Horas de evento (4/8/12)
   - Comentarios/notas adicionales
4. El gestor confirma el alta
5. El sistema valida los datos
6. El sistema ejecuta chequeo de disponibilidad de fecha (si fecha presente)
7. El sistema determina el sub-estado inicial:
   - Sin fecha → 2.a (consulta_exploratoria)
   - Con fecha libre → 2.b (consulta_con_fecha) + bloqueo 3 días
   - Con fecha bloqueada por 2.b → 2.d (consulta_en_cola)
   - Con fecha bloqueada por 2.c+ → 2.a
8. El sistema calcula tarifa estimada (si datos suficientes)
9. El sistema genera email E1:
   - Sin comentarios + campos suficientes → auto-envío
   - Con comentarios → borrador para revisión
10. El sistema registra la acción en audit log

**Flujos Alternativos:**
- **FA-01**: Fecha pasada **o fecha = hoy** introducida → Sistema bloquea en UI (selector solo permite fechas estrictamente futuras, `min = mañana`); bypass del lado servidor devuelve **400** sin crear `RESERVA` ni `FECHA_BLOQUEADA`. **Divergencia intencional (Gate 1, decisión A):** la ficha US-004 admitía `≥ hoy`; implementado `> hoy` para unificar la regla con `validarFechaFutura` (US-040) y el motor de tarifa (US-016). Fuente: `design.md §D-1`.
- **FA-02**: Email ya existe con reserva activa → Sistema alerta al gestor (detección recurrente - solo diseñado, no implementado en MVP)
- **FA-03**: Datos incompletos → Sistema muestra errores de validación

```mermaid
flowchart TD
    A[Gestor accede formulario] --> B[Introduce datos obligatorios]
    B --> C{¿Fecha presente?}
    C -->|No| D[Sub-estado 2.a<br>Sin bloqueo]
    C -->|Sí| E{¿Fecha disponible?}
    E -->|Libre| F[Sub-estado 2.b<br>Bloqueo 3 días]
    E -->|Bloqueada por 2.b| G[Sub-estado 2.d<br>Entra en cola]
    E -->|Bloqueada por 2.c+| D
    D --> H{¿Comentarios?}
    F --> H
    G --> I[Email cola + posición]
    H -->|No| J[Email E1 auto-envío]
    H -->|Sí| K[Email E1 borrador]
    I --> L[Consulta creada]
    J --> L
    K --> L
```

---

#### UC-04: Transicionar Consulta a Estado con Fecha (2.a → 2.b)

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-04 |
| **Nombre** | Transicionar Consulta a Estado con Fecha |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El Gestor añade una fecha concreta a una consulta **ya existente** en sub-estado `2.a` (exploratoria), sin crear un lead nuevo. La consulta pasa a bloquear esa fecha si está libre (`2.b`), entra en cola si la fecha la tiene bloqueada otra consulta en `2.b` (`2.d`), o permanece en `2.a` si la fecha no está disponible ni admite cola. Implementado en **US-005** (change `2026-06-29-us-005-transicion-exploratoria-a-con-fecha`). A diferencia de UC-03 (alta de un lead nuevo), aquí el agregado RESERVA ya existe y lo que cambia es su sub-estado. |
| **Precondiciones** | - Consulta en sub-estado `2.a` (guarda de origen; cualquier otro sub-estado produce 422 sin efectos)<br>- `fecha_evento` **> hoy** (estrictamente futura, regla unificada `esFechaEstrictamenteFutura`; el servidor rechaza hoy y pasado con 400 sin efectos)<br>- Gestor autenticado con rol gestor sobre el tenant |
| **Postcondiciones** | - **Fecha libre:** consulta pasa a `2.b`; `fecha_evento` y `ttl_expiracion = now() + ttl_consulta_dias` escritos; fila insertada en `FECHA_BLOQUEADA` (`tipo_bloqueo='blando'`); `AUDIT_LOG` con `accion='transicion'`; email de confirmación (extensión de E1) enviado post-commit<br>- **Fecha bloqueada por `2.b` + gestor acepta cola:** consulta pasa a `2.d`; `posicion_cola = MAX+1`; `consulta_bloqueante_id` apunta a la bloqueante; no se crea `FECHA_BLOQUEADA`<br>- **Fecha bloqueada por `2.b` + gestor rechaza:** consulta permanece en `2.a` sin cambios (409 `colaDisponible:true`)<br>- **Fecha bloqueada por `2.c/2.v/pre_reserva/confirmada+`:** consulta permanece en `2.a` sin cambios (409 `colaDisponible:false`) |
| **Prioridad** | Alta |
| **Frecuencia** | Alta |
| **US** | US-005 |
| **Endpoint** | `POST /reservas/{id}/fecha` — body `{ fechaEvento: "YYYY-MM-DD", aceptarCola?: boolean }` |
| **Entidades afectadas** | RESERVA (UPDATE), FECHA_BLOQUEADA (INSERT en `2.b`), COMUNICACION (UPSERT E1), AUDIT_LOG — sin migración de columnas |

**Flujo Básico (fecha libre → 2.b):**
1. El gestor abre la ficha de consulta `2.a` en la pantalla `/reservas/:id` (`FichaConsultaPage`)
2. El gestor hace clic en "Añadir fecha" e introduce la fecha (selector con `min = mañana`)
3. El sistema valida la guarda de origen: la RESERVA está en `2.a`
4. El sistema valida la fecha: estrictamente futura (`esFechaEstrictamenteFutura`)
5. El sistema consulta el estado de la fecha en `FECHA_BLOQUEADA` para el tenant
6. La fecha está libre: la máquina de estados resuelve `2.b` + `bloquear` vía `determinarAltaConFecha`
7. En una única transacción all-or-nothing: actualiza la RESERVA (`sub_estado='2b'`, `fecha_evento`, `ttl_expiracion`); inserta en `FECHA_BLOQUEADA` con `tipo_bloqueo='blando'` vía `bloquearEnTx`; registra `AUDIT_LOG` con `accion='transicion'`, `datos_anteriores.sub_estado='2a'`, `datos_nuevos.sub_estado='2b'`
8. Post-commit (no bloqueante): UPSERT de `COMUNICACION E1` (extensión de confirmación de bloqueo provisional) vía `ConfirmacionBloqueoEmailAdapter` + motor de email US-045; un fallo de envío no revierte la transición
9. El sistema responde `200` con `subEstado='2b'`, `fechaEvento`, `ttlExpiracion`

**Flujos Alternativos:**
- **FA-01** (fecha bloqueada por `2.b` — flujo interactivo de cola):
  - Primera llamada sin `aceptarCola`: el sistema devuelve **409** con `colaDisponible: true` y `motivo`; la RESERVA permanece en `2.a`. El gestor acepta o rechaza la cola
  - Segunda llamada con `aceptarCola: true`: la RESERVA pasa a `2.d`; `posicion_cola = MAX(posicion_cola de esa fecha)+1` (serializado por `SELECT … FOR UPDATE` sobre la fila bloqueante); `consulta_bloqueante_id` y `fecha_evento` escritos; sin nueva `FECHA_BLOQUEADA`. Responde `200` con `subEstado='2d'`, `posicionCola`, `consultaBloqueanteId`
  - Si el gestor rechaza: la RESERVA permanece en `2.a`; no se reenvía
- **FA-02** (fecha bloqueada por `2.c`/`2.v`/`pre_reserva`/`reserva_confirmada` o posteriores):
  - **409** con `colaDisponible: false`; no se ofrece cola; RESERVA permanece en `2.a` sin cambios
- **FA-03** (guarda de origen — RESERVA no en `2.a`):
  - **422** con mensaje de validación; la RESERVA no se modifica ni se crea `FECHA_BLOQUEADA`
- **FA-04** (fecha no válida por bypass de la UI):
  - `fecha_evento` = hoy o en el pasado: **400** sin efectos sobre la RESERVA ni `FECHA_BLOQUEADA`
- **FA-05** (concurrencia D4 — carrera sobre fecha libre):
  - Dos transiciones simultáneas hacia la misma fecha libre: una gana (`2.b` + `FECHA_BLOQUEADA`); la otra recibe `P2002 UNIQUE(tenant_id, fecha)` → re-deriva a `bloqueada-por-2b` → **409** `colaDisponible:true` (o entra en `2.d` si llevaba `aceptarCola:true`). Garantía determinista del motor PostgreSQL

```mermaid
flowchart TD
    A[Gestor: Añadir fecha a consulta 2.a] --> B{Guarda de origen: RESERVA en 2.a?}
    B -->|No| C[422 — Transición inválida sin efectos]
    B -->|Sí| D{fecha_evento > hoy?}
    D -->|No| E[400 — Fecha no válida sin efectos]
    D -->|Sí| F{Estado de la fecha en FECHA_BLOQUEADA}
    F -->|Libre| G[Tx: UPDATE RESERVA 2b + INSERT FECHA_BLOQUEADA blando + AUDIT_LOG transicion]
    G --> H[Post-commit: UPSERT COMUNICACION E1 motor US-045]
    H --> I[200 — subEstado=2b + ttlExpiracion]
    F -->|Bloqueada por 2b| J{aceptarCola?}
    J -->|false / ausente| K[409 — colaDisponible:true]
    J -->|true| L[Tx: UPDATE RESERVA 2d + posicion_cola + consulta_bloqueante_id + AUDIT_LOG]
    L --> M[200 — subEstado=2d + posicionCola]
    F -->|Bloqueada por 2c/2v/pre/conf+| N[409 — colaDisponible:false]
```

---

#### UC-05: Extender Plazo de Bloqueo

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-05 |
| **Nombre** | Extender Plazo de Bloqueo |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor extiende manualmente el TTL del bloqueo blando activo de una RESERVA antes de que expire, indicando N días enteros (≥ 1). El sistema prorroga `RESERVA.ttl_expiracion` y `FECHA_BLOQUEADA.ttl_expiracion` al mismo nuevo valor en una única transacción, sin cambiar estado, sub_estado, tipo_bloqueo ni fecha. Los recordatorios automáticos (A3/A4/A5) se reprograman implícitamente porque el barrido periódico los reevalúa contra el nuevo `ttl_expiracion`. |
| **Precondiciones** | - RESERVA con `sub_estado ∈ {2b, 2c, 2v}` O `estado = 'pre_reserva'`<br>- Fila activa en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'`<br>- `ttl_expiracion > ahora` (bloqueo aún vigente)<br>- Gestor autenticado con rol gestor sobre el tenant |
| **Postcondiciones** | - `RESERVA.ttl_expiracion = ttl_expiracion_actual + N días` (base = valor actual, no `now()`)<br>- `FECHA_BLOQUEADA.ttl_expiracion` actualizada al mismo nuevo valor en la misma transacción<br>- `estado`, `sub_estado`, `tipo_bloqueo` y `fecha` permanecen sin cambios<br>- `AUDIT_LOG` con `accion = 'actualizar'`, `entidad = 'RESERVA'`, `datos_anteriores.ttl_expiracion` y `datos_nuevos.ttl_expiracion`<br>- Recordatorios A3/A4/A5 reprogramados implícitamente vía barrido periódico (US-012) |
| **Prioridad** | Media |
| **Frecuencia** | Media |
| **US** | US-006 |
| **Endpoint** | `POST /reservas/{id}/extender-bloqueo` — body `{ "dias": <integer ≥ 1> }` |
| **Entidades afectadas** | RESERVA (UPDATE `ttl_expiracion`), FECHA_BLOQUEADA (UPDATE `ttl_expiracion`), AUDIT_LOG — sin migración (columnas y enums ya existentes desde US-000/US-040/US-004) |

**Flujo Básico:**
1. El gestor abre la ficha de consulta/pre-reserva con bloqueo blando activo (`2b`/`2c`/`2v`/`pre_reserva`) y TTL vigente
2. El gestor selecciona "Extender bloqueo" (acción visible y habilitada solo en esos estados con TTL vigente)
3. El sistema muestra la fecha de expiración actual (`ttl_expiracion`)
4. El gestor introduce N días de extensión (entero ≥ 1) y confirma
5. El sistema valida la guarda de precondición declarativa (`esEstadoConBloqueoBlandoExtensible`) y la presencia de la fila blanda vigente (`ttl_expiracion > ahora`)
6. El sistema valida que `dias` es entero ≥ 1
7. El sistema calcula `nuevoTtl = ttl_expiracion_actual + N días` (base = TTL actual, no `now()`)
8. En una única transacción con `SELECT … FOR UPDATE` sobre la fila bloqueante: UPDATE `RESERVA.ttl_expiracion = nuevoTtl` + UPDATE `FECHA_BLOQUEADA.ttl_expiracion = nuevoTtl` + INSERT `AUDIT_LOG accion='actualizar'`
9. El sistema devuelve la RESERVA con el nuevo `ttlExpiracion`; la UI muestra la nueva fecha de expiración

**Flujos Alternativos:**
- **FA-01** (TTL ya expirado): `RESERVA.ttl_expiracion < ahora` → el sistema responde `409` indicando que el bloqueo ha expirado; la RESERVA y su `FECHA_BLOQUEADA` no se modifican. La extensión no puede resucitar un bloqueo ya expirado-y-procesado por el barrido.
- **FA-02** (sin fila bloqueante activa): la RESERVA no tiene fila activa en `FECHA_BLOQUEADA` → el sistema responde `409`; sin mutación.
- **FA-03** (bloqueo firme — `reserva_confirmada`): `tipo_bloqueo = 'firme'` (sin TTL) → el sistema responde `409` indicando que el bloqueo firme no tiene TTL extensible; sin mutación.
- **FA-04** (estado sin bloqueo activo extensible — guarda de precondición): la RESERVA está en `2a` o en un estado terminal (`2x`, `2y`, `2z`, `reserva_cancelada`, `reserva_completada`) → el sistema responde `422`; sin mutación. La UI no muestra la acción para estos estados.
- **FA-05** (valor de extensión inválido): `dias` es 0, negativo o no entero → el sistema responde `422` ("El número de días de extensión debe ser un entero positivo (≥ 1)"); sin mutación.
- **FA-06** (RESERVA inexistente / cross-tenant): `404`.
- **FA-07** (sin sesión / rol insuficiente): `401`/`403`.
- **FA-08** (concurrencia con el barrido de expiración US-012): la extensión y el barrido se serializan por el `SELECT … FOR UPDATE` sobre la fila bloqueante; el estado final es determinista (extensión aplicada y bloqueo vigente, o bloqueo expirado y extensión rechazada), sin estados intermedios.

```mermaid
flowchart TD
    A[Gestor selecciona Extender bloqueo + N días] --> B{esEstadoConBloqueoBlandoExtensible?}
    B -->|No — 2a / terminal| C[422 — Sin bloqueo activo extensible]
    B -->|Sí| D{Fila activa en FECHA_BLOQUEADA con ttl > ahora?}
    D -->|Sin fila bloqueante| E[409 — Sin bloqueo activo]
    D -->|TTL expirado| F[409 — Bloqueo expirado]
    D -->|tipo_bloqueo = firme| G[409 — Bloqueo firme sin TTL]
    D -->|Bloqueo blando vigente| H{días entero ≥ 1?}
    H -->|No| I[422 — Valor de extensión inválido]
    H -->|Sí| J[Tx SELECT…FOR UPDATE sobre fila bloqueante]
    J --> K[UPDATE RESERVA: ttl_expiracion = ttl_actual + N días]
    K --> L[UPDATE FECHA_BLOQUEADA: mismo nuevo ttl_expiracion]
    L --> M[INSERT AUDIT_LOG: actualizar, datos_anteriores/nuevos.ttl_expiracion]
    M --> N[200 — RESERVA con nuevo ttlExpiracion]
```

---

#### UC-06: Transicionar a Pendiente de Invitados (2.b → 2.c)

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-06 |
| **Nombre** | Transicionar a Pendiente de Invitados |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El Gestor marca una consulta con fecha bloqueada (`2.b`) como "pendiente de número de invitados" cuando el cliente tiene intención firme sobre la fecha pero aún no confirma el aforo. El sistema extiende el bloqueo, vacía atómicamente la cola de espera y registra la transición. |
| **Precondiciones** | - Consulta en `sub_estado = '2b'` (única origen legal del happy path; D-1 de US-007)<br>- Fila activa en `FECHA_BLOQUEADA` para `(tenant_id, fecha_evento)` (`tipo_bloqueo = 'blando'`)<br>- `ttl_expiracion > ahora` (bloqueo vigente)<br>- Gestor autenticado con rol gestor sobre el tenant |
| **Postcondiciones** | - Consulta pasa a `sub_estado = '2c'`<br>- `ttl_expiracion = ttl_expiracion_actual + TENANT_SETTINGS.ttl_consulta_dias` (+3 días por defecto, derivado del setting, nunca hardcodeado)<br>- Fila en `FECHA_BLOQUEADA` actualizada al mismo nuevo `ttl_expiracion`<br>- Todas las RESERVA con `consulta_bloqueante_id = id de esta RESERVA` y `sub_estado = '2d'` pasan a `sub_estado = '2y'` (vaciado de cola, mecánica A16); `posicion_cola = NULL` y `consulta_bloqueante_id = NULL`<br>- Las cuatro operaciones ocurren en una **única transacción** all-or-nothing (serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`)<br>- `AUDIT_LOG` con `accion = 'transicion'` para la RESERVA principal y para cada RESERVA descartada de la cola<br>- **Email de solicitud de nº de invitados (UC-06 paso 7): fuera de alcance en MVP** (gap de spec D-7: §9.3 no asigna E-code a este email; pendiente de decisión del product owner — catalogar nuevo E-code o gestión manual desde el log de comunicaciones) |
| **Prioridad** | Alta |
| **Frecuencia** | Media |
| **US** | US-007 |
| **Endpoint** | `POST /reservas/{id}/pendiente-invitados` — body vacío o `{}` |
| **Entidades afectadas** | RESERVA (UPDATE estado + TTL), FECHA_BLOQUEADA (UPDATE TTL), AUDIT_LOG — sin migración de columnas (sub-estados `2c`/`2y` y campos de cola/TTL existen desde US-000/US-040/US-004) |

**Flujo Básico:**
1. El gestor abre la ficha de consulta `2.b` en la pantalla de la reserva
2. El gestor selecciona "Marcar como pendiente de invitados" (acción visible y habilitada solo cuando hay bloqueo activo en `2.b`) y confirma
3. El sistema valida la guarda de origen: la RESERVA está en `sub_estado = '2b'`
4. El sistema valida la precondición de bloqueo: existe fila activa en `FECHA_BLOQUEADA` con `ttl_expiracion > ahora`
5. El sistema resuelve el plan de extensión vía `resolverPlanBloqueo({ fase: '2.c' })` → `ttl = ttl_expiracion_actual + ttl_consulta_dias`
6. En una única transacción all-or-nothing serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`:
   - Actualiza la RESERVA: `sub_estado = '2c'`, nuevo `ttl_expiracion`
   - Actualiza la fila de `FECHA_BLOQUEADA` al mismo nuevo `ttl_expiracion`
   - Actualiza todas las RESERVA en `2d` con `consulta_bloqueante_id = id de esta RESERVA`: `sub_estado = '2y'`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL` (si la cola está vacía, el UPDATE afecta a 0 filas, sin error)
   - Registra `AUDIT_LOG` con `accion = 'transicion'` para la RESERVA principal y para cada RESERVA descartada
7. El sistema responde `200` con `subEstado = '2c'`, `ttlExpiracion` (nuevo) y `consultasDescartadas` (recuento de RESERVA de cola pasadas a `2.y`)

**Flujos Alternativos:**
- **FA-01** (sin fecha bloqueada): la RESERVA no tiene fila activa en `FECHA_BLOQUEADA` → el sistema responde `409` indicando que la transición a `2.c` requiere fecha bloqueada activa; la RESERVA no se modifica. La UI puede deshabilitar la acción preventivamente; la validación es también defensiva en servidor.
- **FA-02** (TTL expirado): la RESERVA está en `2.b` pero `ttl_expiracion < ahora` → el sistema responde `409` indicando que el bloqueo ha expirado; la RESERVA no se modifica.
- **FA-03** (guarda de origen — RESERVA no en `2.b`): la RESERVA está en `2.a`, `2.c`, `2.v`, un estado terminal (`2.x`, `2.y`, `2.z`) o `reserva_cancelada`/`reserva_completada` → el sistema responde `422`; la RESERVA no se modifica, ni su `FECHA_BLOQUEADA`, ni ninguna consulta de cola. Los terminales son inmutables.
- **FA-04** (concurrencia): dos peticiones simultáneas de transición a `2.c` sobre la misma RESERVA → exactamente una aplica el cambio; la otra observa que la RESERVA ya no está en `2.b` y recibe la guarda de origen (`422`). Sin doble extensión de TTL ni doble vaciado de cola.

```mermaid
flowchart TD
    A[Gestor: Marcar como pendiente de invitados en 2.b] --> B{Guarda de origen: RESERVA en 2.b?}
    B -->|No 2.b| C[422 — Transición inválida sin efectos]
    B -->|Sí| D{Fila activa en FECHA_BLOQUEADA y ttl > ahora?}
    D -->|Sin bloqueo| E[409 — Sin fecha bloqueada activa]
    D -->|TTL expirado| F[409 — Bloqueo expirado]
    D -->|Bloqueo vigente| G[Tx SELECT…FOR UPDATE sobre fila bloqueante]
    G --> H[UPDATE RESERVA: 2c + ttl_expiracion + ttl_consulta_dias]
    H --> I[UPDATE FECHA_BLOQUEADA: mismo nuevo ttl_expiracion]
    I --> J[UPDATE RESERVA 2d → 2y + posicion_cola=NULL + consulta_bloqueante_id=NULL]
    J --> K[AUDIT_LOG transicion RESERVA principal + cada descartada]
    K --> L[200 — subEstado=2c + ttlExpiracion + consultasDescartadas]
```

> **Gap de spec D-7 (abierto, pendiente de decisión del product owner):** UC-06 paso 7 describe el envío de un email al cliente solicitando el número de invitados, pero `§9.3` no le asigna código `E` (E1–E8). La regla del proyecto prohíbe referenciar emails fuera del catálogo E1–E8. Este email **no se implementa en MVP**; queda registrado como gap de spec hasta que el PO decida: (a) catalogarlo como nuevo E-code, o (b) gestionarlo manualmente desde el log de comunicaciones. Los emails automáticos de vaciado de cola a los clientes en `2.d` (A16) también son solo diseñados en MVP: la mecánica del vaciado sí se implementa; los emails de cola no. Fuente: `design.md §D-7`; `US-007 §Notas de alcance`.

---

#### UC-07: Programar Visita al Espacio (→ 2.v)

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-07 |
| **Nombre** | Programar Visita al Espacio |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema, Cliente |
| **Descripción** | El Gestor programa una visita presencial al espacio para un cliente interesado y transiciona la consulta al sub-estado `2.v`. La transición bloquea la fecha del evento hasta el día posterior a la visita y envía automáticamente el email E6 de confirmación al cliente. Implementado en **US-008** (change `2026-06-30-us-008-programar-visita-espacio`). |
| **Precondiciones** | - Consulta en `sub_estado ∈ {'2a','2b','2c'}` (guarda de origen; `2d` y terminales producen error sin efectos)<br>- Para `2a`: `fecha_evento` debe estar definida (NOT NULL)<br>- `fecha_visita ∈ [hoy + 1 día, hoy + TENANT_SETTINGS.max_dias_programar_visita]` (ventana por defecto de 7 días)<br>- Gestor autenticado con rol gestor sobre el tenant |
| **Postcondiciones** | - Consulta pasa a `sub_estado = '2v'`<br>- `visita_programada_fecha = fecha_visita`, `visita_programada_hora = hora_visita`, `visita_realizada = false`<br>- `FECHA_BLOQUEADA`: si origen `2b`/`2c` (ya tenía fila activa) → UPDATE del `ttl_expiracion` a `visita + 1 día (23:59:59)`; si origen `2a` (sin bloqueo) → INSERT nueva fila `tipo_bloqueo='blando'`, `ttl_expiracion = visita + 1 día (23:59:59)`. `tipo_bloqueo` permanece/es `'blando'`<br>- `AUDIT_LOG` con `accion='transicion'`, `entidad='RESERVA'`, `datos_anteriores.sub_estado` (origen), `datos_nuevos.sub_estado='2v'`, `datos_nuevos.visita_programada_fecha`<br>- Las cuatro operaciones son **all-or-nothing** en una única transacción<br>- Post-commit: email E6 (confirmación de visita con fecha y hora) enviado al cliente; registrado en `COMUNICACION` con `codigo_email='E6'`, `estado='enviado'`, `reserva_id`, `cliente_id` |
| **Prioridad** | Alta |
| **Frecuencia** | Media |
| **US** | US-008 |
| **Endpoint** | `POST /reservas/{id}/visita` — body `{ "fecha": "YYYY-MM-DD", "hora": "HH:mm" }` |
| **Entidades afectadas** | RESERVA (UPDATE sub_estado + campos visita), FECHA_BLOQUEADA (INSERT o UPDATE ttl_expiracion), COMUNICACION (INSERT E6), AUDIT_LOG — sin migración de columnas (campos de visita + sub-estado `2v` + setting ya existentes desde US-000) |

**Flujo Básico (desde 2.b):**
1. El gestor abre la ficha de consulta `2.b` en la pantalla de la reserva
2. El gestor selecciona "Programar visita" (acción habilitada para `2a`/`2b`/`2c` con `fecha_evento` definida; deshabilitada/oculta en `2d`, terminales y `2a` sin `fecha_evento`)
3. El gestor introduce `fecha_visita` (selector limitado a `[mañana, hoy + max_dias_programar_visita]`) y hora, y confirma
4. El sistema valida la guarda de origen: `sub_estado ∈ {'2a','2b','2c'}`
5. El sistema valida la ventana de fecha: `fecha_visita ∈ [hoy + 1, hoy + TENANT_SETTINGS.max_dias_programar_visita]` (setting nunca hardcodeado)
6. El sistema resuelve el plan de bloqueo vía `resolverPlanBloqueo({ fase: '2.v', visitaFecha })` → `{ ttl = visita +1 día (23:59:59), accion: 'insert' | 'update' }` según si hay fila activa en `FECHA_BLOQUEADA`
7. En una única transacción all-or-nothing serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`:
   - Actualiza la RESERVA: `sub_estado = '2v'`, `visita_programada_fecha`, `visita_programada_hora`, `visita_realizada = false`
   - UPDATE (o INSERT si origen `2a`) de `FECHA_BLOQUEADA`: `ttl_expiracion = visita + 1 día (23:59:59)`; `tipo_bloqueo = 'blando'`
   - Registra `AUDIT_LOG` con `accion = 'transicion'`, `datos_anteriores.sub_estado = '2b'`, `datos_nuevos.sub_estado = '2v'`, `datos_nuevos.visita_programada_fecha`
8. Post-commit (no bloqueante): dispara E6 vía el motor de email de US-045; registra en `COMUNICACION` con `codigo_email = 'E6'`, `estado = 'enviado'`; un fallo del proveedor no revierte la transición (queda trazado en `COMUNICACION`)
9. El sistema responde `200` con `subEstado = '2v'`, `visitaProgramadaFecha`, `visitaProgramadaHora`, `visitaRealizada = false`, `ttlExpiracion` (nuevo)

**Flujos Alternativos:**
- **FA-01** (consulta en cola — `2d`): el sistema responde **409** con mensaje "No es posible programar una visita para una consulta en cola. La consulta debe ser promovida primero (UC-12)"; la RESERVA no se modifica. La acción está deshabilitada en UI para `2d`.
- **FA-02** (origen `2a` sin `fecha_evento`): el sistema informa de que debe introducirse primero la fecha del evento; la acción queda bloqueada hasta que `fecha_evento` esté definida. Responde **422** sin efectos.
- **FA-03** (fecha de visita ≤ hoy): el sistema responde **422** "La fecha de visita debe ser un día futuro"; la RESERVA no se modifica.
- **FA-04** (fecha de visita > hoy + `max_dias_programar_visita`): el sistema responde **422** "La visita debe programarse dentro de los próximos {N} días"; la RESERVA no se modifica.
- **FA-05** (estado terminal — `2x`/`2y`/`2z`/`reserva_cancelada`/`reserva_completada`): el sistema responde **422**; los terminales son inmutables; la RESERVA no se modifica.
- **FA-06** (concurrencia — barrido A4 vs transición a `2v`): la serialización por `SELECT … FOR UPDATE` sobre la fila bloqueante garantiza que la primera transacción en commitear gana y la otra opera sobre un estado ya cambiado respetando las guardas; nunca estado inconsistente.

```mermaid
flowchart TD
    A[Gestor: Programar visita en 2.a/2.b/2.c] --> B{Guarda de origen: sub_estado ∈ 2a|2b|2c?}
    B -->|2d| C[409 — Promover primero UC-12]
    B -->|Terminal| D[422 — Estado inmutable]
    B -->|2a sin fecha_evento| E[422 — Introducir fecha_evento primero]
    B -->|Válido| F{fecha_visita ∈ hoy+1..hoy+N?}
    F -->|≤ hoy| G[422 — Fecha futura obligatoria]
    F -->|> hoy+N| H[422 — Fuera de ventana]
    F -->|Válida| I[Tx SELECT…FOR UPDATE sobre fila bloqueante]
    I --> J[UPDATE RESERVA: 2v + campos visita + visita_realizada=false]
    J --> K{Origen tenía FECHA_BLOQUEADA?}
    K -->|2b ó 2c| L[UPDATE FECHA_BLOQUEADA: ttl = visita +1 día]
    K -->|2a sin bloqueo| M[INSERT FECHA_BLOQUEADA: blando, ttl = visita +1 día]
    L --> N[AUDIT_LOG transicion: 2v + visita_programada_fecha]
    M --> N
    N --> O[200 — subEstado=2v + visitaProgramadaFecha/Hora + ttlExpiracion]
    O --> P[Post-commit: E6 motor US-045 → COMUNICACION E6 enviado]
```

---

#### UC-08: Registrar Resultado de Visita

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-08 |
| **Nombre** | Registrar Resultado de Visita |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor registra el resultado de una visita programada. El flujo "cliente interesado" (2.v → 2.b) está implementado en **US-009**; el flujo "reserva inmediata" (2.v → pre_reserva) está implementado en **US-010**. El flujo "descarte" (2.v → 2.z) está definido en US-011. |
| **Precondiciones** | - Consulta en `sub_estado = '2v'` (guarda de origen; cualquier otro sub-estado produce 422 sin efectos)<br>- Gestor autenticado con rol gestor sobre el tenant |
| **Postcondiciones** | **Flujo "cliente interesado" (US-009):** `visita_realizada = true`; `sub_estado = '2b'`; `ttl_expiracion = now() + TENANT_SETTINGS.ttl_consulta_dias` (TTL fresco, calculado desde el momento de la transición, nunca acumulado sobre el anterior ni derivado de `visita_programada_fecha`); `FECHA_BLOQUEADA.ttl_expiracion` actualizado al mismo valor (`tipo_bloqueo` permanece `blando`); `AUDIT_LOG accion='transicion'`; email E7 post-commit. Todo atómico.<br>**Flujo "reserva inmediata" (US-010):** `visita_realizada = true`; `estado = 'pre_reserva'`; `sub_estado = NULL` (pre_reserva no tiene sub-estado de consulta); `ttl_expiracion = now() + TENANT_SETTINGS.ttl_prereserva_dias` (7 días, TTL fresco calculado desde el instante de la transición); `FECHA_BLOQUEADA.ttl_expiracion` actualizado al mismo valor (`tipo_bloqueo` permanece `blando`); cola A16 vaciada atómicamente (`2d → 2y`); `AUDIT_LOG accion='transicion'`; sin email propio (E2 se delega a UC-14). Precondición adicional: datos obligatorios UC-14 completos (ver FA-10). Todo atómico. |
| **Prioridad** | Alta |
| **Frecuencia** | Media |
| **US** | US-009 (cliente interesado — 2.v → 2.b); US-010 (reserva inmediata — 2.v → pre_reserva); US-011 (descarte) |
| **Endpoint** | `PATCH /reservas/{id}/visita` — body `{ "resultado": "interesado" \| "reserva_inmediata" }` (operationId `registrarResultadoVisita`); polimórfico: el campo `resultado` determina la transición ejecutada |
| **Entidades afectadas** | RESERVA (UPDATE `sub_estado`/`estado`, `visita_realizada`, `ttl_expiracion`), FECHA_BLOQUEADA (UPDATE `ttl_expiracion`), COMUNICACION (INSERT E7 — solo US-009), AUDIT_LOG — sin migración de columnas (todos los campos ya existían desde US-000/US-008) |

**Flujo Básico A — cliente confirma interés (US-009):**
1. El gestor abre la ficha de consulta en `sub_estado = '2v'`
2. El gestor selecciona "Registrar resultado de visita" → "Cliente interesado" (acción visible y habilitada solo en `2v`)
3. El gestor confirma la acción en el diálogo `RegistrarResultadoVisitaDialog`
4. El sistema valida la guarda de origen: la RESERVA está en `sub_estado = '2v'` (`esOrigenValidoParaResultadoVisitaInteresado`); cualquier otro sub-estado o estado terminal produce 422 sin efectos
5. En una única transacción all-or-nothing serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`:
   - Actualiza la RESERVA: `sub_estado = '2b'`, `visita_realizada = true`, `ttl_expiracion = now() + TENANT_SETTINGS.ttl_consulta_dias`
   - Actualiza `FECHA_BLOQUEADA.ttl_expiracion` al mismo nuevo valor; `tipo_bloqueo` permanece `blando`
   - Registra `AUDIT_LOG` con `accion = 'transicion'`, `datos_anteriores.sub_estado = '2v'`, `datos_anteriores.visita_realizada = false`, `datos_nuevos.sub_estado = '2b'`, `datos_nuevos.visita_realizada = true`
6. Post-commit (no bloqueante): dispara E7 vía motor de email US-045; registra `COMUNICACION` con `codigo_email = 'E7'`, `estado = 'enviado'`; un fallo del proveedor no revierte la transición (queda trazado con `estado = 'fallido'`)
7. El sistema responde `200` con `subEstado = '2b'`, `visitaRealizada = true`, `ttlExpiracion` (nuevo TTL fresco)
8. La UI de la ficha de reserva refleja el nuevo sub-estado y el TTL actualizado

**Flujo Básico B — cliente quiere reservar inmediatamente (US-010 / UC-08 FA-08 / UC-14):**
1. El gestor abre la ficha de consulta en `sub_estado = '2v'` con todos los datos obligatorios completos en RESERVA (`fecha_evento`, `duracion_horas`, `tipo_evento`, `num_adultos_ninos_mayores4`) y CLIENTE (`dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`)
2. El gestor selecciona "Registrar resultado de visita" → "Cliente quiere reservar ahora" (visible solo en `2v`)
3. El gestor confirma la acción; el frontend verifica los datos obligatorios y bloquea la confirmación si faltan campos (mostrando la lista de `camposFaltantes`)
4. El sistema valida en servidor la guarda de origen (`esOrigenValidoParaResultadoVisitaReservaInmediata`): solo `sub_estado = '2v'` es válido; cualquier otro produce 422 sin efectos
5. El sistema valida los datos obligatorios UC-14 (patrón `CampoFiscalFaltante`): si falta algún campo → 422 con `camposFaltantes[]`, RESERVA intacta en `2v`
6. En una única transacción all-or-nothing serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`:
   - Actualiza la RESERVA: `estado = 'pre_reserva'`, `sub_estado = NULL`, `visita_realizada = true`, `ttl_expiracion = now() + TENANT_SETTINGS.ttl_prereserva_dias`
   - Actualiza `FECHA_BLOQUEADA.ttl_expiracion` al mismo valor; `tipo_bloqueo` permanece `blando` — UPDATE puro (la fila siempre existe al venir de `2.v`)
   - Vacía la cola A16: todas las RESERVA con `consulta_bloqueante_id = id` y `sub_estado = '2d'` pasan a `sub_estado = '2y'`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL` (válido con 0 filas)
   - Registra `AUDIT_LOG accion = 'transicion'` para la RESERVA principal (`datos_anteriores.sub_estado = '2v'`, `datos_nuevos.estado = 'pre_reserva'`, `datos_nuevos.sub_estado = NULL`, `datos_nuevos.visita_realizada = true`) y para cada consulta vaciada de la cola
7. El sistema responde `200` con `estado = 'pre_reserva'`, `subEstado = null`, `visitaRealizada = true`, `ttlExpiracion` (now + 7 días)
8. La UI refleja el nuevo estado `pre_reserva`, el TTL de 7 días y, si había cola, el feedback de cola vaciada

**Flujos Alternativos:**
- **FA-01** (visita_programada_fecha futura — no bloquea el registro): `visita_programada_fecha > hoy` **no** es una precondición de validación estricta; el sistema permite la acción igualmente. La transición procede y el TTL se calcula desde `now()`, no desde `visita_programada_fecha`.
- **FA-02** (guarda de origen — RESERVA no en `2v`): el sistema responde **422** sin efectos sobre RESERVA, FECHA_BLOQUEADA ni COMUNICACION. La acción "Cliente interesado" está oculta/deshabilitada en UI para cualquier sub-estado distinto de `2v`.
- **FA-03** (RESERVA en estado terminal — `2x`/`2y`/`2z`/`reserva_cancelada`/`reserva_completada`): el sistema responde **422**; los estados terminales son inmutables.
- **FA-04** (RESERVA inexistente o de otro tenant): **404** por RLS.
- **FA-05** (sin sesión o rol insuficiente): **401**/**403**.
- **FA-06** (concurrencia con barrido US-012 — flujo A): si el barrido de expiración A21 commite primero, la RESERVA pasa a `2x` y el registro del resultado recibe la guarda de origen (422 — ya no está en `2v`); si el registro commite primero, US-012 no encuentra la RESERVA como candidata en `2v` y no actúa sobre ella. Nunca estado intermedio (`2b` sin `FECHA_BLOQUEADA` actualizada). Serialización por `SELECT … FOR UPDATE`.
- **FA-07** (fallo del proveedor de email E7 — flujo A): no revierte la transición de estado; `COMUNICACION.estado = 'fallido'` queda registrado.
- **FA-08**: Cliente quiere reservar inmediatamente → flujo B (US-010, descrito arriba como Flujo Básico B).
- **FA-09**: Cliente descarta → US-011 (transición a `2.z` + liberación de fecha — fuera de alcance).
- **FA-10** (datos obligatorios incompletos — flujo B / US-010): si la RESERVA o el CLIENTE tienen campos faltantes del conjunto UC-14 (`fecha_evento`, `duracion_horas`, `tipo_evento`, `num_adultos_ninos_mayores4`, `dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`) → el sistema responde **422** con `camposFaltantes[]`; la RESERVA permanece en `sub_estado = '2v'` sin ningún cambio (ni en `FECHA_BLOQUEADA` ni en la cola). La opción puede permitir completar los datos en el mismo paso antes de reintentar.
- **FA-11** (cola vacía — flujo B / US-010): si no hay consultas en `2.d` apuntando a la RESERVA, el vaciado de cola A16 es una operación vacía (0 filas afectadas); la transición procede sin error.
- **FA-12** (concurrencia — flujo B / US-010): (a) si otra transacción intenta insertar un nuevo bloqueo para la misma `(tenant_id, fecha_evento)` → `UNIQUE(tenant_id, fecha)` garantiza una sola fila; la insertadora recibe violación de unicidad (sin doble bloqueo); (b) si otra transacción modifica `posicion_cola` de una consulta en `2d` de esa cola → `SELECT … FOR UPDATE` serializa ambas transacciones; el estado final es coherente (ninguna RESERVA en `2d` con `consulta_bloqueante_id` apuntando a una RESERVA ya en `pre_reserva`).

```mermaid
flowchart TD
    A[Gestor: Registrar resultado de visita en sub_estado=2v] --> B{Guarda de origen: RESERVA en 2v?}
    B -->|No — otro sub_estado o terminal| C[422 — Transición inválida sin efectos]
    B -->|Sí| D{resultado?}
    D -->|interesado| E[Tx SELECT…FOR UPDATE sobre fila bloqueante FECHA_BLOQUEADA]
    E --> F[UPDATE RESERVA: sub_estado=2b + visita_realizada=true + ttl=now+ttl_consulta_dias]
    F --> G[UPDATE FECHA_BLOQUEADA: ttl_expiracion=nuevo valor, tipo_bloqueo permanece blando]
    G --> H[INSERT AUDIT_LOG: transicion, datos_anteriores.sub_estado=2v, datos_nuevos.sub_estado=2b]
    H --> I[200 — subEstado=2b + visitaRealizada=true + ttlExpiracion fresco]
    I --> J[Post-commit: E7 motor US-045 → COMUNICACION E7 enviado/fallido]
    D -->|reserva_inmediata| K{Datos obligatorios UC-14 completos?}
    K -->|No — campos faltantes| L[422 — camposFaltantes, RESERVA intacta en 2v]
    K -->|Sí| M[Tx SELECT…FOR UPDATE sobre fila bloqueante FECHA_BLOQUEADA]
    M --> N[UPDATE RESERVA: estado=pre_reserva + sub_estado=NULL + visita_realizada=true + ttl=now+ttl_prereserva_dias]
    N --> O[UPDATE FECHA_BLOQUEADA: ttl_expiracion=mismo valor, tipo_bloqueo permanece blando]
    O --> P[Vaciado cola A16: 2d→2y, posicion_cola=NULL, consulta_bloqueante_id=NULL]
    P --> Q[INSERT AUDIT_LOG: transicion RESERVA + por cada consulta vaciada]
    Q --> R[200 — estado=pre_reserva + subEstado=null + visitaRealizada=true + ttlExpiracion 7d]
```

---

#### UC-09: Expirar Consulta Automáticamente

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-09 |
| **Nombre** | Expirar Consulta Automáticamente |
| **Actor Principal** | Sistema |
| **Actores Secundarios** | Gestor |
| **Descripción** | El sistema expira automáticamente una consulta o pre-reserva cuando su TTL de bloqueo blando se agota sin avance. Implementado en **US-012** mediante job asíncrono de barrido periódico (`POST /cron/barrido-expiracion`), con scheduler registrado dinámicamente vía `SchedulerRegistry`; expresión por defecto `'0 * * * *'` (cada hora), configurable por `CRON_BARRIDO_EXPIRACION`. |
| **Precondiciones** | - RESERVA con `ttl_expiracion < now()` **Y** (`sub_estado ∈ {2b, 2c, 2v}` **O** `estado = 'pre_reserva'`)<br>- El bloqueo es blando (`tipo_bloqueo = 'blando'`); los bloqueos firmes no tienen TTL y no son candidatos<br>- El job de barrido se dispara con frecuencia configurable por `CRON_BARRIDO_EXPIRACION` (default cada hora, `'0 * * * *'`); si `CRON_TOKEN` está ausente, el disparo automático se desactiva (el endpoint sigue disponible para invocación manual/externa) |
| **Postcondiciones** | - RESERVA transiciona al estado terminal por TTL: `2b/2c/2v → 2x`; `pre_reserva → reserva_cancelada` (mapa declarativo `MAPA_EXPIRACION_TTL` / `resolverExpiracionTtl`)<br>- Fila de `FECHA_BLOQUEADA` eliminada vía `liberarFecha()` (US-041, causa `TTL`), idempotente (0 filas = éxito silencioso)<br>- Si la RESERVA tenía cola activa (`2b`/`2v`): seam `PromocionColaPort` disparado exactamente una vez; el adaptador real `PromocionColaPrismaAdapter` (US-018) ejecuta la promoción FIFO completa: `2d → 2b`, re-bloqueo atómico, reordenación y alerta interna al gestor<br>- `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`<br>- El fallo de una candidata no aborta el lote (fallo aislado por RESERVA)<br>- Respuesta `BarridoExpiracionResponse`: `candidatas`, `expiradas`, `promocionesDisparadas`, `fallos` |
| **Prioridad** | Crítica |
| **Frecuencia** | Media (barrido automático cada hora por defecto; configurable con `CRON_BARRIDO_EXPIRACION`) |
| **US** | US-012 |
| **Endpoint** | `POST /cron/barrido-expiracion` — auth `X-Cron-Token` (no JWT); sin body |

**Flujo Básico:**
1. El scheduler registrado dinámicamente vía `SchedulerRegistry` (expresión `CRON_BARRIDO_EXPIRACION`, default `'0 * * * *'`, cada hora) invoca `POST /cron/barrido-expiracion`; el `CronTokenGuard` valida la cabecera `X-Cron-Token` contra `CRON_TOKEN` del entorno. Si `CRON_TOKEN` está ausente, el disparo automático no se activa; el endpoint puede invocarse manualmente
2. El barrido selecciona todas las RESERVA con `ttl_expiracion < now()` AND (`sub_estado ∈ {2b,2c,2v}` OR `estado = 'pre_reserva'`), comparando instantes (`timestamptz`), **cross-tenant** (proceso de Sistema, único punto legítimo de lectura global)
3. Por cada candidata, en su propia transacción serializada (`SELECT … FOR UPDATE` sobre la fila `FECHA_BLOQUEADA` + `UNIQUE(tenant_id, fecha)`), bajo el contexto RLS del tenant de la RESERVA (`SET LOCAL app.tenant_id`):
   - Resuelve el estado terminal via `resolverExpiracionTtl` (mapa declarativo): `2b/2c/2v → 2x`; `pre_reserva → reserva_cancelada`
   - Llama a `liberarFecha()` (US-041): DELETE idempotente de `FECHA_BLOQUEADA`, causa `TTL`
   - Registra `AUDIT_LOG` con `accion = 'transicion'`
   - Si la RESERVA tenía cola activa: dispara el seam `PromocionColaPort` exactamente una vez
4. Si la candidata ya fue procesada (estado terminal), se omite sin error (idempotencia)
5. Si el procesamiento de una candidata falla, el rollback es aislado a esa RESERVA; el resto del lote continúa
6. El barrido responde `200` con `BarridoExpiracionResponse`

**Flujos Alternativos:**
- **FA-01** (sin `X-Cron-Token` válido): el sistema devuelve `401` sin ejecutar ningún barrido
- **FA-02** (candidata ya expirada/terminal bajo lock): la guarda de origen la excluye; 0 mutaciones, éxito silencioso (idempotencia)
- **FA-03** (concurrencia con US-006 extensión de bloqueo): la serialización por `SELECT … FOR UPDATE` garantiza que extensión y barrido no se solapan; uno observa el estado del otro y actúa en consecuencia (extensión con TTL ya vigente / barrido rechazado por TTL recién extendido)

```mermaid
flowchart TD
    A[Scheduler: cron dinámico, default cada hora → POST /cron/barrido-expiracion] --> B{X-Cron-Token válido?}
    B -->|No| C[401 — Sin autorización]
    B -->|Sí| D[Seleccionar candidatas: ttl_expiracion < now AND sub_estado ∈ 2b|2c|2v OR estado=pre_reserva — cross-tenant]
    D --> E{¿Candidatas?}
    E -->|Ninguna| F[200 — BarridoExpiracionResponse 0 candidatas]
    E -->|N candidatas| G[Por cada candidata: Tx propia SELECT…FOR UPDATE + SET LOCAL tenant_id]
    G --> H[resolverExpiracionTtl: 2b/2c/2v → 2x; pre_reserva → reserva_cancelada]
    H --> I[liberarFecha causa=TTL — DELETE idempotente FECHA_BLOQUEADA]
    I --> J[AUDIT_LOG transicion]
    J --> K{Cola activa en 2b/2v?}
    K -->|Sí| L[Dispara PromocionColaPort — adaptador real US-018: FIFO + re-bloqueo + reordenación]
    K -->|No| M[Siguiente candidata]
    L --> M
    G --> N[Fallo aislado → rollback solo esa Tx, resto continúa]
    M --> O[200 — BarridoExpiracionResponse candidatas/expiradas/promocionesDisparadas/fallos]
```

---

#### UC-10: Marcar Consulta como Descartada por Cliente

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-10 |
| **Nombre** | Marcar Consulta como Descartada por Cliente |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El Gestor registra que el cliente ha comunicado explícitamente su desistimiento, transicionando la consulta al sub-estado terminal `2z`. Es la variante manual de A17 (no hay portal de cliente en MVP). Los efectos secundarios dependen del sub-estado de origen: liberación de `FECHA_BLOQUEADA` si había bloqueo activo, promoción FIFO (A15) si había cola, o reordenación de la cola si la consulta era un elemento de ella. Implementado en **US-013** (change `us-013-descartar-consulta-por-cliente`). |
| **Precondiciones** | - RESERVA en `estado = 'consulta'` con `sub_estado ∈ {2a, 2b, 2c, 2d, 2v}` (guarda de origen; terminales `2x`/`2y`/`2z` y estados `reserva_cancelada`/`reserva_completada` se rechazan sin efectos)<br>- Gestor autenticado con rol gestor sobre el tenant |
| **Postcondiciones** | La transición a `sub_estado = '2z'` y todos sus efectos ocurren en una **única transacción all-or-nothing** bajo el contexto RLS del tenant, serializada por `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA` (cuando el origen tiene bloqueo) y/o la RESERVA. Efectos por origen:<br>- **`2a`**: solo marca `2z`; no hay `FECHA_BLOQUEADA` ni cola que tocar<br>- **`2b`/`2c`/`2v` (sin cola)**: `2z` + `liberarFecha()` elimina la fila de `FECHA_BLOQUEADA`; si la cola resultante es vacía, sin acción adicional<br>- **`2b`/`2v` (con cola activa)**: `2z` + `liberarFecha()` + disparo de `PromocionColaPort.promoverPrimeroEnCola()` **una sola vez** (seam A15, mecánica UC-12 / US-018): la primera en cola (`posicion_cola = 1`) pasa a `2b`, re-bloqueo atómico vía `bloquearFecha()` y reordenación del resto re-apuntando `consulta_bloqueante_id`<br>- **`2d`** (en cola de otra bloqueante `B`): `2z` + `posicion_cola → NULL` + `consulta_bloqueante_id → NULL`; decremento de `posicion_cola` de todas las RESERVA en `2d` con el mismo `consulta_bloqueante_id = B` y `posicion_cola > P`; la bloqueante `B` no se modifica; no se libera `FECHA_BLOQUEADA`<br>- **Motivo opcional**: si el Gestor provee motivo, se **anexa** a `RESERVA.notas` como `notas_previas + "\n[descarte cliente] " + motivo`; si no se proporciona, `notas` permanece sin cambios<br>- `AUDIT_LOG`: `accion='transicion'`, `entidad='RESERVA'`, `datos_anteriores.sub_estado=<origen>`, `datos_nuevos.sub_estado='2z'`<br>- **Sin email al cliente**: la transición a `2z` no activa ningún código E1–E8 del catálogo; la auditoría de `liberarFecha()` y la de la promoción son registradas por sus propios seams sin duplicarse aquí |
| **Prioridad** | Media |
| **Frecuencia** | Media |
| **US** | US-013 |
| **Endpoint** | `POST /reservas/{id}/descartar` — body `{ motivo?: string }` (operationId `descartarConsultaPorCliente`) |
| **Entidades afectadas** | RESERVA (UPDATE `sub_estado='2z'`, `notas` si hay motivo), FECHA_BLOQUEADA (DELETE vía `liberarFecha()` en orígenes `2b`/`2c`/`2v`), AUDIT_LOG — sin migración nueva (columnas y enums existentes desde US-000/US-004) |

**Tabla de efectos por origen (fuente de verdad del spec-delta):**

| Origen | → sub_estado | ¿Libera fecha? | ¿Promueve cola (A15)? | ¿Reordena cola (decremento)? |
|--------|-------------|----------------|-----------------------|------------------------------|
| `2a`   | `2z`        | No             | No                    | No                           |
| `2b` sin cola | `2z` | Sí (`liberarFecha()`) | No (cola vacía → no-op) | No |
| `2b` con cola | `2z` | Sí (`liberarFecha()`) | Sí, una vez (A15) | No (A15 reordena internamente) |
| `2c`   | `2z`        | Sí (`liberarFecha()`) | No (cola ya vaciada en `2c`) | No |
| `2d`   | `2z`        | No             | No                    | Sí (decremento de `posicion_cola > P`) |
| `2v` sin cola | `2z` | Sí (`liberarFecha()`) | No | No |
| `2v` con cola heredada | `2z` | Sí (`liberarFecha()`) | Sí, una vez (A15) | No |

**Distinción de terminales:**
- `2z` = descartada **por cliente** (esta US, manual, A17)
- `2y` = descartada por cola al activar pre-reserva (US-014, A16)
- `2x` = expirada por barrido de TTL (US-012, A21)

**Flujo Básico (origen 2b con cola):**
1. El gestor abre la ficha de consulta en `sub_estado = '2b'` (o cualquier sub-estado no terminal)
2. El gestor selecciona "Marcar como descartada por cliente" (botón deshabilitado en terminales `2x`/`2y`/`2z`/`reserva_cancelada`/`reserva_completada`)
3. El gestor introduce motivo opcional en el diálogo de confirmación y confirma
4. El sistema valida la guarda de origen: `estado = 'consulta'` y `sub_estado ∈ {2a,2b,2c,2d,2v}` (422 si no cumple)
5. El sistema resuelve la tabla de efectos por origen (declarativa, no `if` dispersos)
6. En una única transacción all-or-nothing serializada por `SELECT … FOR UPDATE` sobre la fila `FECHA_BLOQUEADA`:
   - Marca la RESERVA: `sub_estado = '2z'`; si hay motivo, anexa a `notas`
   - Invoca `liberarFecha()` (eliminación atómica de la fila de `FECHA_BLOQUEADA`)
   - Dispara `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })` exactamente una vez (la cola tiene candidatos)
   - Registra `AUDIT_LOG accion='transicion'`, `datos_anteriores.sub_estado='2b'`, `datos_nuevos.sub_estado='2z'`
7. El sistema responde `200` con la RESERVA en `sub_estado='2z'`; el frontend re-consulta la cola/pipeline para reflejar la promoción

**Flujos Alternativos:**
- **FA-01** (origen `2a` — sin bloqueo ni cola): solo cambia `sub_estado = '2z'`; no se busca ni elimina `FECHA_BLOQUEADA`; sin acciones sobre cola; `200` con RESERVA en `2z`
- **FA-02** (origen `2b`/`2v` sin cola): `liberarFecha()` elimina la fila; la búsqueda de candidatos devuelve 0 y no dispara promoción; `200`
- **FA-03** (origen `2c`): `liberarFecha()` elimina la fila; la cola ya se vació al entrar en `2c`, por lo que la operación de cola es vacía (0 filas, sin error); `200`
- **FA-04** (origen `2d`): la RESERVA sale de la cola (`posicion_cola → NULL`, `consulta_bloqueante_id → NULL`); se decrementan las `posicion_cola` de las que estaban detrás (`posicion_cola > P`); la bloqueante no se toca; no se libera `FECHA_BLOQUEADA`; `200`
- **FA-05** (sin motivo): la transición completa normalmente; `RESERVA.notas` permanece sin cambios; `200`
- **FA-06** (guarda de origen — RESERVA en estado terminal): `sub_estado ∈ {2x,2y,2z}` o estado `reserva_cancelada`/`reserva_completada` → el sistema retorna `409` "Esta consulta ya está en un estado terminal y no puede modificarse"; sin mutaciones
- **FA-07** (doble descarte concurrente — RC-3): la primera transacción marca `2z`; la segunda, al releer bajo lock, encuentra la RESERVA ya en terminal → `409` con mensaje informativo (la UI lo muestra como mensaje de información, no error crítico)
- **FA-08** (descarte vs barrido TTL — RC-1): si el barrido de expiración (US-012) y el descarte compiten sobre la misma RESERVA, la primera transacción en commitear gana; la segunda observa el sub-estado ya terminal y no actúa; el resultado final es `2z` **o** `2x`, nunca ambos
- **FA-09** (liberación vs nuevo bloqueo — RC-2): `UNIQUE(tenant_id, fecha)` garantiza que la nueva solicitud de bloqueo de esa fecha solo puede insertarse **después** de que la eliminación del descarte confirme; nunca coexisten dos bloqueos activos

```mermaid
flowchart TD
    A[Gestor: Marcar como descartada por cliente + motivo opcional] --> B{Guarda de origen: estado=consulta y sub_estado ∈ 2a|2b|2c|2d|2v?}
    B -->|Terminal o estado no consulta| C[409 — Estado terminal inmutable]
    B -->|Válido| D{sub_estado origen?}
    D -->|2a| E[Tx: UPDATE RESERVA sub_estado=2z + notas opc + AUDIT_LOG]
    E --> Z[200 — RESERVA sub_estado=2z]
    D -->|2b ó 2c ó 2v| F[Tx SELECT…FOR UPDATE fila FECHA_BLOQUEADA]
    F --> G[UPDATE RESERVA sub_estado=2z + notas opc]
    G --> H[liberarFecha — DELETE FECHA_BLOQUEADA]
    H --> I{Cola activa 2b/2v?}
    I -->|No o 2c| J[AUDIT_LOG transicion]
    I -->|Sí 2b/2v| K[PromocionColaPort.promoverPrimeroEnCola una vez]
    K --> J
    J --> Z
    D -->|2d| L[Tx SELECT…FOR UPDATE RESERVA + cola]
    L --> M[UPDATE RESERVA: sub_estado=2z, posicion_cola=NULL, consulta_bloqueante_id=NULL]
    M --> N[UPDATE posicion_cola−1 de RESERVA 2d con mismo bloqueante y posicion_cola > P]
    N --> O[AUDIT_LOG transicion]
    O --> Z
```

---

### ÁREA: GESTIÓN DE COLA DE ESPERA

---

#### UC-11: Visualizar Cola de Espera de una Fecha

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-11 |
| **Nombre** | Visualizar Cola de Espera de una Fecha |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor visualiza, en una vista de **solo lectura**, la consulta bloqueante de una fecha y la cola FIFO de consultas en espera (`2.d`) asociadas. La vista no muta estado ni registra AUDIT_LOG. El acceso se produce desde el indicador `🔁 N en cola` del calendario (US-039), que navega con el `reservaId` de la bloqueante. |
| **Precondiciones** | - Gestor autenticado con rol gestor sobre el tenant<br>- `{id}` es el `reservaId` de la consulta bloqueante (puede estar en `2b`, `2c` o `2v`)<br>- El indicador `🔁 N en cola` ya está visible en el calendario cuando existen ≥ 1 RESERVA en `2d` apuntando a la bloqueante (UC-29, US-039) |
| **Postcondiciones** | - Información de cola proyectada sin mutación de estado<br>- Sin registro en AUDIT_LOG (lectura pura) |
| **Prioridad** | Alta |
| **Frecuencia** | Alta |
| **US** | US-017 |
| **Endpoint** | `GET /reservas/{id}/cola` — `{id}` es el `reservaId` de la consulta bloqueante |
| **Entidades leídas** | RESERVA (`posicion_cola`, `consulta_bloqueante_id`, `sub_estado`, `ttl_expiracion`, `fecha_creacion`, `visita_programada_fecha`), FECHA_BLOQUEADA, CLIENTE — sin migración nueva |

**Flujo Básico:**
1. El gestor hace clic sobre el indicador `🔁 N en cola` en una celda del calendario
2. El frontend navega a `/reservas/:id/cola` usando el `reservaId` de la bloqueante que `GET /calendario` ya provee en la respuesta de US-039
3. El sistema ejecuta `GET /reservas/{id}/cola` (UC-11) y devuelve un read-model `ColaEsperaResponse` con dos secciones:
   - **Bloqueante**: `{ idReserva, codigo, clienteNombre, subEstado (2b|2c|2v), ttlExpiracion (date-time|null), ttlRestante (legible|null), visitaProgramadaFecha (date|null, solo 2.v) }`
   - **Cola**: lista de `ColaItem[]` ordenada ASC por `posicionCola` (FIFO), cada elemento `{ idReserva, codigo, clienteNombre, posicionCola, fechaCreacion, tiempoEnCola }`
4. Los derivados temporales `ttlRestante` y `tiempoEnCola` se calculan en el backend sobre instantes `timestamptz` (`ttl_expiracion − now()` y `now() − fecha_creacion`), nunca sobre fechas formateadas, mitigando el off-by-one de zona horaria documentado
5. El gestor puede acceder a la ficha completa de la bloqueante o de cualquier consulta de la cola mediante el `idReserva` de cada elemento (`GET /reservas/{id}`, US-005)

**Flujos Alternativos:**
- **FA-01** (bloqueante sin cola): existe `FECHA_BLOQUEADA` pero ninguna RESERVA en `2d` apunta a la bloqueante → la sección bloqueante se proyecta; la cola está vacía; la vista muestra "Sin consultas en espera para esta fecha"
- **FA-02** (bloqueante en `2.c`): se proyecta `subEstado = '2c'` con el TTL correcto; la cola se muestra con el mismo formato
- **FA-03** (bloqueante en `2.v`): se proyecta `subEstado = '2v'` con `visitaProgramadaFecha` y el TTL vigente; la cola igual
- **FA-04** (reserva no bloqueante de ninguna fecha activa): no hay `FECHA_BLOQUEADA` con `reserva_id = {id}` → el sistema responde 200 con `{ estaBloqueada: false, bloqueante: null, cola: [] }` para que la vista muestre "Fecha disponible"; 404 solo para reserva inexistente o de otro tenant (RLS)
- **FA-05** (cola de un único elemento): la sección cola contiene exactamente una entrada con `posicionCola = 1`

```mermaid
flowchart TD
    A[Gestor clic indicador 🔁 en calendario] --> B[Frontend navega a /reservas/:id/cola]
    B --> C[GET /reservas/{id}/cola — ObtenerColaEsperaUseCase]
    C --> D{¿reserva existe y es del tenant?}
    D -->|No| E[404 — No encontrada / RLS]
    D -->|Sí| F{¿tiene FECHA_BLOQUEADA activa?}
    F -->|No| G[200 — estaBloqueada:false, bloqueante:null, cola:[]]
    F -->|Sí| H[Lee bloqueante + CLIENTE + cola 2d ORDER BY posicion_cola ASC]
    H --> I[Calcula ttlRestante y tiempoEnCola sobre instantes timestamptz]
    I --> J[200 — ColaEsperaResponse: sección bloqueante + cola FIFO]
    J --> K[Gestor visualiza cola; puede navegar a ficha de cualquier RESERVA]
```

---

#### UC-12: Promover Consulta de la Cola

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-12 |
| **Nombre** | Promover Consulta de la Cola |
| **Actor Principal** | Sistema (promoción automática) / Gestor (promoción manual) |
| **Actores Secundarios** | Gestor (notificado internamente en flujo automático; actor principal en flujo manual) |
| **Descripción** | Cubre dos flujos complementarios: **(A) Automático** — cuando se libera una `FECHA_BLOQUEADA` con cola activa, el sistema promueve automáticamente la primera consulta en cola (`2.d → 2.b`, posición 1, FIFO), re-crea el bloqueo, reordena el resto y alerta al gestor; implementado en **US-018**. **(B) Manual** — el Gestor selecciona deliberadamente una consulta arbitraria de la cola (`2.d`, cualquier posición), expira forzosamente la bloqueante activa (`2b/2c/2v → 2x`), promueve la elegida (`2d → 2b`), re-asigna el bloqueo y reordena la cola cerrando el hueco; implementado en **US-019**. Ambos flujos se coordinan mediante `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA` (guarda "ya promovida"): quien adquiere el lock primero completa la operación; el otro aborta limpio (409). |
| **Precondiciones** | - Al menos una RESERVA en `sub_estado = '2d'` con `posicion_cola = 1` para `(tenant_id, fecha)` — se verifica dentro de la transacción bajo lock<br>- La `FECHA_BLOQUEADA` de esa fecha fue liberada por `liberarFecha()` (DELETE commiteado) antes del disparo del seam `PromocionColaPort` |
| **Postcondiciones** | **Flujo automático (US-018):** la consulta con `posicion_cola = 1` pasa a `sub_estado = '2b'`; `posicion_cola = NULL`; `consulta_bloqueante_id = NULL`; se re-crea la fila de `FECHA_BLOQUEADA` (blando, `now() + ttl_consulta_dias`) vía `bloquearFecha()`; el resto de la cola decrementa posición en 1 y re-apunta `consulta_bloqueante_id`; `AUDIT_LOG accion='transicion'` por cada RESERVA, `origen: 'promocion_automatica'`; alerta interna al gestor.<br>**Flujo manual (US-019):** la bloqueante activa (`2b`/`2c`/`2v`) pasa a `2x` (expiración forzosa, `ttl_expiracion → NULL`); la RESERVA elegida por el Gestor (cualquier `posicion_cola`) pasa a `2b`; la fila de `FECHA_BLOQUEADA` se re-asigna a la promovida (blando, `now() + ttl_consulta_dias`); la cola se reordena cerrando el hueco (`posicion_cola > P` decrementan 1; todas re-apuntan `consulta_bloqueante_id` a la promovida); `AUDIT_LOG accion='transicion'` por cada RESERVA modificada, `datos_nuevos.origen: 'promocion_manual'` para la promovida.<br>**Ambos flujos:** sin email al cliente en MVP (superficie de notificaciones diferida a US-044); idempotente (guarda "ya promovida" bajo lock aborta limpio si el estado ya cambió). |
| **Prioridad** | Crítica |
| **Frecuencia** | Media |
| **US** | US-018 (automático), US-019 (manual) |
| **Entidades afectadas** | RESERVA (UPDATE promovida + UPDATE bloqueante expirada en manual + UPDATE restantes), FECHA_BLOQUEADA (INSERT en automático; UPDATE re-asignación en manual), AUDIT_LOG — sin migración nueva (reutiliza `posicion_cola`, `consulta_bloqueante_id`, `ttl_expiracion`, `sub_estado` existentes desde US-000/US-004) |

**Flujo Básico (automático — A15):**
1. El barrido de expiración (UC-09 / US-012) o cualquier otra operación que invoque `liberarFecha()` hace DELETE de la `FECHA_BLOQUEADA` de `(tenant, fecha)` y commite; si detecta cola activa, dispara `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })` exactamente una vez (post-commit)
2. El adaptador real `PromocionColaPrismaAdapter` (US-018) recibe `{ tenantId, fecha }` y abre una transacción bajo `SET LOCAL app.tenant_id` (RLS)
3. Adquiere `SELECT … FOR UPDATE` sobre las RESERVA en `sub_estado = '2d'` de `(tenant, fecha)` — este es el **punto de serialización**; la fila de `FECHA_BLOQUEADA` ya no existe en este momento
4. Guarda "ya promovida": verifica que exista candidato con `posicion_cola = 1` en `2d`; si no (otra TX ya promovió), aborta limpio sin cambios (idempotencia)
5. Función pura de dominio (`resolverPromocionCola`) calcula el plan: mutaciones de la promovida + decrementos de posición + nuevo `consulta_bloqueante_id` del resto; valida contigüidad de posiciones
6. En la misma transacción:
   - Muta la promovida: `sub_estado = '2b'`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL`, `ttl_expiracion = now() + ttl_consulta_dias`
   - Re-crea `FECHA_BLOQUEADA` vía `bloquearFecha()` (blando, `now() + ttl_consulta_dias`)
   - Reordena el resto: decrementa `posicion_cola` (orden ascendente para respetar `reserva_cola_posicion_key`), apunta `consulta_bloqueante_id` a la promovida
7. Registra `AUDIT_LOG` con `accion = 'transicion'` por cada RESERVA modificada (`origen: promocion_automatica`)
8. Registra alerta interna para el gestor: "Consulta [código] promovida a bloqueo de la fecha [fecha]; contactar al cliente" (dentro de la misma transacción, sin acoplamiento al puerto de comunicaciones US-045)
9. El gestor visualiza la alerta en el dashboard (superficie US-044); contacta al cliente manualmente

**Flujos Alternativos — Flujo automático (US-018):**
- **FA-01** (guarda "ya promovida" — carrera RC-1 / RC-3): `posicion_cola = 1` en `2d` ya no existe bajo lock → abortar limpio sin cambios, sin error. Cubre doble disparo del cron (RC-1) y coordinación con la promoción manual del Gestor (RC-3, US-019)
- **FA-02** (cola vacía): no hay RESERVA en `2d` para `(tenant, fecha)` → la función retorna inmediatamente sin mutaciones (éxito silencioso; `liberarFecha()` ya procesó la liberación)
- **FA-03** (contigüidad rota en la cola): la función pura detecta hueco en posiciones → aborta con error de dominio; el lote de expiración registra el fallo de forma aislada (el resto del lote continúa)

**Flujo B: Promoción manual por el Gestor (US-019)**

El Gestor inicia la promoción desde la vista de cola de US-017 (`/reservas/:id/cola`). El endpoint es `POST /reservas/{id}/promover` con body `{ confirmado: true }`, donde `{id}` es la RESERVA en `2d` a promover (no la bloqueante). Rol requerido: Gestor. Códigos de respuesta: 200 (éxito), 403 (rol insuficiente), 404 (reserva no encontrada bajo RLS), 409 (carrera perdida: el automático se adelantó), 422 (consulta ya no en `2d`).

1. El Gestor visualiza la cola de la fecha en la vista de US-017
2. El Gestor selecciona una consulta de la cola (cualquier posición) y hace clic en "Promover a bloqueante"
3. El sistema muestra un **diálogo de confirmación** (acción destructiva e irreversible: expira la bloqueante actual)
4. El Gestor confirma la acción
5. El sistema valida la guarda de origen: la RESERVA elegida está en `sub_estado = '2d'`
6. El sistema valida que existe `FECHA_BLOQUEADA` activa para la `(tenant, fecha)` de la consulta elegida
7. En una **única transacción** serializada por `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`:
   - Adquiere el lock y re-evalúa la guarda "ya promovida" (si el estado ya cambió → aborta, 409)
   - Expira la bloqueante activa: `sub_estado → '2x'`, `ttl_expiracion → NULL`
   - Re-asigna la fila de `FECHA_BLOQUEADA`: `reserva_id → <promovida>`, `tipo_bloqueo = 'blando'`, `ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`
   - Promueve la RESERVA elegida: `sub_estado → '2b'`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`, `ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`
   - Reordena la cola cerrando el hueco: RESERVA con `posicion_cola > P` decrementan 1; todas las restantes actualizan `consulta_bloqueante_id` a la promovida
   - Registra `AUDIT_LOG` (`accion='transicion'`, `origen: 'promocion_manual'`, `usuario_id` del Gestor) para cada RESERVA modificada
8. El sistema responde 200; el frontend invalida la query de cola (TanStack Query)

**Flujos Alternativos — Flujo manual (US-019):**
- **FA-01** (Gestor promueve la primera de la cola — `posicion_cola = 1`): el plan de reordenación es equivalente al decremento uniforme de US-018; el efecto es el mismo pero con expiración forzosa de la bloqueante previa
- **FA-02** (bloqueante con TTL ya vencido pero no barrida): el sistema la detecta con `sub_estado ∈ {2b,2c,2v}` y `ttl_expiracion < now()`, la expira a `2x` e igualmente ejecuta la promoción elegida
- **FA-03** (cola de un único elemento): R1 → `2x`; R2 → `2b`; `FECHA_BLOQUEADA.reserva_id → R2.id`; cola queda vacía
- **FA-04** (Gestor cancela el diálogo de confirmación): no se realiza ningún cambio; la bloqueante sigue activa; la cola permanece inalterada
- **FA-05** (consulta ya no en `2d` al confirmar): la guarda de origen detecta `sub_estado ≠ '2d'` → rechaza con 422 "La consulta seleccionada ya no está en cola"; sin mutaciones
- **FA-06** (carrera manual vs automático — RC-A): el automático toma primero el `FOR UPDATE` sobre `FECHA_BLOQUEADA` (vía `liberarFecha()`), completa su promoción FIFO; el Gestor, al obtener el lock, detecta que el estado ya cambió → aborta con 409 "La cola ya fue actualizada automáticamente, por favor recarga la vista"
- **FA-07** (dos Gestores simultáneos — RC-B): el primer Gestor en adquirir el lock completa la promoción; el segundo, al obtener el lock, detecta la bloqueante ya en `2x` o la consulta elegida ya no en posición válida → aborta con 409

> **Política de arbitraje (US-018 §D-6, respetada):** FIFO estricto + "gana quien toma el lock primero". El sistema NO cede prioridad al Gestor: si el automático gana, el Gestor recibe 409, recarga y decide de nuevo. La garantía reside exclusivamente en PostgreSQL (`UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`), nunca en locks distribuidos.

> **Notificación al cliente (US-044):** el email "¡La fecha está disponible!" (UC-12 paso 8 original) está marcado como `Solo diseñado` en US-018 y US-019. En MVP se registra solo la traza en `AUDIT_LOG`. La superficie de notificaciones/dashboard es de **US-044**.

**Flujo A — Diagrama de secuencia (promoción automática, US-018):**

```mermaid
sequenceDiagram
    participant LF as liberarFecha() (US-041)
    participant S as PromocionColaPrismaAdapter (US-018)
    participant DB as PostgreSQL
    participant C1 as Cola Posición 1 (2.d)
    participant C2 as Cola Posición 2 (2.d)

    LF->>DB: DELETE FECHA_BLOQUEADA (commit)
    LF->>S: PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })
    S->>DB: BEGIN TX + SET LOCAL app.tenant_id
    S->>DB: SELECT … FOR UPDATE — RESERVA sub_estado='2d' de (tenant, fecha)
    S->>S: Guarda "ya promovida": ¿existe posicion_cola=1 en 2d?
    S->>S: resolverPromocionCola — calcula plan FIFO
    S->>C1: UPDATE sub_estado=2b, posicion_cola=NULL, consulta_bloqueante_id=NULL
    S->>DB: INSERT FECHA_BLOQUEADA vía bloquearFecha() (blando, now+ttl)
    S->>C2: UPDATE posicion_cola=1, consulta_bloqueante_id=C1.id
    S->>DB: AUDIT_LOG por cada RESERVA (origen: promocion_automatica)
    S->>DB: Alerta interna al gestor (en misma TX)
    S->>DB: COMMIT
```

**Flujo B — Diagrama de secuencia (promoción manual, US-019):**

```mermaid
sequenceDiagram
    participant G as Gestor (UI cola US-017)
    participant M as PromoverManualEnColaService (US-019)
    participant DB as PostgreSQL
    participant R1 as Bloqueante actual (2b/2c/2v)
    participant Rp as RESERVA elegida (2d, pos P)
    participant Rc as Cola restante (2d)

    G->>M: POST /reservas/{id}/promover { confirmado: true }
    M->>DB: BEGIN TX + SET LOCAL app.tenant_id
    M->>DB: SELECT … FOR UPDATE sobre fila FECHA_BLOQUEADA (tenant, fecha)
    M->>M: Guarda "ya promovida": ¿sigue elegida en 2d? ¿bloqueante coherente?
    alt Estado ya cambió (carrera perdida)
        M->>G: 409 — La cola ya fue actualizada automáticamente
    else Invariantes OK
        M->>R1: UPDATE sub_estado=2x, ttl_expiracion=NULL
        M->>DB: UPDATE FECHA_BLOQUEADA: reserva_id=Rp.id, ttl=now+ttl_consulta_dias
        M->>Rp: UPDATE sub_estado=2b, posicion_cola=NULL, consulta_bloqueante_id=NULL, ttl=now+ttl
        M->>Rc: UPDATE posicion_cola-=1 (pos>P) + consulta_bloqueante_id=Rp.id (todas)
        M->>DB: AUDIT_LOG por cada RESERVA (origen: promocion_manual, usuario_id Gestor)
        M->>DB: COMMIT
        M->>G: 200
    end
```

---

#### UC-13: Salir Voluntariamente de la Cola

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-13 |
| **Nombre** | Salir Voluntariamente de la Cola |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | Un cliente en cola (`sub_estado = '2d'`) comunica al Gestor que no desea seguir esperando. El Gestor ejecuta la salida en nombre del cliente. Este caso de uso es la **rama `2d`** del descarte por cliente (UC-10 / US-013): comparte el mismo endpoint `POST /reservas/{id}/descartar` con `{ motivo?: string }` y la misma transacción all-or-nothing. Efectos específicos de la rama `2d`: `sub_estado → '2z'`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`; decremento de `posicion_cola` del resto de la cola de la misma bloqueante (cierre de hueco); la bloqueante no se toca; no se libera `FECHA_BLOQUEADA`. Ver ficha completa en **UC-10**. |
| **Precondiciones** | - Consulta en `sub_estado = '2d'` (en cola de espera; equivale a la rama `2d` de UC-10) |
| **Postcondiciones** | - Consulta pasa a `sub_estado = '2z'` (terminal)<br>- `posicion_cola = NULL`, `consulta_bloqueante_id = NULL`<br>- Cola reordenada: `posicion_cola − 1` para las que estaban por detrás<br>- `AUDIT_LOG accion='transicion'`, sin email al cliente |
| **Prioridad** | Media |
| **Frecuencia** | Baja |
| **US** | US-013 (rama origen `2d`) |
| **Endpoint** | Ver UC-10 — `POST /reservas/{id}/descartar` |

**Flujo Básico (gestor):**
1. El gestor abre la ficha de consulta en cola (`sub_estado = '2d'`)
2. El gestor selecciona "Marcar como descartada por cliente" (misma acción que UC-10)
3. El gestor opcionalmente indica motivo
4. El sistema ejecuta la rama `2d` de la transición de descarte: `sub_estado → '2z'`, sale de la cola, reordena posiciones del resto
5. El sistema registra en `AUDIT_LOG`

> Para el detalle completo del flujo, flujos alternativos, concurrencia y diagrama, ver **UC-10** (implementado en **US-013**).

---

### ÁREA: PRE-RESERVA Y PRESUPUESTOS

---

#### UC-14: Generar Presupuesto (Activar Pre-reserva)

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-14 |
| **Nombre** | Generar Presupuesto (Activar Pre-reserva) |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El Gestor genera un presupuesto formal cuando el cliente ha confirmado todos los datos necesarios, activando la transición al estado `pre_reserva`. El flujo se divide en dos fases: **preview** (borrador editable, sin persistencia) y **confirmación** (transacción única que coordina PRESUPUESTO + RESERVA + FECHA_BLOQUEADA + cola + AUDIT_LOG). Implementado en **US-014** (change `us-014-generar-presupuesto-activar-prereserva`). Extendido en **6.2** (`documentos-presupuesto-sin-iva-doble-numeracion`): `metodoPago` obligatorio en preview y confirmación; el régimen fiscal determina el cálculo y la variante del PDF. |
| **Precondiciones** | - RESERVA en `estado = 'consulta'`, `sub_estado ∈ {'2a','2b','2c','2v'}` (guarda declarativa `ORIGENES_TRANSICION_ACTIVAR_PRERESERVA`; `2d`, terminales y `pre_reserva`/posteriores se rechazan sin efectos)<br>- **No existe** PRESUPUESTO en `estado = 'enviado'` o `'aceptado'` para esa RESERVA (si existe, remitir a UC-15)<br>- Datos de reserva completos: `fecha_evento` (futura), `duracion_horas ∈ {4,8,12}`, `num_adultos_ninos_mayores4 ≥ 1`, `tipo_evento ∈ {boda,corporativo,privado,otro}`<br>- Datos fiscales del CLIENTE no nulos ni vacíos: `dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia` (si faltan, error enumera campos faltantes vía `camposFaltantes` en el cuerpo del 422, propagado por `HttpExceptionFilter`)<br>- `metodoPago ∈ {transferencia, efectivo}` presente en el request (obligatorio desde 6.2; ausencia → 400)<br>- Gestor autenticado con rol gestor sobre el tenant |
| **Postcondiciones** | - PRESUPUESTO creado con `version = 1`, `tarifa_congelada = true`, `estado = 'enviado'`, desglose fiscal congelado según régimen (`iva_porcentaje = 21` en CON IVA; `iva_porcentaje = 0` en SIN IVA), `metodoPago` y `regimenIva` persistidos<br>- RESERVA pasa a `estado = 'pre_reserva'`, `ttl_expiracion = now() + TENANT_SETTINGS.ttl_prereserva_dias` (7 días por defecto, nunca hardcodeado)<br>- FECHA_BLOQUEADA: si origen `2b`/`2c`/`2v` → UPDATE del `ttl_expiracion`; si origen `2a` → INSERT nueva fila; `tipo_bloqueo = 'blando'` en ambos casos<br>- Cola vaciada: todas las RESERVA con `consulta_bloqueante_id = id` y `sub_estado = '2d'` pasan a `'2y'`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL` (mecánica A16)<br>- `AUDIT_LOG accion='transicion'` para la RESERVA principal y para cada RESERVA descartada de la cola<br>- Post-commit: PDF generado en la variante del régimen (CON IVA o SIN IVA, react-pdf), `PRESUPUESTO.pdf_url` actualizado; E2 disparado vía motor US-045 (fallo del proveedor no revierte la pre-reserva; queda trazado en `COMUNICACION`) |
| **Prioridad** | Crítica |
| **Frecuencia** | Alta |
| **US** | US-014 |
| **Endpoints** | `POST /reservas/{id}/presupuesto/preview` (borrador sin persistencia) · `POST /reservas/{id}/presupuesto` (confirmación) · `PATCH /reservas/{id}/datos-fiscales` (completar datos fiscales del CLIENTE sin abandonar el flujo — incidencia #5, US-014 Parte B; ver FA-08) |
| **Entidades afectadas** | PRESUPUESTO (INSERT — campos nuevos en 6.2: `metodo_pago`, `regimen_iva`; unicidad actualizada a `@@unique([tenantId, regimenIva, numeroPresupuesto])`), RESERVA (UPDATE estado + TTL), FECHA_BLOQUEADA (INSERT o UPDATE ttl_expiracion), COMUNICACION (INSERT E2), AUDIT_LOG. Migración 6.2 aditiva: columnas `metodo_pago` y `regimen_iva` nullable + backfill; nueva unicidad sustituye a la de 6.1b. |

**Flujo Básico — fase preview:**
1. El gestor abre la ficha de consulta en `sub_estado ∈ {2a,2b,2c,2v}` y hace clic en "Generar presupuesto"
2. El gestor elige el método de pago (`transferencia` / `efectivo`) en el selector del formulario (default `transferencia`)
3. El frontend llama a `POST /reservas/{id}/presupuesto/preview` con body `{ metodoPago, extras?, descuento_eur?, precio_manual_eur? }`. `metodoPago` es **obligatorio** desde 6.2; sin él la API responde `400`.
4. El sistema valida la guarda de origen y los datos fiscales del cliente (sin efectos si algo falla)
5. El sistema deriva el régimen (`regimenDesdeMetodoPago`), delega el cálculo al motor de tarifa (UC-16 / US-016) y calcula el desglose fiscal según el régimen. Devuelve el borrador con: base imponible, IVA (21% en CON IVA; 0 en SIN IVA), total según régimen, reparto 40%/60%/fianza, instrucciones de transferencia. **Sin persistencia**.
6. Si `tarifa_a_consultar = true` (>50 invitados): el sistema muestra la tarifa como "A consultar" y habilita un campo de precio total manual; la confirmación no está disponible hasta que el Gestor introduzca el precio
7. El gestor revisa el borrador y puede ajustar extras, descuentos y método de pago (nuevas llamadas a `preview`)

**Flujo Básico — fase confirmación:**
8. El gestor confirma el borrador (`POST /reservas/{id}/presupuesto` con body `{ metodoPago, extras, descuento_eur?, descuento_motivo?, precio_manual_eur? }`)
9. El sistema vuelve a validar la guarda de origen y los datos fiscales
10. El sistema llama al motor de tarifa (o usa `precio_manual_eur` si `tarifa_a_consultar = true`), deriva el `regimenIva` y calcula el desglose fiscal definitivo según el régimen
11. En una **única transacción all-or-nothing** serializada por `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`:
    - INSERT en PRESUPUESTO: `version = 1`, `tarifa_congelada = true`, `estado = 'enviado'`, `metodoPago`, `regimenIva`, desglose fiscal según régimen (`iva_porcentaje = 21` / `0`), `total`, `descuento_eur?`, `descuento_motivo?`, `fecha_envio = now()`
    - UPDATE RESERVA: `estado = 'pre_reserva'`, `sub_estado = NULL`, `ttl_expiracion = now() + ttl_prereserva_dias`
    - UPDATE (o INSERT si `2a`) de FECHA_BLOQUEADA: `ttl_expiracion = now() + ttl_prereserva_dias`, `tipo_bloqueo = 'blando'`
    - UPDATE masivo de RESERVA en `2d` con `consulta_bloqueante_id = id`: `sub_estado = '2y'`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL` (vaciado cola A16; si cola vacía, 0 filas afectadas sin error)
    - INSERT AUDIT_LOG `accion='transicion'` para la RESERVA principal y para cada RESERVA descartada
12. Post-commit (no bloqueante): generación del PDF en la variante del régimen (react-pdf) + UPDATE de `PRESUPUESTO.pdf_url`; disparo de E2 vía motor US-045 con el PDF adjunto por referencia a `pdf_url`. Un fallo en la generación del PDF o en el envío del email no revierte la pre-reserva
13. El sistema responde `201` con: PRESUPUESTO (`id`, `version`, `total`, `pdf_url`, `estado`, `regimenIva`, `numeroPresupuesto`) + nuevo `estado`/`ttlExpiracion` de la RESERVA + `consultasDescartadas` (recuento)

**Flujos Alternativos:**
- **FA-01** (datos fiscales incompletos): el sistema responde `422` con `camposFaltantes: ['dni_nif', ...]` enumerando los campos fiscales que faltan; sin efectos sobre PRESUPUESTO, RESERVA ni FECHA_BLOQUEADA. El `HttpExceptionFilter` propaga `camposFaltantes` en el body del error. La UI resalta/enfoca los campos faltantes y permite completarlos inline mediante `PATCH /reservas/{id}/datos-fiscales` (FA-08) antes de reintentar la generación del presupuesto.
- **FA-02** (`tarifa_a_consultar = true` — más de 50 invitados): el motor devuelve `tarifa_a_consultar = true` con importes a `null`; el sistema muestra "A consultar" y habilita precio manual. Al confirmar, `PRESUPUESTO.total` es el `precio_manual_eur` introducido por el Gestor; `tarifa_id` no se almacena (es `null`). Sin precio manual: `422` bloqueante.
- **FA-03** (gestor cancela en fase borrador): no hay efectos; la RESERVA permanece en su sub-estado anterior; `FECHA_BLOQUEADA` no se modifica; ningún email se envía.
- **FA-04** (guarda de origen — RESERVA en `2.d` o terminal): `422` sin efectos; la cola ni la bloqueante se modifican.
- **FA-05** (PRESUPUESTO ya enviado/aceptado): `409` indicando que debe usarse la edición (UC-15); sin crear nuevo PRESUPUESTO.
- **FA-06** (error de configuración del motor de tarifa — `TARIFA_NO_CONFIGURADA` / `TEMPORADA_NO_CONFIGURADA` / `EXTRA_NO_ENCONTRADO`): `422` con mensaje legible; sin crear PRESUPUESTO, sin mutar RESERVA.
- **FA-07** (carrera de concurrencia — dos confirmaciones sobre la misma RESERVA, o la fecha fue bloqueada por otro tenant): el `SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)` lo serializa; el perdedor recibe `409` `FECHA_YA_BLOQUEADA` sin estado intermedio.
- **FA-08** (completar datos fiscales del CLIENTE inline — US-014 incidencia #5): el Gestor rellena los campos faltantes directamente en el diálogo de presupuesto sin abandonarlo. El frontend llama a `PATCH /reservas/{id}/datos-fiscales` con uno o más de los cinco campos (`dniNif`, `direccion`, `codigoPostal`, `poblacion`, `provincia`); el sistema actualiza **solo** los campos presentes en el body sobre el CLIENTE asociado a la RESERVA (PATCH parcial: los ausentes no se sobrescriben a null), responde `200` con el estado resultante de los cinco campos fiscales del CLIENTE, y el frontend reintenta la generación del presupuesto. Multi-tenant: `tenant_id` del JWT, nunca del body. La RESERVA, su estado, su TTL y `FECHA_BLOQUEADA` no se tocan. Implementado en el módulo `reservas` siguiendo el patrón del endpoint `PATCH /reservas/{id}/iban-devolucion`. Errores posibles: `400` body inválido (campo vacío/tipo incorrecto/propiedad ajena a los 5 fiscales), `401` sin token, `403` sin rol gestor, `404` RESERVA inexistente o de otro tenant.

```mermaid
flowchart TD
    A[Gestor: Generar presupuesto en 2a/2b/2c/2v] --> B{Guarda de origen válida?}
    B -->|2d / terminal / pre_reserva+| C[422 — Transición inválida]
    B -->|Presupuesto enviado/aceptado ya existe| D[409 — Usar edición UC-15]
    B -->|Válido| E{Datos fiscales completos?}
    E -->|Incompletos| F[422 — camposFaltantes enumerados]
    E -->|Completos| G[POST /presupuesto/preview → Motor tarifa UC-16]
    G --> H{tarifa_a_consultar?}
    H -->|Sí >50 inv| I[Mostrar borrador A consultar + campo precio manual]
    H -->|No| J[Mostrar borrador con desglose base/IVA/extras/total]
    I --> K{Precio manual introducido?}
    K -->|No| L[Bloquea confirmación]
    K -->|Sí| M
    J --> M[POST /presupuesto — confirmar]
    M --> N[Tx SELECT…FOR UPDATE fila bloqueante]
    N --> O[INSERT PRESUPUESTO v1 enviado + congelado]
    O --> P[UPDATE RESERVA → pre_reserva + ttl_prereserva_dias]
    P --> Q[INSERT/UPDATE FECHA_BLOQUEADA → ttl = now + ttl_prereserva_dias blando]
    Q --> R[UPDATE RESERVA 2d → 2y cola A16]
    R --> S[AUDIT_LOG transicion RESERVA + descartadas]
    S --> T[201 — PRESUPUESTO + nuevo estado RESERVA]
    T --> U[Post-commit: PDF → pdf_url UPDATE + E2 motor US-045]
```

---

#### UC-15: Editar y Reenviar Presupuesto en Pre-reserva

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-15 |
| **Nombre** | Editar y Reenviar Presupuesto en Pre-reserva |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El Gestor ajusta la oferta económica de un presupuesto ya generado (invitados, extras, descuento) mientras la RESERVA está en `pre_reserva` y envía la versión actualizada al cliente, sin perder el historial de versiones. Implementado en **US-015**. |
| **Precondiciones** | - `RESERVA.estado = 'pre_reserva'`<br>- Último `PRESUPUESTO.estado ∈ {'borrador', 'enviado'}` (no `aceptado` ni `rechazado`)<br>- Gestor autenticado con rol gestor sobre el tenant |
| **Postcondiciones** | **Edición confirmada con envío:** nuevo `PRESUPUESTO` con `version = MAX(version)+1`, `tarifa_congelada = true`, `estado = 'enviado'`, `numero_presupuesto = AAAANNN` (nuevo de la secuencia del régimen); PDF regenerado; `COMUNICACION` con `codigo_email = 'E2'` y `es_reenvio = true`; `AUDIT_LOG accion='actualizar'`; `RESERVA.estado` permanece `pre_reserva`; `FECHA_BLOQUEADA.ttl_expiracion` no se modifica.<br>**Guardar borrador sin enviar:** nuevo `PRESUPUESTO version = MAX+1` con `estado = 'borrador'`, `numero_presupuesto = null`; sin `COMUNICACION` ni email.<br>**Reenvío sin cambios:** NO se crea nueva versión; `COMUNICACION E2 es_reenvio=true`; `AUDIT_LOG`. |
| **Prioridad** | Media |
| **Frecuencia** | Media |
| **US** | US-015 |
| **Endpoints** | `POST /reservas/{id}/presupuesto/edicion/preview` (recálculo sin persistencia) · `POST /reservas/{id}/presupuesto/edicion` (crea versión; `enviar: boolean`) · `POST /reservas/{id}/presupuesto/reenvio` (reenvío sin cambios) |
| **Entidades afectadas** | PRESUPUESTO (INSERT nueva versión; sin cambio de schema), RESERVA_EXTRA (primera persistencia real de líneas, con precio congelado; sin migración de schema — ver §3.11), COMUNICACION (INSERT E2 `es_reenvio=true`), AUDIT_LOG |

**Flujo Básico A — editar y enviar:**
1. El Gestor abre la ficha de pre_reserva en `/reservas/:id` y hace clic en "Editar presupuesto" (botón visible solo en `pre_reserva` con presupuesto no aceptado)
2. El sistema valida la guarda de precondición: `RESERVA.estado = 'pre_reserva'` y `último PRESUPUESTO.estado ∈ {'borrador','enviado'}`; si no se cumple, rechaza sin efectos
3. El Gestor modifica los campos editables: `num_adultos_ninos_mayores4`, `duracion_horas ∈ {4,8,12}`, líneas de `RESERVA_EXTRA` (añadir/quitar/modificar cantidad), `descuento_eur`
4. El Gestor solicita un preview (`POST /reservas/{id}/presupuesto/edicion/preview`): el sistema **no persiste** nada; delega en el motor de tarifa UC-16 si cambian invitados o duración; recalcula el desglose fiscal (`base_imponible`, `iva_importe`, `total`) con las funciones puras del régimen del presupuesto vigente
5. Si el cambio de invitados dispara `tarifa_a_consultar = true` (>50): el sistema devuelve importes a `null` y habilita precio manual; la confirmación no está disponible hasta que el Gestor introduzca el precio
6. El Gestor revisa el borrador y elige **enviar** (`enviar: true`) o **guardar borrador** (`enviar: false`) vía `POST /reservas/{id}/presupuesto/edicion`
7. El sistema ejecuta la confirmación en **una única transacción**: (a) inserta `PRESUPUESTO version = MAX(version)+1`, `tarifa_congelada = true`, `estado = 'enviado'` o `'borrador'` según `enviar`; si `enviado`, asigna `numero_presupuesto = AAAANNN` de la secuencia del régimen (con reintento `P2002` sobre `(tenantId, regimenIva, numeroPresupuesto)`); si `borrador`, `numero_presupuesto = null`; (b) persiste las líneas `RESERVA_EXTRA` con `precio_unitario` congelado al precio actual del catálogo para las líneas **nuevas** (las existentes conservan su precio); (c) registra `AUDIT_LOG accion='actualizar'`
8. Post-commit (solo si `enviar = true`): regenera el PDF de la nueva versión; actualiza `pdf_url`; dispara E2 con `es_reenvio = true` vía motor US-045; registra `COMUNICACION` con `codigo_email = 'E2'`, `es_reenvio = true`, `estado = 'enviado'`
9. El sistema responde `201` con la nueva versión del PRESUPUESTO; `RESERVA.estado` y `FECHA_BLOQUEADA.ttl_expiracion` permanecen inalterados

**Flujo Básico B — reenvío sin cambios:**
1. El Gestor abre la ficha de pre_reserva y hace clic en "Reenviar presupuesto" sin modificar ningún campo
2. El sistema valida la guarda de precondición (igual que flujo A)
3. El Gestor confirma el reenvío vía `POST /reservas/{id}/presupuesto/reenvio`
4. El sistema **NO** crea una nueva versión de PRESUPUESTO; reenvía el PDF de la versión vigente
5. El sistema registra `COMUNICACION` con `codigo_email = 'E2'`, `es_reenvio = true`, `estado = 'enviado'` y `AUDIT_LOG accion='actualizar'`
6. El sistema responde `200`; la versión vigente permanece en su estado; `RESERVA.estado` y `FECHA_BLOQUEADA.ttl_expiracion` no cambian

**Flujos Alternativos:**
- **FA-01** (PRESUPUESTO aceptado): `PRESUPUESTO.estado = 'aceptado'` → el sistema rechaza la operación **409** "El presupuesto está aceptado y no puede modificarse"; sin efectos.
- **FA-02** (RESERVA fuera de `pre_reserva`): `RESERVA.estado ≠ 'pre_reserva'` → **409** sin efectos; el botón de edición no está visible en UI para estos estados.
- **FA-03** (preview sin persistir): `POST /presupuesto/edicion/preview` — el sistema recalcula y devuelve el nuevo desglose sin crear ninguna fila de `PRESUPUESTO` ni de `RESERVA_EXTRA`, sin mutar `RESERVA.estado` ni `FECHA_BLOQUEADA`.
- **FA-04** (>50 invitados sin precio manual): `tarifa_a_consultar = true` sin `precioManualEur` en confirmar → **422**; sin crear versión.
- **FA-05** (`descuento_eur > base_imponible` o < 0): **422** "El descuento no puede superar la base imponible"; sin crear versión.
- **FA-06** (`duracion_horas` inválida): valor fuera de `{4,8,12}` → **422**; sin crear versión.
- **FA-07** (concurrencia — doble edición simultánea): el `UNIQUE(reserva_id, version)` serializa: dos confirmaciones que calculan la misma `version` → una gana; la perdedora recibe `P2002` y reintenta calculando `MAX+1` (mismo patrón que la numeración de US-014). Sin locks distribuidos.
- **FA-08** (fallo de PDF o email post-commit): no revierte la transacción de creación del PRESUPUESTO; `pdf_url` queda `null` hasta el reintento; `COMUNICACION` queda en `estado='fallido'`.

```mermaid
flowchart TD
    A[Gestor: Editar presupuesto en pre_reserva] --> B{Guarda: pre_reserva + presupuesto no aceptado?}
    B -->|No — RESERVA fuera de pre_reserva| C[409 — Estado inválido]
    B -->|No — Presupuesto aceptado| D[409 — Presupuesto no editable]
    B -->|Sí| E{Acción del Gestor}
    E -->|Preview| F[POST /edicion/preview — recalcula sin persistir; motor UC-16 si cambian invitados/duracion]
    F --> G{tarifa_a_consultar?}
    G -->|Sí — >50 inv| H[Habilitar precio manual; esperar input]
    G -->|No| I[Devolver desglose borrador sin efectos]
    E -->|Confirmar edicion| J{enviar?}
    J -->|borrador| K[INSERT PRESUPUESTO version=MAX+1 estado=borrador numero=null + RESERVA_EXTRA congelado + AUDIT_LOG]
    J -->|enviar| L[INSERT PRESUPUESTO version=MAX+1 estado=enviado + numero AAAANNN + RESERVA_EXTRA + AUDIT_LOG]
    L --> M[Post-commit: PDF → pdf_url + E2 es_reenvio=true → COMUNICACION enviado]
    E -->|Reenvio sin cambios| N[POST /reenvio — NO crea versión]
    N --> O[COMUNICACION E2 es_reenvio=true + AUDIT_LOG]
    K --> P[201 — RESERVA.estado=pre_reserva inalterado; ttl_expiracion inalterado]
    M --> P
    O --> Q[200 — RESERVA.estado inalterado]
```

---

#### UC-16: Calcular Tarifa según Configuración

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-16 |
| **Nombre** | Calcular Tarifa según Configuración |
| **Actor Principal** | Sistema |
| **Actores Secundarios** | - |
| **Descripción** | El sistema calcula automáticamente la tarifa aplicable según el tarifario configurado del tenant. Motor de lectura pura, stateless y determinista (US-016). Invocado por UC-14 y UC-15. Endpoint: `POST /api/tarifas/calcular` |
| **Precondiciones** | - `fecha_evento` estrictamente futura: no nula, no pasada y **no el mismo día** (comparación por día natural UTC)<br>- `duracion_horas` ∈ {4, 8, 12}<br>- `num_adultos_ninos_mayores4` ≥ 0 (niños ≤ 4 años no se pasan ni cuentan para el tramo)<br>- Tarifario del tenant configurado (`TARIFA` + `TEMPORADA_CALENDARIO`)<br>- Extras opcionales del catálogo del tenant (cada uno: `extra_id` no nulo y `cantidad` ≥ 1) |
| **Postcondiciones** | - Esquema canónico D-1 devuelto: `{ temporada, tarifa_a_consultar, precio_tarifa_eur, extras_total_eur, total_eur, tarifa_id }`. Los cuatro campos monetarios/id son `null` cuando `tarifa_a_consultar=true` |
| **Prioridad** | Crítica |
| **Frecuencia** | Muy alta |

**Flujo Básico:**
1. El sistema valida los inputs (ver precondiciones); rechaza con error 400 si alguno no cumple.
2. El sistema determina la temporada consultando `TEMPORADA_CALENDARIO` del tenant para el mes de `fecha_evento`:
   - Alta: meses 5, 6, 7, 8, 9 (mayo–septiembre)
   - Media: meses 3, 4, 10, 11 (marzo, abril, octubre, noviembre)
   - Baja: meses 12, 1, 2 (diciembre, enero, febrero)
3. Si `num_adultos_ninos_mayores4 > 50` → el sistema devuelve `tarifa_a_consultar: true` con `temporada` resuelta y los cuatro campos restantes a `null` (200 sin error; fin del flujo). Los niños ≤ 4 años no son input y no modifican este cálculo.
4. El sistema busca la fila `TARIFA` del tenant vigente en `fecha_evento` donde `temporada` coincide, `duracion_horas` coincide y `num_adultos_ninos_mayores4` está en el rango `invitados_min..invitados_max`. Los tramos del tarifario de Masia l'Encís son: **1-20, 21-25, 26-30, 31-40, 41-50**.
5. El sistema suma los extras del catálogo del tenant: por cada `{ extra_id, cantidad }`, calcula `precio_eur × cantidad`; la suma es `extras_total_eur`.
6. El sistema devuelve el esquema D-1: `precio_tarifa_eur` (IVA 21% incluido), `extras_total_eur`, `total_eur = precio_tarifa_eur + extras_total_eur`, `tarifa_id` y `tarifa_a_consultar: false`.

**Flujos Alternativos:**
- **FA-01**: `num_adultos_ninos_mayores4 > 50` → Respuesta 200 con `tarifa_a_consultar: true`, `temporada` presente, importes (`precio_tarifa_eur`, `extras_total_eur`, `total_eur`) y `tarifa_id` a `null`. No es un error; habilita precio manual en el flujo invocante (UC-14/FA-02).
- **FA-02**: No existe `TARIFA` vigente para la combinación válida (≤ 50 invitados) → Error 422 `TARIFA_NO_CONFIGURADA` con detalle `{ temporada, duracion_horas, num_invitados }`.
- **FA-03**: El mes de `fecha_evento` no tiene fila en `TEMPORADA_CALENDARIO` del tenant → Error 422 `TEMPORADA_NO_CONFIGURADA` con detalle `{ mes }`.
- **FA-04**: Un `extra_id` no existe, está inactivo (`activo=false`) o pertenece a otro tenant (RLS) → Error 404 `EXTRA_NO_ENCONTRADO` con detalle `{ extra_id, motivo }`.
- **FA-05**: Cualquier input fuera de rango (ver precondiciones) → Error 400 de validación.

---

### ÁREA: CONFIRMACIÓN DE RESERVA

---

#### UC-17: Confirmar Pago de Señal

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-17 |
| **Nombre** | Confirmar Pago de Señal |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El Gestor sube el justificante del pago de la señal (imagen/PDF) y confirma la reserva. El sistema transiciona la RESERVA de `pre_reserva` a `reserva_confirmada`, promueve el bloqueo blando de la fecha a firme sin TTL (upgrade), congela los importes de señal y liquidación, inicializa los tres sub-procesos paralelos e crea la FICHA_OPERATIVA vacía, todo en una única transacción all-or-nothing. Implementado en **US-021** (change `us-021-confirmar-pago-senal-activar-reserva`). |
| **Precondiciones** | - RESERVA en `estado = 'pre_reserva'` (guarda de origen; cualquier otro estado se rechaza sin efectos)<br>- `RESERVA.importe_total > 0` (presupuesto aceptado previo de US-014)<br>- Gestor autenticado con rol gestor sobre el tenant<br>- Fichero justificante adjunto con `mime_type ∈ {image/jpeg, image/png, application/pdf}` y tamaño ≤ 10 MB |
| **Postcondiciones** | - `RESERVA.estado = 'reserva_confirmada'` y `RESERVA.ttl_expiracion = NULL` (la reserva confirmada no expira por TTL)<br>- Fila de `FECHA_BLOQUEADA` promovida a `tipo_bloqueo = 'firme'`, `ttl_expiracion = NULL` por UPDATE de la fila existente (nunca DELETE + INSERT), conservando `reserva_id`<br>- `RESERVA.importe_senal = round(importe_total × pct_senal / 100, 2)` e `importe_liquidacion = importe_total − importe_senal` (40%/60% en MVP, derivados de `TENANT_SETTINGS.pct_senal`, nunca hardcodeados)<br>- `pre_evento_status = 'pendiente'`, `liquidacion_status = 'pendiente'`, `fianza_status = 'pendiente'`<br>- DOCUMENTO creado con `tipo = 'justificante_pago'`, `reserva_id`, `tenant_id`, `url` y `mime_type`<br>- FICHA_OPERATIVA creada idempotentemente con todos los campos de contenido a NULL y `ficha_cerrada = false` (relación 1:1 con la RESERVA)<br>- `AUDIT_LOG accion='transicion'`, `entidad='RESERVA'`, `datos_anteriores.estado='pre_reserva'`, `datos_nuevos.estado='reserva_confirmada'`, con el usuario del Gestor<br>- Post-commit: se presenta la factura de señal en borrador al Gestor para revisión (disparo de UC-18 / US-022); no se genera condiciones particulares ni se envía E3 en este change (E3 se dispara solo tras aprobación de la factura en US-022 y generación de condiciones en US-023) |
| **Prioridad** | Crítica |
| **Frecuencia** | Alta |
| **US** | US-021 |
| **Endpoint** | `POST /reservas/{id}/confirmar-senal` — `multipart/form-data` con el fichero justificante |
| **Entidades afectadas** | RESERVA (UPDATE estado + ttl_expiracion + importes + sub-procesos), FECHA_BLOQUEADA (UPDATE tipo_bloqueo + ttl_expiracion), DOCUMENTO (INSERT justificante_pago), FICHA_OPERATIVA (INSERT idempotente), AUDIT_LOG — sin migración estructural (todos los campos ya existían en el modelo) |

**Flujo Básico:**
1. El gestor abre la ficha de la RESERVA en `pre_reserva` (acción "Confirmar pago de señal" habilitada solo en este estado)
2. El gestor selecciona "Confirmar pago de señal" y abre el diálogo `ConfirmarSenalDialog`
3. El gestor adjunta el fichero justificante (imagen JPEG/PNG o PDF, ≤ 10 MB); el frontend valida formato y tamaño en cliente (UX preventiva)
4. El gestor hace clic en "Confirmar"; el frontend envía `POST /reservas/{id}/confirmar-senal` como `multipart/form-data`
5. El sistema valida en servidor (autoritativo): RESERVA en `pre_reserva`, `importe_total > 0`, fichero presente y con formato/tamaño válidos
6. En una **única transacción all-or-nothing** (reutiliza `bloquearFecha(fase='reserva_confirmada')` de US-040 con `SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`):
   - Crea DOCUMENTO `tipo = 'justificante_pago'` en la misma transacción (si la transición falla, no queda DOCUMENTO huérfano)
   - UPDATE de RESERVA: `estado = 'reserva_confirmada'`, `ttl_expiracion = NULL`, `importe_senal`, `importe_liquidacion`, `pre_evento_status = 'pendiente'`, `liquidacion_status = 'pendiente'`, `fianza_status = 'pendiente'`
   - UPDATE de `FECHA_BLOQUEADA`: `tipo_bloqueo = 'firme'`, `ttl_expiracion = NULL` (upgrade de la fila existente, sin alterar `reserva_id`; la restricción `chk_firme_sin_ttl` la valida en BD)
   - INSERT idempotente de FICHA_OPERATIVA (si ya existe con ese `reserva_id`, no se duplica y la transición continúa sin error)
   - INSERT en AUDIT_LOG con `accion = 'transicion'`
7. El sistema responde 200 con la RESERVA en `reserva_confirmada`, `importe_senal`/`importe_liquidacion`, sub-procesos en `pendiente` y referencia a la FICHA_OPERATIVA
8. Post-commit: se presenta al Gestor la factura de señal en borrador para revisión (disparo de UC-18 / US-022); el Gestor la aprobará y enviará vía E3 en UC-19 / US-023

**Flujos Alternativos:**
- **FA-01** (guarda de origen — RESERVA no en `pre_reserva`): la RESERVA está en `reserva_confirmada` o posterior, en cualquier sub-estado de `consulta` o en `reserva_cancelada` → el sistema rechaza con **"La reserva no está en estado pre_reserva"** (422) sin crear DOCUMENTO, sin mutar RESERVA ni `FECHA_BLOQUEADA` y sin registrar transición en AUDIT_LOG
- **FA-02** (justificante no adjuntado): el sistema devuelve **"Es obligatorio adjuntar el justificante de pago"** (422); sin efectos
- **FA-03** (formato no permitido o tamaño > 10 MB): el sistema rechaza con mensaje específico (formato no permitido / tamaño excedido) (422); sin efectos
- **FA-04** (`importe_total` = 0 o NULL): el sistema rechaza con "Importe total inválido" (422); sin efectos (no hay presupuesto aceptado válido)
- **FA-05** (doble clic / dos sesiones sobre la MISMA RESERVA — concurrencia): la serialización por `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA` garantiza que exactamente una transacción completa el upgrade a firme; la segunda, al obtener el lock, observa la RESERVA ya en `reserva_confirmada` → devuelve **"La reserva ya ha sido confirmada"** (409) sin crear un segundo DOCUMENTO ni una segunda FICHA_OPERATIVA
- **FA-06** (fecha ya en bloqueo firme de OTRA RESERVA — `P2002`): la transacción falla por `UNIQUE(tenant_id, fecha)` antes de mutar la segunda RESERVA → devuelve **"Fecha no disponible"** (409); nunca doble reserva confirmada
- **FA-07** (rollback parcial): cualquier fallo dentro de la transacción la revierte completa: la RESERVA permanece en `pre_reserva`, el bloqueo sigue blando con su TTL, no se crea DOCUMENTO ni FICHA_OPERATIVA

```mermaid
flowchart TD
    A[Gestor: Confirmar pago de señal con justificante] --> B{RESERVA en pre_reserva?}
    B -->|No — otro estado o terminal| C[422 — La reserva no está en estado pre_reserva]
    B -->|Sí| D{importe_total > 0?}
    D -->|No| E[422 — Importe total inválido]
    D -->|Sí| F{Fichero adjunto y válido?}
    F -->|No fichero| G[422 — Es obligatorio adjuntar el justificante]
    F -->|Formato/tamaño inválido| H[422 — Formato o tamaño no permitido]
    F -->|Válido| I[Tx SELECT…FOR UPDATE sobre FECHA_BLOQUEADA]
    I --> J{¿RESERVA ya confirmada — doble clic?}
    J -->|Sí| K[409 — La reserva ya ha sido confirmada]
    J -->|No| L{¿UNIQUE(tenant_id,fecha) viola P2002?}
    L -->|Sí — otra reserva firme| M[409 — Fecha no disponible]
    L -->|No| N[INSERT DOCUMENTO tipo=justificante_pago]
    N --> O[UPDATE RESERVA: reserva_confirmada + ttl=NULL + importes + sub-procesos]
    O --> P[UPDATE FECHA_BLOQUEADA: firme + ttl=NULL — conserva reserva_id]
    P --> Q[INSERT idempotente FICHA_OPERATIVA vacía]
    Q --> R[INSERT AUDIT_LOG: transicion pre_reserva→reserva_confirmada]
    R --> S[200 — RESERVA reserva_confirmada + importes + sub-procesos]
    S --> T[Post-commit: presenta factura de señal en borrador — disparo UC-18/US-022]
```

---

#### UC-18: Generar Factura de Señal

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-18 |
| **Nombre** | Generar Factura de Señal |
| **Actor Principal** | Sistema |
| **Actores Secundarios** | Gestor |
| **Descripción** | El sistema genera automáticamente la factura de señal (40%) como efecto post-commit de la transición `pre_reserva → reserva_confirmada` (US-021). La factura nace en `borrador`, se numera `F-YYYY-NNNN`, se genera su PDF con datos fiscales del emisor (TENANT) y del receptor (CLIENTE) y se presenta al Gestor para que la apruebe o rechace antes de que E3 pueda dispararse. Implementado en **US-022**. |
| **Precondiciones** | - RESERVA en `estado = 'reserva_confirmada'` (transición US-021 ya commitada)<br>- `RESERVA.importe_senal` congelado y mayor que cero<br>- No existe ya una FACTURA con `tipo = 'senal'` para la misma `reserva_id` (idempotencia) |
| **Postcondiciones** | - FACTURA creada con `tipo = 'senal'`, `estado = 'borrador'`, `total = RESERVA.importe_senal`, desglose fiscal calculado, `numero_factura = F-YYYY-NNNN`<br>- PDF generado post-commit y `pdf_url` almacenada (si datos fiscales completos y servicio disponible)<br>- `AUDIT_LOG` con `accion = 'crear'`, `entidad = 'FACTURA'`<br>- El fallo de la generación NO revierte la confirmación (la RESERVA permanece en `reserva_confirmada`) |
| **Prioridad** | Crítica |
| **Frecuencia** | Alta |
| **US** | US-022 |
| **Endpoints** | `GET /reservas/{id}/factura-senal` (consultar borrador) · `POST /facturas/{id}/aprobar` (borrador → enviada) · `POST /facturas/{id}/rechazar` (registrar rechazo) · `POST /facturas/{id}/regenerar-pdf` (reintento manual del PDF) |
| **Entidades afectadas** | FACTURA (INSERT borrador + UPDATE pdf_url + UPDATE estado al aprobar), AUDIT_LOG — migración de constraints en FACTURA (ver `er-diagram.md §3.12`) |

**Flujo Básico (happy path — datos fiscales completos):**
1. El sistema detecta el disparo post-commit de US-021 (RESERVA acaba de pasar a `reserva_confirmada`)
2. El use-case `GenerarFacturaSenalUseCase` verifica idempotencia: comprueba si ya existe `FACTURA WHERE reserva_id = X AND tipo = 'senal'`; si existe, devuelve la existente y registra el intento en `AUDIT_LOG`; si no, continúa
3. El sistema calcula el desglose fiscal en dominio puro:
   - `total = RESERVA.importe_senal` (congelado en US-021; **no se recalcula** tarifa ni porcentaje)
   - `iva_porcentaje = 21,00` (IVA general MVP)
   - `base_imponible = round(total / 1,21, 2)` (redondeo contable mitad hacia arriba)
   - `iva_importe = total − base_imponible` (por resta, garantiza `base + iva = total` exactamente)
4. El sistema asigna `numero_factura = F-{YYYY}-{NNNN}` donde `NNNN = MAX(NNNN del tenant en el año) + 1` con padding a 4 dígitos; ante colisión `P2002` en `UNIQUE(tenant_id, numero_factura)`, recalcula y reintenta (bucle acotado, nunca locks distribuidos)
5. El sistema persiste la FACTURA en `borrador` con todos los campos calculados + `pdf_url = null` y registra `AUDIT_LOG accion = 'crear'`
6. Post-commit: el sistema genera el PDF con datos del emisor (`TENANT.nombre/nif/iban/direccion`) y del receptor (`CLIENTE.nombre/apellidos/dni_nif/direccion/codigo_postal/poblacion/provincia`), concepto y desglose; almacena `pdf_url` en un UPDATE idempotente
7. El sistema presenta la factura en borrador al Gestor (a través de `GET /reservas/{id}/factura-senal`)
8. El Gestor revisa y pulsa "Aprobar factura"
9. El sistema valida que `pdf_url` no sea nulo y que los datos fiscales sean válidos
10. Al aprobar: `FACTURA.estado = 'enviada'`, `FACTURA.fecha_emision = now()`; `AUDIT_LOG accion = 'actualizar'` con `datos_anteriores.estado = 'borrador'` y `datos_nuevos.estado = 'enviada'`
11. La factura queda lista para que el Gestor ejecute el envío E3 mediante UC-19 / US-023 (`POST /reservas/{id}/facturas/senal/enviar`), que aprueba+envía en una sola operación atómica

**Flujos Alternativos:**
- **FA-01** (idempotencia — factura de señal ya existente): el sistema detecta la FACTURA existente, la devuelve sin duplicar y registra el intento en `AUDIT_LOG`. La RESERVA no se modifica.
- **FA-02** (datos fiscales del cliente incompletos — borrador inválido): `CLIENTE.dni_nif` o cualquier campo de dirección fiscal es nulo. La FACTURA se crea en `borrador` con `pdf_url = null`; el sistema alerta al Gestor "Datos fiscales incompletos"; la aprobación queda bloqueada (409 `"Datos fiscales del cliente incompletos"`) hasta que el Gestor complete los datos y regenere el PDF.
- **FA-03** (fallo transitorio del servicio de PDF): la FACTURA se crea en `borrador` con `pdf_url = null`; el sistema registra "PDF pendiente de regenerar" y reintenta automáticamente; la aprobación queda bloqueada hasta que `pdf_url` esté disponible. El Gestor puede también invocar `POST /facturas/{id}/regenerar-pdf` manualmente.
- **FA-04** (Gestor rechaza el borrador): `POST /facturas/{id}/rechazar` — `FACTURA.estado` permanece en `borrador`, el motivo se registra en `AUDIT_LOG`, E3 queda bloqueado. El Gestor puede corregir la incidencia (p. ej. datos del tenant en configuración) y regenerar el PDF.
- **FA-05** (intento de aprobar un borrador inválido o sin PDF): el sistema responde 409 indicando el motivo del bloqueo; la FACTURA permanece en `borrador`.
- **FA-06** (concurrencia — dos reservas del mismo tenant confirmadas simultáneamente): el constraint `UNIQUE(tenant_id, numero_factura)` hace que una inserción de numeración falle (`P2002`); la aplicación recalcula y reintenta; ambas reservas obtienen `numero_factura` únicos y consecutivos.

```mermaid
flowchart TD
    A[Post-commit US-021: RESERVA en reserva_confirmada] --> B{Ya existe FACTURA tipo=senal para esta reserva?}
    B -->|Sí — idempotencia| C[Devuelve existente + AUDIT_LOG intento]
    B -->|No| D[Calcular desglose fiscal en dominio puro: base=round total/1.21,2; iva=total-base]
    D --> E[Asignar numero_factura F-YYYY-NNNN MAX+1 con reintento ante P2002]
    E --> F[INSERT FACTURA borrador + AUDIT_LOG crear]
    F --> G{Datos fiscales CLIENTE completos?}
    G -->|No| H[pdf_url=null — borrador inválido — alerta al Gestor]
    G -->|Sí| I[Generar PDF post-commit con datos emisor/receptor]
    I --> J{PDF generado?}
    J -->|Error transitorio| K[pdf_url=null — PDF pendiente de regenerar — reintento automático]
    J -->|OK| L[UPDATE FACTURA pdf_url — idempotente]
    L --> M[Gestor revisa borrador vía GET /reservas/id/factura-senal]
    H --> M
    K --> M
    M --> N{Gestor aprueba o rechaza?}
    N -->|Rechaza| O[POST /facturas/id/rechazar — motivo a AUDIT_LOG — E3 bloqueado]
    N -->|Aprueba| P{pdf_url disponible y datos válidos?}
    P -->|No| Q[409 — motivo del bloqueo — FACTURA permanece borrador]
    P -->|Sí| R[estado=enviada + fecha_emision=now — AUDIT_LOG actualizar]
    R --> S[Factura lista — Gestor dispara E3 en UC-19/US-023 vía POST /reservas/id/facturas/senal/enviar]
```

---

#### UC-19: Gestionar Condiciones Particulares

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-19 |
| **Nombre** | Gestionar Condiciones Particulares |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema, Cliente |
| **Descripción** | El gestor gestiona el ciclo de vida del documento de condicions particulars: aprobación y envío manual al cliente (primer flujo, US-023) y registro de la copia firmada (segundo flujo, US-024). El envío se realiza mediante la acción "Enviar factura 40%" (E3), que en una única operación atómica aprueba la factura de señal y la despacha al cliente junto con el PDF de condicions particulars. Las condicions particulars son un **requisito duro** del envío E3: si el tenant no las tiene configuradas el envío es bloqueado (409). El registro de la firma se realiza subiendo la copia firmada mediante `POST /reservas/{id}/condiciones-firmadas`; no transiciona estado. Implementado en **US-023** (changes `documentos-enviar-factura-senal-e3` 6.4b + `condiciones-particulares-e3-us023`) y **US-024** (change `firma-condiciones-particulares-us024`). |
| **Precondiciones** | Primer flujo (US-023): reserva en `reserva_confirmada`; factura de señal (`tipo='senal'`) en `estado='borrador'` con `pdf_url` no nulo; tenant con condicions particulars configuradas; Gestor autenticado con rol gestor. Segundo flujo (US-024): `RESERVA.cond_part_enviadas_fecha` no nulo (E3 enviado); `RESERVA.estado ∈ {reserva_confirmada, evento_en_curso, post_evento}`; Gestor autenticado con rol gestor. |
| **Postcondiciones** | Primer flujo: `FACTURA(senal).estado = 'enviada'`; `RESERVA.cond_part_enviadas_fecha = now()`; `RESERVA.cond_part_firmadas = false`; `COMUNICACION E3` con `estado='enviado'`; `DOCUMENTO(tipo='condiciones_particulares')` creado o reutilizado (idempotente); `AUDIT_LOG`. Segundo flujo: nueva fila `DOCUMENTO(tipo='condiciones_particulares')` firmada; `RESERVA.cond_part_firmadas = true`; `RESERVA.cond_part_firmadas_fecha = now()`; `AUDIT_LOG accion='actualizar'`; `RESERVA.estado` sin cambio. |
| **Prioridad** | Alta |
| **Frecuencia** | Alta |
| **US** | US-023 (primer flujo), US-024 (segundo flujo) |
| **Endpoints** | `POST /reservas/{id}/facturas/senal/enviar` (operationId `enviarFacturaSenal`) — primer envío; `POST /reservas/{id}/facturas/senal/reenviar` (operationId `reenviarE3`) — reenvío manual del gestor; ambos body vacío `{}`; respuesta 200 con `FacturaSenalEnvioResponse` (`factura`, `condPartEnviadasFecha`, `condPartAdjuntada`). `POST /reservas/{id}/condiciones-firmadas` (operationId `registrarCondicionesFirmadas`) — registro de firma; `multipart/form-data`, campo binario `condicionesFirmadas`; `@Roles('gestor')`; respuesta 200 con `RegistrarCondicionesFirmadasResponse` (RESERVA con `condPartFirmadas=true`, `condPartFechaFirma`, DOCUMENTO firmado creado). Ver `docs/api-spec.yml` para la especificación completa de responses y códigos de error. |
| **Entidades afectadas** | Primer flujo: FACTURA (UPDATE estado borrador→enviada, fecha_emision), RESERVA (UPDATE cond_part_enviadas_fecha, cond_part_firmadas), COMUNICACION (INSERT E3 enviado), DOCUMENTO (INSERT o SELECT idempotente tipo=condiciones_particulares), AUDIT_LOG. Segundo flujo: DOCUMENTO (INSERT tipo=condiciones_particulares, copia firmada — no idempotente), RESERVA (UPDATE cond_part_firmadas, cond_part_firmadas_fecha), AUDIT_LOG. Sin migración BD en ambos flujos. |

**Flujo Básico — aprobación y envío de E3 (US-023):**
1. La factura de señal fue generada en borrador por US-022 como efecto post-commit de la confirmación de la reserva (UC-18)
2. El gestor abre la ficha de la reserva en `reserva_confirmada` y pulsa "Enviar factura 40%"
3. El sistema valida: existe FACTURA de tipo `senal` para la reserva (404 si no); la factura está en `borrador` (409 si `rechazada`); no existe COMUNICACION E3 `enviado` previa (409 `E3_YA_ENVIADO` si ya se envió); `pdf_url` no nulo (502 si nulo)
4. El sistema obtiene el PDF de condicions particulars (`GenerarPdfCondicionesPort.generar({tenantId})`); si el tenant no tiene condiciones configuradas (devuelve `null`) → aborta con 409 `CONDICIONES_NO_CONFIGURADAS` y rollback total (E3 no se envía, la factura permanece en `borrador`, `cond_part_enviadas_fecha` sigue nulo). Si lanza excepción transitoria → 502 con rollback.
5. En una única unidad de trabajo atómica (`tx + RLS`): envía E3 por `EnviarEmailPort` directo con la factura de señal y el PDF de condicions particulars adjuntos. Si el proveedor de email falla → `EmisionEnvioFallidoError` (502), **rollback total** (nada se consolida)
6. Tras confirmar E3: transiciona la FACTURA `borrador → enviada`; fija `RESERVA.cond_part_enviadas_fecha = now()` y `RESERVA.cond_part_firmadas = false`; crea o reutiliza `DOCUMENTO(tipo='condiciones_particulares', reservaId, tenantId, url, mimeType='application/pdf')` (idempotente: si ya existe, se reutiliza; AUDIT_LOG `crear` solo en la primera creación); crea COMUNICACION E3 `enviado`; registra AUDIT_LOG
7. El sistema responde 200 con la factura emitida, `condPartEnviadasFecha` y `condPartAdjuntada=true`

**Flujo Básico — reenvío manual de E3 (US-023, GAP 3):**
1. El gestor abre la ficha de una reserva con E3 ya enviado y pulsa "Reenviar E3"
2. El sistema valida: existe FACTURA de señal `enviada` (404 `FACTURA_SENAL_NO_ENCONTRADA` si no); existe COMUNICACION E3 `enviado` con `es_reenvio=false` (409 `E3_NO_ENVIADO_PREVIAMENTE` si no)
3. Reutiliza el PDF de la factura y el `DOCUMENTO(tipo='condiciones_particulares')` ya persistido — NO regenera ni duplica ningún documento
4. En una única unidad de trabajo atómica: envía E3 por `EnviarEmailPort` directo; si falla → rollback
5. Tras confirmar: crea nueva COMUNICACION E3 `es_reenvio=true, estado='enviado'` (esquiva el índice UNIQUE parcial); actualiza `RESERVA.cond_part_enviadas_fecha = now()`; registra AUDIT_LOG. NO transiciona factura ni reserva
6. El sistema responde 200

**Flujo Básico — registro de la firma de condiciones particulares (US-024):**
1. El cliente devuelve el documento firmado (vía email o físicamente)
2. El gestor abre la ficha de la reserva y pulsa "Registrar condiciones firmadas"
3. El sistema valida (guardas de precondición, autoritativas, antes de mutar):
   - `RESERVA.cond_part_enviadas_fecha` no nulo (E3 enviado). Si es nulo → 409 `CONDICIONES_NO_ENVIADAS` "Las condiciones particulares no han sido enviadas al cliente aún"; sin efectos
   - `RESERVA.estado ∈ {reserva_confirmada, evento_en_curso, post_evento}`. Si es terminal (`reserva_completada`, `reserva_cancelada`) o cualquier otro → 422; sin efectos
   - Fichero presente con `mimeType ∈ {image/jpeg, image/png, application/pdf}` y tamaño ≤ 10 MB. Si no → 422; sin efectos
4. El sistema sube el fichero firmado al almacén de documentos con clave `condiciones-firmadas/{tenantId}/{reservaId}/{uuid}.{ext}` (todas las versiones se conservan)
5. En una única transacción atómica all-or-nothing (`tx + RLS`): crea una nueva fila `DOCUMENTO` con `tipo = 'condiciones_particulares'`, `reservaId`, `tenantId`, `url`, `mimeType`, `nombreArchivo`, `tamanoBytes`; actualiza `RESERVA.cond_part_firmadas = true` y `RESERVA.cond_part_firmadas_fecha = now()`; registra `AUDIT_LOG accion = 'actualizar'`, `entidad = 'RESERVA'`, `datos_anteriores.cond_part_firmadas` (valor previo), `datos_nuevos.cond_part_firmadas = true`, `datos_nuevos.cond_part_firmadas_fecha`. Si alguna escritura falla → rollback total, sin efectos en BD
6. El DOCUMENTO original no firmado de US-023 permanece en BD; la copia firmada se añade como fila nueva (no hay unicidad por `(reserva_id, tipo)`)
7. `RESERVA.estado` y los sub-procesos (`pre_evento_status`, `liquidacion_status`, `fianza_status`) no cambian. La firma es una actualización de campos, **no una transición de la máquina de estados** (mismo patrón que la prórroga de TTL de US-006; `AUDIT_LOG accion = 'actualizar'`, nunca `'transicion'`)
8. El sistema responde 200 con la RESERVA (`condPartFirmadas=true`, `condPartFechaFirma`) y el DOCUMENTO firmado creado

**Re-firma (no idempotente por diseño — N2):** si `cond_part_firmadas` ya es `true` (p. ej. subir una versión más legible), la operación no se rechaza. El sistema crea otra fila `DOCUMENTO` de `tipo = 'condiciones_particulares'` (nueva versión), actualiza `cond_part_firmadas_fecha` al nuevo timestamp, mantiene `cond_part_firmadas = true` y conserva todas las versiones anteriores de `DOCUMENTO` y de binarios. `AUDIT_LOG.datos_anteriores.cond_part_firmadas = true` en este caso. Contraste con US-023: el DOCUMENTO no firmado es único por reserva (idempotente); la copia firmada es versionable (una por registro de firma).

**Señal consultable de firma pendiente (FA-01, en alcance):** la API expone `condPartFirmadas` y `condPartFechaFirma` en la respuesta de la reserva. El frontend muestra la alerta informativa no bloqueante "Condiciones particulares pendientes de firma" cuando `condPartFirmadas = false`. Esta alerta no bloquea la reserva ni impide su progreso (incluida la futura transición a `evento_en_curso`). El disparo automático por cron el día del evento es responsabilidad de **UC-23 (Iniciar Evento)** y queda fuera del alcance de US-024; no existe ningún endpoint `/cron/...` en este change.

**Flujos Alternativos (primer flujo — US-023):**
- **FA-02** (idempotencia — E3 ya enviado): COMUNICACION E3 `enviado` previa → 409 `E3_YA_ENVIADO`; ni re-envío ni duplicado de COMUNICACION. Una COMUNICACION E3 en `fallido` sí permite reintento.
- **FA-03** (PDF de señal ausente): `FACTURA.pdf_url = null` → 502 `EMISION_ENVIO_FALLIDO`; el gestor regenera el PDF antes de reintentar.
- **FA-04** (condiciones no configuradas): tenant sin condicions particulars configuradas (`secciones` vacías) → 409 `CONDICIONES_NO_CONFIGURADAS`; E3 **no se envía**; el gestor debe configurar las condiciones del espacio antes de poder despachar E3.
- **FA-05** (factura rechazada): `FACTURA.estado = 'rechazada'` → 409 `FACTURA_SENAL_NO_ENVIABLE`; hay que regenerar/aprobar el borrador antes.

**Flujos Alternativos (segundo flujo — US-024):**
- **FA-01** (condiciones no enviadas): `cond_part_enviadas_fecha` nulo → 409 `CONDICIONES_NO_ENVIADAS`; sin efectos en BD. La acción "Registrar condiciones firmadas" no está disponible hasta que E3 sea enviado.
- **FA-02** (estado terminal): `RESERVA.estado ∈ {reserva_completada, reserva_cancelada}` o cualquier otro fuera del set válido → 422; sin efectos en BD.
- **FA-03** (fichero ausente, formato no permitido o tamaño excedido): fichero `.docx`, fichero > 10 MB, o ningún fichero → 422 con mensaje específico; sin efectos en BD.
- **FA-04** (re-firma permitida): `cond_part_firmadas = true` no bloquea la operación. Ver descripción de re-firma arriba.

---

### ÁREA: SUB-PROCESOS PARALELOS

---

#### UC-20: Gestionar Sub-proceso Pre-evento

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-20 |
| **Nombre** | Gestionar Sub-proceso Pre-evento |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema, Cliente |
| **Descripción** | El gestor cumplimenta progresivamente la ficha operativa del evento durante el periodo previo al evento |
| **Precondiciones** | - Reserva en estado reserva_confirmada (o evento_en_curso / post_evento)<br>- pre_evento_status = pendiente o en_curso (o cerrado para edición post-cierre) |
| **Postcondiciones** | - Ficha operativa actualizada<br>- pre_evento_status transiciona según el flujo (ver tabla en er-diagram.md §5.4)<br>- AUDIT_LOG registra cada operación |
| **Prioridad** | Alta |
| **Frecuencia** | Alta |
| **US** | US-025 |
| **Endpoints** | `GET /reservas/{id}/ficha-operativa`, `PATCH /reservas/{id}/ficha-operativa`, `POST /reservas/{id}/ficha-operativa/cerrar` |

**Flujo Básico (US-025):**
1. El gestor abre la ficha operativa de una reserva confirmada (`GET /reservas/{id}/ficha-operativa`)
2. El gestor cumplimenta campos progresivamente (`PATCH /reservas/{id}/ficha-operativa`), enviando solo el subconjunto de campos a actualizar:
   - Nº invitados confirmado
   - Menú seleccionado
   - Timing detallado
   - Contacto del evento (nombre y teléfono)
   - Notas operativas
   - Briefing del equipo
3. En el **primer guardado con al menos un campo con dato**, el sistema transiciona `pre_evento_status: pendiente → en_curso` en la misma transacción. Guardados totalmente vacíos no modifican el estado.
4. El gestor puede repetir el paso 2 en varias pasadas (guardado parcial progresivo)
5. Cuando la ficha está lista, el gestor activa "Cerrar ficha" (`POST /reservas/{id}/ficha-operativa/cerrar`)
6. El sistema fija `ficha_cerrada = true`, `fecha_cierre = now()` y transiciona `pre_evento_status: en_curso → cerrado`. Si quedan campos vacíos, los devuelve en `avisosCamposVacios` como aviso informativo —el cierre **nunca falla por campos vacíos**
7. Tras el cierre, el gestor puede seguir editando campos vía el mismo `PATCH`: el sistema persiste el cambio y actualiza `fecha_cierre = now()`, pero **no reabre el estado** (`pre_evento_status` permanece `cerrado`)

**Guarda de acceso:** la ficha solo es accesible cuando `RESERVA.estado ∈ {reserva_confirmada, evento_en_curso, post_evento}`. Si la reserva está en un estado anterior (p. ej. `pre_reserva`), el sistema responde `409` con `code=ficha_no_disponible`.

**Precondición para US-031:** `pre_evento_status = cerrado` es una de las tres precondiciones para la transición `reserva_confirmada → evento_en_curso` (US-031). Las otras dos son `liquidacion_status = cobrada` y `fianza_status = cobrada`.

**Flujos Alternativos:**
- **FA-01**: T-1d sin cerrar → Sistema cierra automáticamente con datos disponibles (US-026, fuera del alcance de US-025)

```mermaid
flowchart TD
    A[reserva_confirmada] --> B[pre_evento_status = pendiente]
    B --> C[Gestor cumplimenta ficha - PATCH parcial]
    C --> D{¿Al menos un campo con dato?}
    D -->|Sí, primer guardado| E[pre_evento_status = en_curso]
    D -->|No / ya en en_curso| F[Ficha actualizada, estado sin cambio]
    E --> G[Gestor sigue editando en varias pasadas]
    F --> G
    G --> H[Gestor cierra ficha - POST cerrar]
    H --> I[ficha_cerrada=true, fecha_cierre=now]
    I --> J[pre_evento_status = cerrado]
    J --> K{¿Campos vacíos?}
    K -->|Sí| L[avisosCamposVacios informativo - no error]
    K -->|No| M[Cierre limpio]
    L --> N[Gestor puede editar post-cierre]
    M --> N
    N --> O[PATCH actualiza campo + fecha_cierre, estado sigue cerrado]
    J --> P{T-1d sin cerrar}
    P -->|Sí| Q[US-026: cierre automático Sistema]
```

---

#### UC-21: Gestionar Sub-proceso Liquidación

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-21 |
| **Nombre** | Gestionar Sub-proceso Liquidación |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor gestiona el cobro del 60% restante (liquidación) antes del evento |
| **Precondiciones** | - Reserva en estado reserva_confirmada<br>- liquidacion_status = pendiente o facturada |
| **Postcondiciones** | - liquidacion_status actualizado<br>- Factura de liquidación generada/enviada/cobrada |
| **Prioridad** | Crítica |
| **Frecuencia** | Alta |

**Flujo Básico:**
1. El sistema genera automáticamente la factura de liquidación en borrador (`tipo='liquidacion'`, `estado='borrador'`, `numero_factura=NULL`, `total = importe_liquidacion + Σ extras pendientes`) como efecto post-commit de la activación de sub-procesos de US-021, a través del use-case `GenerarBorradoresLiquidacionFianzaUseCase` (US-027). El fallo de este paso **no revierte** la confirmación ya realizada; la operación es idempotente por `(reserva_id, tipo)`.
2. El sistema alerta al gestor en la UI: "Documentos de liquidación y fianza pendientes de revisión" (US-027). Esta alerta es una señal de UI, no un email (E4 se dispara en US-028 tras la aprobación).
3. El gestor revisa y ajusta si es necesario. Puede aplicar un descuento negociado mientras la factura está en `borrador` (D-2 US-028: el `total` y el desglose fiscal se recalculan en dominio puro; `RESERVA.importe_liquidacion` se actualiza con el nuevo importe; el descuento y su motivo quedan en `AUDIT_LOG`).
4. El gestor aprueba y envía la factura mediante **`AprobarYEnviarLiquidacionUseCase`** (US-028 / `POST /reservas/{id}/facturas/liquidacion/aprobar-enviar`): en una única operación atómica (D-1 US-028 — excepción síncrona al patrón post-commit), el use-case asigna `numero_factura = F-YYYY-NNNN`, pasa ambas facturas (`liquidacion` y `fianza` si no fue enviada por separado) a `estado='enviada'`, fija `fecha_emision = now()`, envía email E4 al cliente con los PDFs adjuntos y, **solo si E4 se confirma**, commitea los cambios de estado; si E4 falla → rollback total.
5. El sistema actualiza `liquidacion_status = 'facturada'` y `fianza_status = 'recibo_enviado'` (atómicos con el commit del paso 4).
6. El sistema registra `COMUNICACION E4` con `estado='enviado'` y `es_reenvio = false`.
7. El cliente realiza la transferencia bancaria del 60% restante.
8. El gestor recibe el justificante de la transferencia.
9. El gestor registra el cobro en el sistema (`POST /reservas/{id}/facturas/liquidacion/cobro`, US-029): proporciona `importe`, `fecha_cobro` (≤ hoy) y, opcionalmente, `justificante_doc_id` (referencia a un `DOCUMENTO(tipo=justificante_pago)` ya subido). El justificante es **opcional**; el cobro es válido sin él.
10. El sistema, en una **única transacción atómica** (US-029 `RegistrarCobroLiquidacionUseCase`): relee `RESERVA.liquidacion_status` con `SELECT ... FOR UPDATE` (guarda de doble cobro y precondición); crea el registro `PAGO` (`tenant_id`, `factura_id`, `importe`, `fecha_cobro`, `justificante_doc_id`); transiciona `FACTURA(liquidacion).estado: enviada → cobrada`; transiciona `RESERVA.liquidacion_status: facturada → cobrada`. `RESERVA.estado` permanece `reserva_confirmada`. Si el importe cobrado difiere del total de la factura, la respuesta incluye `alertaDiscrepancia { importeFacturado, importeCobrado, diferencia }` (alerta informativa, no bloquea).
11. El sistema registra en `AUDIT_LOG`: `accion = 'crear'` para el `PAGO` (y para el `DOCUMENTO` del justificante si se adjuntó), `accion = 'actualizar'` para la transición de `FACTURA` y de `RESERVA`. Si hubo discrepancia, también queda registrada en `AUDIT_LOG`.

**Resultado:** `liquidacion_status = 'cobrada'` habilita una de las tres precondiciones de la transición `reserva_confirmada → evento_en_curso` (US-031). Las otras dos son `pre_evento_status = cerrado` y `fianza_status = cobrada`.

**Flujos Alternativos:**
- **FA-01**: T-1d sin cobro → Política "Negociable" activada, alerta crítica al gestor
- **FA-02** (fallo de email E4 — D-1 US-028): el proveedor de email rechaza el envío → rollback completo: `numero_factura` no asignado, ambas facturas permanecen en `borrador`, `liquidacion_status`/`fianza_status` sin cambio; error `502/503` recuperable devuelto al Gestor. El Gestor puede reintentar la aprobación.
- **FA-03** (reenvío de la factura ya emitida — D-4 US-028): `POST /reservas/{id}/facturas/liquidacion/reenviar` cuando `FACTURA.estado = 'enviada'`; reenvia el PDF ya emitido sin reasignar `numero_factura` ni mutar estado; crea nuevo registro `COMUNICACION E4` con `es_reenvio = true`. Si `estado != 'enviada'` → `409`.
- **FA-04** (descuento negociado — D-2 US-028): body opcional `{ descuento, extrasCorregidos, motivo }` en `aprobar-enviar`; el use-case recalcula `total`, desglose fiscal y `RESERVA.importe_liquidacion`; el descuento queda en `AUDIT_LOG`.
- **FA-05** (PDF no disponible): si `pdf_url` es nulo para alguna factura → `422`; el Gestor debe regenerar el PDF antes de aprobar.
- **FA-06** (cobro ya registrado — US-029): `RESERVA.liquidacion_status = 'cobrada'` → `409 LIQUIDACION_YA_COBRADA` "La liquidación ya está marcada como cobrada"; no se crea ningún `PAGO` adicional. Dos peticiones concurrentes se serializan por el lock de fila (`SELECT ... FOR UPDATE` sobre RESERVA); la segunda ve `cobrada` y aborta.
- **FA-07** (precondición no cumplida — US-029): `RESERVA.liquidacion_status = 'pendiente'` (la factura de liquidación aún no fue enviada) → `409 LIQUIDACION_NO_FACTURADA` "La factura de liquidación debe estar enviada antes de registrar su cobro"; no se crea `PAGO`.
- **FA-08** (discrepancia de importe — US-029): `importe` ≠ `FACTURA(liquidacion).total` → el sistema crea el `PAGO` con el importe real y avanza a `cobrada`; la respuesta incluye `alertaDiscrepancia`. La conciliación se delega al Gestor; el MVP no ajusta la factura ni genera nota de crédito.

---

#### UC-22: Gestionar Sub-proceso Fianza

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-22 |
| **Nombre** | Gestionar Sub-proceso Fianza |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor gestiona el cobro de la fianza (depósito reembolsable) antes o el día del evento. El ciclo completo abarca la generación del recibo (US-027), su emisión al cliente (US-028) y el registro del cobro (US-030). |
| **Precondiciones** | - Reserva en estado `reserva_confirmada`<br>- `fianza_status ∈ {pendiente, recibo_enviado}` |
| **Postcondiciones** | - `fianza_status = 'cobrada'`<br>- `FACTURA(fianza).estado = 'cobrada'`<br>- `RESERVA.fianza_eur` y `RESERVA.fianza_cobrada_fecha` registrados<br>- `PAGO` creado conciliado contra el recibo de fianza<br>- Habilitada la **tercera precondición** de la transición a `evento_en_curso` (US-031) |
| **Prioridad** | Alta |
| **Frecuencia** | Alta |
| **US** | US-027 (pasos 1-2), US-028 (pasos 3-4), US-030 (pasos 5-9) |
| **Endpoint cobro** | `POST /reservas/{id}/facturas/fianza/cobro` — operationId `registrarCobroFianza` |

**Flujo Básico:**
1. El sistema genera automáticamente el recibo de fianza en borrador (`tipo='fianza'`, `estado='borrador'`, `numero_factura=NULL`, `total = TENANT_SETTINGS.fianza_default_eur`) como efecto post-commit de la activación de sub-procesos de US-021, a través del use-case `GenerarBorradoresLiquidacionFianzaUseCase` (US-027). **Edge case**: si `fianza_default_eur = 0`, el recibo **no se genera**; `fianza_status` permanece `pendiente` y la alerta al Gestor menciona solo la liquidación. La generación de la fianza es independiente de la de la liquidación. El fallo de este paso **no revierte** la confirmación; la operación es idempotente por `(reserva_id, tipo)`.
2. El sistema alerta al gestor en la UI: "Documentos de liquidación y fianza pendientes de revisión" (US-027). Esta alerta es una señal de UI, no un email (E4 se dispara en US-028 tras la aprobación).
3. El gestor puede enviar el recibo de fianza al cliente **de forma independiente** mediante **`EnviarReciboFianzaUseCase`** (US-028 / `POST /reservas/{id}/facturas/fianza/enviar`, D-3 US-028): asigna `numero_factura = F-YYYY-NNNN` al recibo de fianza, pasa a `estado='enviada'` y actualiza `fianza_status = 'recibo_enviado'`. El email enviado se registra en `COMUNICACION` con `codigo_email = 'manual'` (no E4); `liquidacion_status` **no cambia**. Alternativamente, si la liquidación y la fianza se aprueban juntas vía `aprobar-enviar` (UC-21 paso 4), la fianza también se emite y `fianza_status` pasa a `recibo_enviado` en el mismo commit.
4. El sistema actualiza `fianza_status = 'recibo_enviado'`.
5. El cliente realiza el pago externo por transferencia bancaria o efectivo (Slotify registra el cobro, **no** procesa el pago; sin integración de pasarela en MVP).
6. El gestor recibe el justificante del pago (opcional; el cobro es válido sin justificante).
7. El gestor accede a la ficha de la reserva y abre el formulario de registro de cobro de fianza (`RegistrarCobroFianzaDialog`). Introduce `importe` (`> 0`), `fecha_cobro` (`≤ RESERVA.fecha_evento`; el cobro en T-0 es válido) y, opcionalmente, el `justificante_doc_id` referenciando un `DOCUMENTO(tipo='justificante_pago')` ya subido.
8. El sistema ejecuta `RegistrarCobroFianzaUseCase` en una **única unidad transaccional atómica** (con `SELECT ... FOR UPDATE` sobre la fila de RESERVA para serializar el doble cobro concurrente; nunca locks distribuidos): crea el `PAGO` con `factura_id` del recibo de fianza, `importe`, `fecha_cobro` y `justificante_doc_id` (nullable); si se adjuntó justificante, referencia el `DOCUMENTO(tipo='justificante_pago')`; transiciona `FACTURA(fianza).estado = 'cobrada'`; establece `RESERVA.fianza_eur = importe` y `RESERVA.fianza_cobrada_fecha = fecha_cobro`; y registra `AUDIT_LOG` con `accion='crear'` (PAGO y, si aplica, DOCUMENTO) y `accion='actualizar'` (transición de FACTURA y RESERVA, incluidos `fianza_eur`/`fianza_cobrada_fecha`).
9. El sistema transiciona `RESERVA.fianza_status = 'cobrada'` (dentro de la misma transacción del paso 8). `RESERVA.estado` **permanece** `reserva_confirmada`; este paso habilita la **tercera de las tres precondiciones** de la transición a `evento_en_curso` (las otras dos son `pre_evento_status = cerrado` y `liquidacion_status = cobrada`; la transición es responsabilidad de US-031).
10. La UI actualiza la ficha de la reserva mostrando `fianza_status = 'cobrada'`, `fianza_eur` y `fianza_cobrada_fecha`; oculta el botón de registro de cobro.

**Flujos Alternativos:**
- **FA-01** (T-0 sin cobro — alerta no bloqueante): si en el día del evento `fianza_status ≠ 'cobrada'`, la política hardcoded "Negociable" genera una alerta crítica **no bloqueante** ("⚠️ Fianza pendiente de cobro. Puede registrarla ahora o proceder sin ella (política Negociable)"). El inicio del evento **no se bloquea** por fianza impagada; el Gestor decide manualmente. La integración de esta alerta en el flujo de transición a `evento_en_curso` es responsabilidad de US-031.
- **FA-02** (`fianza_default_eur = 0`): el recibo de fianza no se genera en US-027; `fianza_status` permanece `pendiente`. El Gestor puede aún registrar el cobro vía la política "Negociable" (FA-04 a continuación).
- **FA-03** (fianza ya enviada por separado antes de la aprobación de la liquidación): cuando la liquidación se aprueba vía `aprobar-enviar` (UC-21), si la fianza ya está en `estado='enviada'` / `fianza_status='recibo_enviado'`, el use-case incluye solo la factura de liquidación en E4 sin volver a cambiar `fianza_status` (D-3 US-028: E4 no sobreescribe `recibo_enviado` ya establecido).
- **FA-04** (política "Negociable" — `fianza_status = 'pendiente'` sin recibo enviado): si el Gestor intenta registrar el cobro con `fianza_status = 'pendiente'` sin el flag `confirmarSinRecibo`, el sistema devuelve 200 `confirmacion_requerida` ("El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar el cobro igualmente?") sin crear PAGO ni cambiar estados; el frontend muestra el diálogo de confirmación. Si el Gestor **confirma** (reintento con `confirmarSinRecibo: true`), el cobro se registra igualmente: (a) si la FACTURA(fianza) existe en `borrador`, salta directamente `borrador → cobrada` (sin pasar por `enviada`), documentando el salto en AUDIT_LOG; (b) si no existe FACTURA(fianza), se crea al vuelo y se marca `cobrada`. Si el Gestor **cancela**, no se realiza ninguna acción. Este comportamiento **diverge** del bloqueo duro de la liquidación (US-029).
- **FA-05** (doble cobro — `fianza_status = 'cobrada'`): intento de registrar un cobro sobre fianza ya cobrada → el sistema responde 409 `FIANZA_YA_COBRADA` ("La fianza ya está marcada como cobrada"); no se crea ningún `PAGO` adicional. Dos peticiones concurrentes se serializan por el `SELECT ... FOR UPDATE`: solo la primera registra el cobro; la segunda ve `cobrada` y aborta.
- **FA-06** (validación de entrada — `importe ≤ 0` o `fecha_cobro > fecha_evento`): el sistema responde 400 `COBRO_INVALIDO` sin crear PAGO ni cambiar estados.
- **FA-07** (reserva, factura de fianza o justificante inexistente): el sistema responde 404 con código `FACTURA_FIANZA_NO_ENCONTRADA` o `JUSTIFICANTE_NO_ENCONTRADO` según corresponda.
- **FA-08** (sin auth / rol insuficiente): 401/403.

---

### ÁREA: EJECUCIÓN DEL EVENTO

---

#### UC-23: Iniciar Evento

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-23 |
| **Nombre** | Iniciar Evento |
| **Actor Principal** | Sistema |
| **Actores Secundarios** | Gestor (via US-032, fuera de alcance MVP), Equipo (briefing 📐, fuera de alcance MVP) |
| **Descripción** | El Sistema transiciona automáticamente la reserva al estado `evento_en_curso` a las 00:00 del día del evento (T-0), cuando se cumplen las tres precondiciones. Implementado en US-031 (barrido `POST /cron/barrido-eventos`). |
| **Precondiciones** | - Reserva en estado `reserva_confirmada`<br>- `pre_evento_status = cerrado` (producido por US-025/US-026)<br>- `liquidacion_status = cobrada` (producido por US-029)<br>- `fianza_status = cobrada` (producido por US-030)<br>- `date(fecha_evento) = date(hoy)` (es el día del evento, T-0) |
| **Postcondiciones** | - `RESERVA.estado = evento_en_curso`<br>- `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado: reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso}`, origen Sistema (`usuario_id` nulo)<br>- El estado `evento_en_curso` habilita la captura de documentación del evento (US-033 / UC-24) y la acción de finalización del evento del gestor (US-034 / UC-25) |
| **Prioridad** | Alta |
| **Frecuencia** | Media |
| **US** | US-031 (flujo básico automático); US-032 (forzado manual — pendiente); US-033 (captura de documentación — pendiente); US-034 (finalización del evento — implementada) |
| **Endpoint** | `POST /cron/barrido-eventos` — auth `X-Cron-Token` (`CronTokenGuard`); invocado por cron `@nestjs/schedule` diario a las 00:00 (`CRON_BARRIDO_EVENTOS`) |

**Flujo Básico (US-031 — implementado):**
1. El cron `BarridoEventosScheduler` invoca `POST /cron/barrido-eventos` con `X-Cron-Token` válido a las 00:00
2. El sistema selecciona todas las RESERVA con `estado = 'reserva_confirmada'` AND `date(fecha_evento) = CURRENT_DATE` de todos los tenants (lectura cross-tenant del proceso de Sistema)
3. Por cada candidata, en su propia transacción con `SELECT … FOR UPDATE`, re-evalúa la guarda de origen (`reserva_confirmada → evento_en_curso`) y las tres precondiciones dentro del lock
4. Las tres precondiciones se cumplen: el sistema fija `RESERVA.estado = evento_en_curso` y registra la transición en `AUDIT_LOG` con origen Sistema (paso 3); si `cond_part_firmadas = false`, emite además la alerta no bloqueante A29 sin impedir la transición
5. El sistema devuelve el resumen `{ candidatas, eventosIniciados, precondicionesIncumplidas, fallos }`
6. 📐 **Fuera de alcance MVP**: el sistema envía el briefing operativo al equipo (US-044 + diseño de plantilla pendiente)
7. La captura de documentación del evento (US-033) y la acción de finalización del evento (US-034 / UC-25, implementada) se activan al detectar `RESERVA.estado = evento_en_curso` desde `GET /reservas` (US-049)

**Flujos Alternativos:**
- **FA-01 (precondiciones incumplidas — US-031):** si alguna de las tres precondiciones no se cumple en T-0 → el sistema no transiciona la RESERVA (permanece en `reserva_confirmada`) y genera una alerta crítica al gestor con la lista de precondiciones incumplidas. El forzado manual de la transición ante precondiciones incumplidas corresponde a **US-032** (pendiente de implementación).
- **FA-02 (A29 — condiciones particulares no firmadas — US-031):** `cond_part_firmadas = false` en T-0 → el sistema emite la alerta no bloqueante A29 ("Las condiciones particulares de esta reserva no están firmadas. El cliente puede firmarlas presencialmente.") con independencia del resultado de la transición; la RESERVA transiciona igualmente a `evento_en_curso` si las tres precondiciones se cumplen.
- **FA-03 (idempotencia):** una RESERVA ya en `evento_en_curso` (pase previo o gestor US-032) no es candidata; el barrido la omite sin duplicar auditorías.
- **FA-04 (sin token / token inválido):** `POST /cron/barrido-eventos` sin `X-Cron-Token` o con valor incorrecto → `401`; ninguna RESERVA se transiciona.

```mermaid
flowchart TD
    A[Cron T-0 00:00] --> B[POST /cron/barrido-eventos]
    B --> C{X-Cron-Token válido?}
    C -->|No| Z[401 — sin transiciones]
    C -->|Sí| D[Seleccionar candidatas: estado=reserva_confirmada AND fecha_evento=hoy]
    D --> E{¿Hay candidatas?}
    E -->|No| F[Resumen vacío — 200]
    E -->|Sí| G[Por cada candidata: SELECT FOR UPDATE]
    G --> H{¿3 precondiciones cumplidas?}
    H -->|Sí| I[estado = evento_en_curso + AUDIT_LOG Sistema]
    H -->|No| J[Alerta crítica al gestor — RESERVA sin cambio]
    I --> K{cond_part_firmadas = false?}
    K -->|Sí| L[Alerta A29 no bloqueante]
    K -->|No| M[Continuar]
    L --> M
    J --> M
    M --> N[Resumen: candidatas / eventosIniciados / precondicionesIncumplidas / fallos]
```

**Nota de alcance (US-031):**
- **Implementado:** barrido automático a T-0, transición atómica `reserva_confirmada → evento_en_curso`, auditoría de Sistema, alerta crítica por precondiciones incumplidas, alerta A29 no bloqueante, idempotencia, concurrencia cron↔gestor por `SELECT … FOR UPDATE`.
- **Fuera de alcance (📐):** briefing operativo al equipo (UC-23 paso 6, diseñado pero no implementado en MVP); A9 (briefing en T-3d, lista negra).
- **US coordinadas:** US-032 (forzado manual ante precondiciones incumplidas); US-033 (captura de documentación del evento en `evento_en_curso`); US-034 (finalización del evento, implementada — transición `evento_en_curso → post_evento`, UC-25).

---

#### UC-24: Capturar Documentación del Evento

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-24 |
| **Nombre** | Capturar Documentación del Evento |
| **Actor Principal** | Gestor / Equipo |
| **Actores Secundarios** | Sistema |
| **Descripción** | El personal captura la documentación obligatoria durante el evento: foto DNI y cláusula de responsabilidad firmada |
| **Precondiciones** | - Reserva en estado evento_en_curso |
| **Postcondiciones** | - Documentación registrada<br>- URLs almacenadas<br>- Checklist actualizado |
| **Prioridad** | Alta |
| **Frecuencia** | Media |

**Flujo Básico:**
1. El gestor/equipo accede a la vista móvil del evento
2. El gestor/equipo ve el checklist de documentación:
   - [ ] Foto DNI cliente (anverso)
   - [ ] Foto DNI cliente (reverso)
   - [ ] Cláusula de responsabilidad firmada
3. Para cada documento, el gestor/equipo:
   a. Hace clic en el ítem
   b. Captura/sube la imagen/documento
   c. El sistema registra la URL
   d. El checklist marca el ítem como completado
4. El sistema registra en audit log

**Flujos Alternativos:**
- **FA-01**: Documentación incompleta al finalizar → No bloquea, pero queda marcado

---

#### UC-25: Finalizar Evento

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-25 |
| **Nombre** | Finalizar Evento |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor marca el evento como finalizado, transicionando la reserva a `post_evento` e iniciando el sub-proceso post-evento. Si hay fianza cobrada (`fianza_eur > 0`), el sistema envía automáticamente el email E5 (agradecimiento + solicitud de IBAN + enlace NPS). Implementado en **US-034** (change `2026-07-09-us-034-finalizar-evento`). |
| **Precondiciones** | - Reserva en `estado = evento_en_curso` (precondición provista automáticamente por US-031 en T-0 o manualmente por US-032 cuando esté implementada)<br>- Gestor autenticado con rol gestor sobre el tenant (autenticación JWT de usuario, nunca `X-Cron-Token`) |
| **Postcondiciones** | - `RESERVA.estado = post_evento` (transición **irreversible**, incondicional respecto a fianza y email)<br>- Si `fianza_eur > 0`: `COMUNICACION` creada con `codigo_email = E5`, `estado = enviado` (o `fallido` si el proveedor falla); email E5 enviado al `CLIENTE.email`<br>- Si `fianza_eur = 0` o `IS NULL`: no se envía E5 ni se crea `COMUNICACION` para E5<br>- NPS marcada como programada (T+3d), independientemente de la fianza (el envío real es 📐 fuera de MVP)<br>- `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado: evento_en_curso}`, `datos_nuevos = {estado: post_evento}`, **origen Usuario** (gestor autenticado, `usuario_id` poblado — a diferencia del barrido de Sistema de UC-23/US-031) |
| **Prioridad** | Alta |
| **Frecuencia** | Media |
| **US** | US-034 (flujo básico); US-032 (forzado manual — pendiente) |
| **Endpoint** | `POST /reservas/{id}/finalizar-evento` — body vacío o `{}` |
| **Entidades afectadas** | RESERVA (UPDATE `estado`), COMUNICACION (INSERT si `fianza_eur > 0`), AUDIT_LOG — sin migración de esquema (todos los campos y enums ya existían) |

**Flujo Básico (US-034 — implementado):**
1. El gestor accede a la ficha de la reserva en `evento_en_curso`
2. El gestor selecciona "Marcar evento como finalizado" (acción visible solo en `evento_en_curso`; la UI la oculta en cualquier otro estado)
3. El sistema consulta el checklist de documentación del evento (superficie de US-033); si hay ítems pendientes, muestra advertencia informativa: "Documentación pendiente: [lista]. Puedes continuar igualmente." (no bloqueante; fail-open si el checklist no está disponible → `[]`)
4. El gestor confirma la acción
5. El sistema re-evalúa la guarda de origen (`estado = evento_en_curso`) dentro de una transacción con `SELECT … FOR UPDATE` sobre la fila RESERVA; si el estado ya no es `evento_en_curso` (doble finalización concurrente), la segunda request termina como conflicto de estado sin efectos
6. **Paso transaccional (crítico):** el sistema fija `RESERVA.estado = post_evento` y registra la transición en `AUDIT_LOG` (origen Usuario); la NPS queda marcada como programada (T+3d, marca derivada)
7. **Paso post-commit (best-effort):** si `fianza_eur > 0`, el motor de email de `comunicaciones` (US-045) dispara el trigger E5 al `CLIENTE.email`; crea `COMUNICACION` con `codigo_email = 'E5'`, `estado = enviado` (o `fallido` si el proveedor falla); si `fianza_eur = 0` o `IS NULL`, no se envía E5 ni se crea `COMUNICACION`
8. Si E5 falla: la transición a `post_evento` se mantiene; `COMUNICACION.estado = fallido`; el gestor ve la alerta "La reserva ha pasado a post-evento, pero el email E5 no pudo enviarse. Puedes reenviarlo desde la ficha."
9. El sistema responde 200 con `FinalizarEventoResponse = allOf(Reserva)` (objeto Reserva completo, ya en `estado = post_evento`, rehidratado post-commit vía el read-model de `GET /reservas/{id}`) + `e5: { resultado: enviado|fallido|no_aplica, comunicacionId }` + `documentacionPendiente: string[]`

**Flujos Alternativos:**
- **FA-01 (documentación incompleta):** checklist de documentación del evento con ítems pendientes → el sistema muestra advertencia informativa (no bloqueante) antes de la confirmación; si el gestor confirma, la transición se ejecuta igualmente; el checklist sigue accesible para subidas tardías en `post_evento`
- **FA-02 (sin fianza — `fianza_eur = 0` o `NULL`):** la RESERVA transiciona a `post_evento`; no se envía E5 ni se crea `COMUNICACION` para E5; la NPS queda marcada como programada igualmente
- **FA-03 (dato anómalo de fianza — `fianza_status = cobrada` con `fianza_eur IS NULL`):** el sistema trata la condición como "sin fianza" (`fianza_eur IS NULL` ≡ 0); no se envía E5; la inconsistencia se registra en `AUDIT_LOG` como alerta de dato anómalo; la transición procede igualmente
- **FA-04 (fallo de E5):** si el proveedor de email falla post-commit, la transición a `post_evento` no se revierte; `COMUNICACION.estado = fallido`; el gestor puede reintentar el envío desde la ficha
- **FA-05 (estado incorrecto — guarda de origen):** RESERVA en cualquier estado distinto de `evento_en_curso` → el sistema responde 409 (`transicion_no_permitida`); la RESERVA no se modifica, E5 no se dispara, `AUDIT_LOG` no registra transición
- **FA-06 (doble finalización concurrente):** dos peticiones simultáneas sobre la misma RESERVA → exactamente una transición gana; la segunda observa el lock (`estado ≠ evento_en_curso`, 0 filas afectadas) y termina como conflicto de estado; `AUDIT_LOG` recibe exactamente una entrada de transición; E5 se dispara a lo sumo una vez

```mermaid
flowchart TD
    A[Gestor: Marcar evento como finalizado en evento_en_curso] --> B{Guarda de origen: RESERVA en evento_en_curso?}
    B -->|No| C[409 transicion_no_permitida — sin efectos]
    B -->|Sí| D[Consultar checklist documentación — fail-open]
    D --> E{Ítems pendientes?}
    E -->|Sí| F[Advertencia informativa — no bloqueante]
    E -->|No| G[Gestor confirma]
    F --> G
    G --> H[Tx SELECT…FOR UPDATE sobre fila RESERVA]
    H --> I{estado sigue siendo evento_en_curso?}
    I -->|No — carrera perdida| C
    I -->|Sí| J[UPDATE RESERVA: estado=post_evento + NPS programada]
    J --> K[INSERT AUDIT_LOG: transicion + origen Usuario]
    K --> L{fianza_eur > 0?}
    L -->|No 0 o NULL| M[e5: no_aplica — sin COMUNICACION E5]
    L -->|NULL con fianza_status=cobrada| N[Sin E5 + alerta dato anómalo en AUDIT_LOG]
    L -->|Sí| O[Motor US-045: disparar E5 al CLIENTE.email]
    O --> P{Envío exitoso?}
    P -->|Sí| Q[COMUNICACION E5 estado=enviado]
    P -->|No| R[COMUNICACION E5 estado=fallido + alerta al gestor]
    M --> S[200 estado=post_evento + e5 + documentacionPendiente]
    N --> S
    Q --> S
    R --> S
```

**Nota de alcance (US-034):**
- **Implementado:** transición manual `evento_en_curso → post_evento` (irreversible), E5 condicional a `fianza_eur > 0`, separación transición↔envío (fallo de E5 no revierte el estado), NPS marcada como programada (sin envío), advertencia no bloqueante de documentación incompleta, dato anómalo de fianza (`NULL` con `fianza_status=cobrada`), concurrencia doble finalización por `SELECT … FOR UPDATE`, auditoría con origen Usuario.
- **Fuera de alcance (📐):** envío real de la NPS a T+3d (recordatorios automáticos extendidos); A23 (T+3d recordatorio IBAN); A24 (T+7d segundo recordatorio IBAN); factura complementaria post-evento; construcción del checklist de documentación (→ US-033); reenvío de E5 desde la ficha (→ US futura); UI del dashboard de notificaciones (→ US-044).
- **US coordinadas:** US-031 (precondición de estado `evento_en_curso`); US-032 (forzado manual del inicio — pendiente); US-033 (checklist de documentación, consultado por US-034); US-045 (motor de email `comunicaciones`, reutilizado para E5).

---

### ÁREA: POST-EVENTO

---

#### UC-26: Solicitar IBAN para Devolución de Fianza

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-26 |
| **Nombre** | Solicitar IBAN para Devolución de Fianza |
| **Actor Principal** | Sistema |
| **Actores Secundarios** | Cliente, Gestor |
| **Descripción** | El sistema solicita automáticamente al cliente su IBAN al entrar en `post_evento` con fianza cobrada (E5, US-034). El gestor registra el IBAN recibido del cliente en Slotify y el sistema confirma la recepción al cliente con E8 (US-035). |
| **Precondiciones** | - Reserva en estado `post_evento`<br>- `fianza_eur > 0` |
| **Postcondiciones** | - Email E5 enviado al cliente (US-034)<br>- `CLIENTE.iban_devolucion` persistido con validación mod-97 (US-035)<br>- Email E8 enviado al cliente confirmando recepción del IBAN (US-035) |
| **Prioridad** | Alta |
| **Frecuencia** | Media |
| **US** | US-034 (E5 al entrar en `post_evento`); US-035 (registro IBAN + E8) |

**Flujo Básico:**
1. Al entrar en `post_evento`, el sistema detecta `fianza_eur > 0`
2. El sistema envía email E5 (agradecimiento + solicitud de IBAN) al cliente vía el motor de `comunicaciones` (US-034)
3. El cliente responde al gestor con su IBAN (por email u otra vía directa; en MVP no hay formulario web autónomo)
4. El gestor introduce el IBAN recibido en la ficha de la reserva (campo IBAN, visible solo si `fianza_eur > 0`)
5. El frontend llama a `PATCH /reservas/{id}/iban-devolucion` con body `{ iban }` (JWT de usuario; D-5A)
6. El backend valida el IBAN por **checksum módulo 97** (función pura de dominio, antes de toda escritura); si es inválido devuelve `422` sin efectos
7. El backend valida la precondición dual (`estado = post_evento` AND `fianza_eur > 0`); si no se cumple devuelve `409` (`estado_no_post_evento` o `sin_fianza`) sin efectos
8. **Paso transaccional:** `UPDATE CLIENTE.iban_devolucion` + `INSERT AUDIT_LOG` (`accion='actualizar'`, `entidad='CLIENTE'`, `datos_anteriores={iban_devolucion:<previo o null>}`, `datos_nuevos={iban_devolucion:<nuevo>}`). Commit.
9. **Paso post-commit (best-effort):** el motor de `comunicaciones` (US-045) despacha el email **E8** (confirmación de recepción del IBAN + próximos pasos para la devolución) al `CLIENTE.email`; crea `COMUNICACION` con `codigo_email='E8'`, `estado='enviado'` (o `'fallido'` si el proveedor falla); el fallo de E8 **no revierte** el IBAN ya guardado
10. El sistema responde `200` con `{ iban, avisoEmail }` (D-5A): `avisoEmail` indica si E8 se envió o falló

**Flujos Alternativos:**
- **FA-01 (IBAN inválido):** checksum mod-97 falla → `422`; `CLIENTE.iban_devolucion` no se actualiza; E8 no se envía. Mensaje: "El IBAN introducido no tiene un formato válido. Verifica los dígitos de control y la longitud."
- **FA-02 (corrección del IBAN):** el gestor registra un IBAN corregido → `CLIENTE.iban_devolucion` se sobreescribe; se crea una **nueva** `COMUNICACION` E8 (excepción explícita y auditada a la idempotencia D-3A, coherente con el precedente del reenvío de E4 en US-028)
- **FA-03 (fallo de E8):** IBAN guardado, `COMUNICACION.estado='fallido'`; el gestor ve alerta "IBAN guardado, pero E8 no pudo enviarse. Puedes reenviarlo desde la ficha."
- **FA-04 (sin fianza):** `fianza_eur = 0` o `IS NULL` → `409 sin_fianza`; la UI oculta/deshabilita el campo IBAN
- **📐 Fuera de MVP:** recordatorios automáticos A23 (T+3d) y A24 (T+7d) si el cliente no aporta IBAN; formulario web autónomo del cliente para aportar IBAN; validación bancaria en tiempo real

---

#### UC-27: Procesar Devolución de Fianza

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-27 |
| **Nombre** | Procesar Devolución de Fianza |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor registra el IBAN del cliente en Slotify (pasos 1–3, implementado en **US-035**) y posteriormente procesa la devolución efectiva de la fianza (pasos 4–8, implementado en **US-036**). |
| **Precondiciones** | - Reserva en estado `post_evento`<br>- `fianza_eur > 0`<br>- `CLIENTE.iban_devolucion` registrado (para los pasos de devolución) |
| **Postcondiciones** | - `CLIENTE.iban_devolucion` persistido con validación mod-97 + E8 confirmado al cliente (US-035)<br>- `RESERVA.fianza_status = 'devuelta'` (devolución completa) o `'retenida_parcial'` (parcial o retención total) (US-036)<br>- `RESERVA.fianza_devuelta_fecha` registrada (US-036)<br>- `RESERVA.fianza_devuelta_eur` registrado (US-036)<br>- `RESERVA.motivo_retencion` registrado cuando `fianza_devuelta_eur < fianza_eur` o = 0 (US-036)<br>- AUDIT_LOG registrado (US-036)<br>- Justificante de transferencia almacenado como DOCUMENTO (opcional, US-036) |
| **Prioridad** | Alta |
| **Frecuencia** | Media |
| **US** | US-035 (pasos 1–3: registro IBAN + E8); US-036 (pasos 4–8: devolución completa o parcial) |

**Flujo Básico (devolución completa):**
1. El cliente proporciona IBAN al gestor (email u otra vía directa)
2. El gestor introduce el IBAN en la ficha de la reserva en Slotify
3. El sistema valida el IBAN (mod-97), lo persiste en `CLIENTE.iban_devolucion` y envía E8 al cliente confirmando recepción (`PATCH /reservas/{id}/iban-devolucion`, body `{ iban }`, respuesta `200 { iban, avisoEmail }`) — **implementado en US-035**
4. El gestor realiza la transferencia externamente
5. El gestor accede a la ficha de reserva
6. El gestor selecciona "Registrar devolución de fianza"
7. El gestor introduce:
   - Importe devuelto = fianza_eur
   - Justificante de transferencia
8. El sistema registra `fianza_devuelta_fecha`, `fianza_devuelta_eur`, fija `fianza_status = 'devuelta'` y registra en `AUDIT_LOG` — **implementado en US-036** (`POST /reservas/{id}/fianza/devolucion`)

**Flujos Alternativos:**
- **FA-01**: Devolución parcial por desperfectos → Gestor indica `fianza_devuelta_eur` menor que `fianza_eur` y `motivo_retencion` (obligatorio); `fianza_status → 'retenida_parcial'`. Retención total (`fianza_devuelta_eur = 0`) también usa `retenida_parcial` con `motivo_retencion` obligatorio. (US-036)
- **FA-02**: IBAN erróneo → Gestor corrige el IBAN en la ficha; el sistema sobreescribe `CLIENTE.iban_devolucion` y reenvía E8 como nueva `COMUNICACION` (excepción auditada D-3A, US-035 FA-02)

---

#### UC-28: Archivar Reserva

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-28 |
| **Nombre** | Archivar Reserva |
| **Actor Principal** | Sistema (flujo básico automático, US-037) / Gestor (flujo alternativo manual, US-038) |
| **Actores Secundarios** | - |
| **Descripción** | La reserva pasa al histórico consultable, quedando en estado terminal `reserva_completada` (inmutable). Hay dos mecanismos: el automático por barrido periódico en T+7d (US-037) y el manual por acción del gestor (US-038). |
| **Precondiciones** | - Reserva en `estado = post_evento`<br>- Guarda de fianza resuelta: `fianza_status ∈ {devuelta, retenida_parcial}` O `fianza_eur <= 0` O `fianza_eur IS NULL`<br>- (Solo flujo automático) `date(fecha_post_evento) <= date(hoy) - 7` |
| **Postcondiciones** | - `RESERVA.estado = reserva_completada` (terminal, sin arista de salida)<br>- Flujo automático: `AUDIT_LOG` con `accion='transicion'`, `datos_nuevos={estado:reserva_completada, causa:'T+7d'}`, `usuario_id` nulo (Sistema)<br>- Flujo manual: `AUDIT_LOG` con `accion='transicion'`, `datos_nuevos={estado:reserva_completada}`, `usuario_id` del gestor (origen Gestor, NO Sistema)<br>- Reserva visible y filtrable en el módulo Histórico (UC-32); excluida del pipeline activo (`GET /reservas`)<br>- No se envía ningún email al cliente ni al gestor (ninguno de los dos flujos) |
| **Prioridad** | Media |
| **Frecuencia** | Media |
| **US (flujo automático)** | US-037 |
| **US (flujo manual)** | US-038 |
| **Endpoint (flujo automático)** | `POST /cron/barrido-completadas` (`X-Cron-Token`, `CronTokenGuard`) — respuesta `200 BarridoCompletadasResponse { candidatas, archivadas, fianzaPendiente, fallos }` |
| **Endpoint (flujo manual)** | `POST /reservas/{id}/archivar` (JWT de usuario, `@Roles('gestor')`) — `operationId: archivarReservaManual`; body vacío opcional; respuesta `200 Reserva` en `reserva_completada`; `409 transicion_no_permitida` (origen ≠ `post_evento` o carrera perdida); `422 fianza_no_resuelta` (fianza pendiente); `404` (inexistente/otro tenant); `401/403` |

**Flujo Básico (automático T+7d — US-037):**
1. El cron diario (`@nestjs/schedule`) invoca `POST /cron/barrido-completadas` con `X-Cron-Token`.
2. El sistema selecciona candidatas cross-tenant: `estado = 'post_evento'` AND `date(fecha_post_evento) <= date(hoy) - 7`.
3. Por cada candidata, en una transacción atómica bajo RLS del tenant (`SELECT … FOR UPDATE`): re-evalúa la guarda de origen y la guarda de fianza resuelta bajo el lock.
4. Si la guarda de fianza se satisface: transiciona `RESERVA.estado → reserva_completada` y registra en `AUDIT_LOG` (origen Sistema, `usuario_id` nulo, `causa='T+7d'`).
5. El sistema devuelve el resumen del barrido (`candidatas`, `archivadas`, `fianzaPendiente`, `fallos`).

**Flujo Alternativo A (fianza pendiente en T+7d — FA-01):**
1. La guarda de fianza no se satisface (`fianza_status = cobrada` con `fianza_eur > 0`, sin devolución registrada).
2. El sistema no transiciona la RESERVA (permanece en `post_evento`).
3. El sistema registra una alerta en `AUDIT_LOG` (`datos_nuevos.tipo='fianza_pendiente_t7d'`, `usuario_id` nulo), con anti-duplicación: no se duplica la alerta mientras el estado de fianza no cambie (Opción 4.2 del gate).
4. La candidata se contabiliza como `fianzaPendiente` en el resumen del barrido.

**Flujo Alternativo B — archivado manual por el gestor (US-038):**
1. El gestor abre la ficha de la reserva en `post_evento`. El botón "Archivar reserva" es visible solo en ese estado; se deshabilita con mensaje explicativo cuando la fianza no está resuelta (`fianza_status ∈ {cobrada, recibo_enviado, pendiente}` con `fianza_eur > 0`).
2. El gestor hace clic en "Archivar reserva" y confirma en el diálogo de confirmación (patrón `FinalizarEventoDialog` de US-034). No se aplica ningún filtro de antigüedad T+7d: el gestor puede archivar en cualquier momento tras entrar en `post_evento`.
3. El frontend llama a `POST /reservas/{id}/archivar` con el JWT del gestor (rol gestor). El `tenant_id` y el `usuario_id` se derivan siempre del JWT, nunca del path ni del body.
4. En una transacción atómica bajo el contexto RLS del tenant del JWT, con `SELECT … FOR UPDATE` sobre la fila RESERVA, el sistema re-evalúa bajo el lock dos guardas reutilizadas de US-037 (no se crean guardas nuevas):
   - **Guarda de origen** (`resolverArchivadoAutomatico`): si `estado ≠ post_evento` (incluido ya `reserva_completada`) → **409** `code: 'transicion_no_permitida'`, sin transicionar ni auditar. Cubre la idempotencia (doble clic del gestor) y la race condition con el cron de US-037.
   - **Guarda de fianza** (`fianzaResuelta`, idéntica a US-037): resuelta si `fianza_status ∈ {devuelta, retenida_parcial}` O `fianza_eur ≤ 0` O `fianza_eur IS NULL`. Si el origen es `post_evento` válido pero la fianza no está resuelta → **422** `code: 'fianza_no_resuelta'` con el mensaje "No se puede archivar la reserva: la fianza está pendiente de resolución. Registra la devolución o retención de fianza antes de archivar."; la RESERVA permanece en `post_evento` sin auditoría. El backend valida siempre (defensa en profundidad), aunque la UI deshabilite el botón preventivamente.
5. Si ambas guardas se satisfacen: fija `RESERVA.estado = reserva_completada` y registra en `AUDIT_LOG` con `accion='transicion'`, `entidad='RESERVA'`, `datos_anteriores={estado: post_evento}`, `datos_nuevos={estado: reserva_completada}`, `usuario_id=<id del gestor del JWT>` (origen Gestor, `usuario_id` no nulo — a diferencia del barrido de US-037, que audita `usuario_id` nulo y `causa='T+7d'`). No se emite ningún email.
6. El frontend muestra el toast de éxito: "Reserva [código] archivada correctamente. Ya está disponible en el Histórico." La reserva sale del pipeline activo.

**Flujo Alternativo C — fianza no resuelta en archivado manual (FA-01/FA-02 — US-038):**
1. El gestor intenta archivar una reserva en `post_evento` cuya fianza no está resuelta (`fianza_status ∈ {cobrada, recibo_enviado, pendiente}` con `fianza_eur > 0`).
2. El sistema bloquea la acción y devuelve **422** `code: 'fianza_no_resuelta'` con el mensaje específico de FA-01/FA-02. La RESERVA permanece en `post_evento`; no se registra ninguna entrada de transición en `AUDIT_LOG`.

**Concurrencia cron (US-037) vs. archivado manual (US-038):**
Si el barrido de Sistema y el gestor intentan transicionar simultáneamente la misma RESERVA de `post_evento` a `reserva_completada`, exactamente una operación gana; la segunda observa bajo el `SELECT … FOR UPDATE` que el estado ya no es `post_evento` — no-op para el cron, **409** `transicion_no_permitida` para el gestor — sin doble transición ni doble `AUDIT_LOG`. La serialización la da PostgreSQL sobre la fila RESERVA, sin locks distribuidos (prohibidos por `no-distributed-lock`).

**Notas de alcance:**
- La "indexación" de la reserva en Histórico es **visibilidad y filtrabilidad** por estado terminal, no un índice full-text técnico (decisión D-5 de US-037: índice full-text/TSVECTOR fuera de alcance).
- La construcción del módulo Histórico (UC-32) y su UI de consulta/filtrado son responsabilidad de otra US.
- Sin email al cliente ni al gestor en ninguno de los dos flujos.
- US-038 no añade aristas nuevas a la máquina de estados; reutiliza la guarda `resolverArchivadoAutomatico` (`MAPA_ARCHIVADO_AUTOMATICO`: `post_evento → reserva_completada`, terminal) y la guarda `fianzaResuelta`, ambas introducidas por US-037.

---

### ÁREA: CALENDARIO Y DISPONIBILIDAD

---

#### UC-29: Consultar Calendario

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-29 |
| **Nombre** | Consultar Calendario (Visualizar el Calendario de Disponibilidad) |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor visualiza el calendario mensual con el estado de disponibilidad de cada fecha mediante un código de colores canónico, incluyendo indicador de cola cuando hay leads en espera. **Vista de lectura pura**: no muta estado. El calendario es la página de inicio del sistema tras el login (sidebar → primera opción). |
| **Precondiciones** | - El gestor está autenticado |
| **Postcondiciones** | - Calendario mostrado con código de colores canónico (SlotifyGeneralSpecs §11.3); sin mutación de `RESERVA` ni `FECHA_BLOQUEADA` |
| **Prioridad** | Crítica |
| **Frecuencia** | Muy alta |
| **US** | US-039 |
| **Endpoint** | `GET /calendario` — query `desde` (date), `hasta` (date), `vista` (`mes`\|`semana`\|`dia`\|`lista`); respuesta 200 `CalendarioResponse` (`rango` + `fechas[]` agregadas por fecha ocupada del tenant); 401 sin sesión; 422 rango inválido |
| **Entidades afectadas** | RESERVA (lectura), FECHA_BLOQUEADA (lectura), TENANT (aislamiento RLS) — sin migración (no hay cambios de esquema) |

**Código de colores canónico (SlotifyGeneralSpecs §11.3):**

| Estado / sub_estado de la reserva bloqueante | Color |
|----------------------------------------------|-------|
| Consulta activa: `2a`, `2b`, `2c`, `2v` | Gris |
| `pre_reserva` | Ámbar |
| `reserva_confirmada`, `evento_en_curso`, `post_evento` | Verde |
| `reserva_completada` | Azul |
| `reserva_cancelada` | Rojo |
| Fecha libre (sin bloqueo activo) | Sin color (celda neutra — ausente en la respuesta) |

Sub-estados terminales (`2x`/`2y`/`2z`) no aparecen: su bloqueo ya fue liberado. `evento_en_curso` y `post_evento` heredan el verde de `reserva_confirmada`; la diferenciación de detalle solo se ve en la ficha de reserva.

**Flujo Básico:**
1. El gestor accede a la sección Calendario (o inicia sesión → redirección automática al Calendario como página de inicio)
2. El frontend calcula el rango del período activo según la vista seleccionada y llama a `GET /calendario?desde=...&hasta=...&vista=mes`
3. El sistema agrega, por cada fecha con `FECHA_BLOQUEADA` activa del tenant, el color derivado del par `(estado, sub_estado)` de la reserva bloqueante y el conteo de cola (`enCola`)
4. El sistema filtra obligatoriamente por `tenant_id` del JWT + RLS; ningún dato de otro tenant es alcanzable
5. El sistema responde con `CalendarioResponse`: `rango` + `fechas[]` (solo fechas ocupadas; las fechas libres no aparecen en la respuesta)
6. El frontend renderiza el calendario (react-big-calendar) con el código de colores: cada fecha con bloqueo activo muestra su celda coloreada; si `enCola ≥ 1`, superpone el indicador `🔁 N en cola` sobre la celda
7. El gestor puede cambiar la vista (mes/semana/día/lista) y navegar entre períodos; el código de colores es idéntico en todas las vistas (el rango recalculado origina una nueva llamada a `GET /calendario`)
8. El gestor puede hacer clic en una fecha con bloqueo activo → el frontend muestra un popover con los campos ya presentes en la respuesta (cliente, sub_estado, TTL restante, enlace a la ficha completa) sin segunda llamada a la API
9. El gestor puede hacer clic en el indicador `🔁` de una fecha → el frontend navega a la vista de cola de esa fecha (UC-11 / US-017), fuera del alcance de esta US

**Flujos Alternativos:**
- **FA-01 (mes sin reservas / fechas libres):** el sistema responde 200 con `fechas: []`; el calendario sigue siendo navegable e interactivo sin errores.
- **FA-02 (mes pasado — histórico):** el sistema devuelve `reserva_completada` (azul) y `reserva_cancelada` (rojo) si tienen fila en `RESERVA`; las consultas terminales (`2x`/`2y`/`2z`) no aparecen (bloqueo ya liberado).
- **FA-03 (sin sesión):** el sistema responde 401; el frontend redirige al login.
- **FA-04 (rango inválido):** `desde > hasta` o fechas malformadas → el sistema responde 422.
- **FA-05 (aislamiento multi-tenant):** la query filtra siempre por `tenant_id` del JWT; con un JWT de otro tenant no aparecen datos del primero.

```mermaid
flowchart TD
    A[Gestor accede al Calendario] --> B[Frontend calcula rango según vista]
    B --> C[GET /calendario?desde=..hasta=..vista=..]
    C --> D{Autenticado con JWT válido?}
    D -->|No| E[401 → redirige a login]
    D -->|Sí| F{Rango válido?}
    F -->|No| G[422 — rango inválido]
    F -->|Sí| H[Query RLS: FECHA_BLOQUEADA + RESERVA por tenant_id]
    H --> I[Agrega por fecha: color + estado + subEstado + enCola + cliente + ttlRestante]
    I --> J[200 CalendarioResponse: rango + fechas-ocupadas]
    J --> K[Frontend renderiza celdas coloreadas]
    K --> L{enCola >= 1?}
    L -->|Sí| M[Superpone indicador 🔁 N en cola]
    L -->|No| N[Celda sin indicador de cola]
    M --> O{Clic en celda?}
    N --> O
    O -->|Clic en celda con bloqueo| P[Popover: cliente + subEstado + TTL + enlace ficha]
    O -->|Clic en indicador 🔁| Q[Navega a vista de cola UC-11/US-017]
```

---

#### UC-30: Bloquear Fecha

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-30 |
| **Nombre** | Bloquear Fecha |
| **Actor Principal** | Sistema |
| **Actores Secundarios** | - |
| **Descripción** | El sistema bloquea atómicamente una fecha cuando una consulta/reserva lo requiere |
| **Precondiciones** | - Fecha no tiene bloqueo activo |
| **Postcondiciones** | - Fecha bloqueada<br>- TTL configurado (si aplica)<br>- Bloqueo registrado |
| **Prioridad** | Crítica |
| **Frecuencia** | Alta |

**Flujo Básico:**
1. El sistema recibe solicitud de bloqueo (fecha, tipo, TTL)
2. El sistema inicia transacción atómica (`SELECT ... FOR UPDATE`)
3. El sistema verifica que la fecha está libre
4. El sistema aplica el bloqueo:
   - Bloqueo blando (3/7 días) con TTL → consulta/pre_reserva
   - Bloqueo firme (sin TTL) → reserva_confirmada
5. El sistema programa expiración si hay TTL
6. El sistema confirma la transacción
7. El sistema registra el bloqueo

**Flujos Alternativos:**
- **FA-01**: Fecha ya bloqueada → Rechazar, ofrecer cola si 2.b

---

#### UC-31: Liberar Fecha

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-31 |
| **Nombre** | Liberar Fecha |
| **Actor Principal** | Sistema |
| **Actores Secundarios** | - |
| **Descripción** | El sistema elimina atómicamente el bloqueo de una fecha cuando expira el TTL, el cliente descarta la consulta, o se cancela una reserva confirmada. Complemento de UC-30. Implementado por `liberarFecha()` (US-041). |
| **Precondiciones** | - Existe fila en `FECHA_BLOQUEADA` para `(tenant_id, fecha)` o la operación es idempotente (0 filas es éxito)<br>- Si `tipo_bloqueo = 'firme'`: la `RESERVA` referenciada debe estar en `reserva_cancelada` |
| **Postcondiciones** | - La fila `(tenant_id, fecha)` ya no existe en `FECHA_BLOQUEADA`<br>- Si había cola activa (`sub_estado = '2d'`), se ha invocado `PromocionColaPort` exactamente una vez: el adaptador real `PromocionColaPrismaAdapter` (US-018) ejecuta la mecánica A15 completa (`2d → 2b`, re-bloqueo, reordenación FIFO, alerta interna al gestor)<br>- Acción registrada en `AUDIT_LOG` con causa |
| **Prioridad** | Crítica |
| **Frecuencia** | Alta |
| **Sin endpoint HTTP propio (D-7 / US-041)** | El actor es el Sistema; la liberación es efecto de transiciones de estado y del cron de barrido, no una acción de usuario. No se añade ningún endpoint a `api-spec.yml`. |

**Causas de liberación:**
- **TTL agotado** — bloqueo blando (`tipo_bloqueo = 'blando'`) con `ttl_expiracion < now()`; lanzado por el cron de barrido (US de jobs / US-012).
- **Descarte por cliente o gestor** — la consulta/pre-reserva pasa a estado terminal (`2.z`, `2.x`); lanzado por US-013, US-011.
- **Cancelación de reserva confirmada** — la reserva pasa a `reserva_cancelada`; lanzado por el flujo de cancelación.

**Flujo Básico:**
1. El sistema invoca `liberarFecha({ tenantId, fecha, causa })`.
2. Si `tipo_bloqueo = 'firme'`: el sistema verifica en dominio que la `RESERVA` esté en `reserva_cancelada`; si no, rechaza con `LIBERACION_FIRME_SIN_CANCELACION`, audita el intento y termina.
3. El sistema inicia transacción Prisma con RLS (`SET LOCAL app.tenant_id` vía `set_config`).
4. El sistema ejecuta `DELETE FROM fecha_bloqueada WHERE tenant_id = T AND fecha = D` vía `$executeRaw` y obtiene el número de filas afectadas.
5. El sistema confirma la transacción.
6. Si `rows = 1` (liberación efectiva): el sistema registra en `AUDIT_LOG` (`accion = 'eliminar'`, `entidad = 'FECHA_BLOQUEADA'`, causa en `datos_nuevos`); si existe cola activa (`RESERVA` con `sub_estado = '2d'` y `consulta_bloqueante_id` → reserva liberada), invoca `PromocionColaPort`.
7. Si `rows = 0` (idempotente — fecha ya libre o nunca bloqueada): el sistema registra tentativa en `AUDIT_LOG` y termina sin error ni promoción.

**Flujos Alternativos:**
- **FA-01: Intento de liberar bloqueo firme con reserva activa** → rechazado en paso 2; bloqueo firme intacto; intento auditado.
- **FA-02: Fecha sin bloqueo activo (idempotencia)** → `rows = 0`; éxito silencioso; tentativa registrada en `AUDIT_LOG`; no se dispara promoción. Los retries del cron no generan errores.
- **FA-03: Liberación en lote** → N fechas expiradas procesadas, cada una en su propia transacción independiente; el fallo de una no bloquea ni revierte las demás; cada liberación exitosa dispara su `PromocionColaPort` si corresponde.

**Exactamente-una-vez ante liberaciones concurrentes:**
Si dos workers liberan la misma `(tenant_id, fecha)` simultáneamente, el motor garantiza que exactamente uno obtiene `rows = 1` (y dispara la promoción) y el otro obtiene `rows = 0` (éxito silencioso sin promoción). No hay doble promoción.

**Deuda cerrada (US-018):** la promoción efectiva de cola (reordenación FIFO + re-bloqueo atómico + alerta interna al gestor) está implementada por `PromocionColaPrismaAdapter` (US-018). El stub no-op fue sustituido; la cola ya no permanece en `2.d` indefinidamente tras una liberación con cola activa.

---

### ÁREA: HISTÓRICO

---

#### UC-32: Buscar en Histórico

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-32 |
| **Nombre** | Buscar en Histórico |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor busca y filtra reservas pasadas en el histórico consultable |
| **Precondiciones** | - El gestor está autenticado |
| **Postcondiciones** | - Resultados mostrados según criterios |
| **Prioridad** | Alta |
| **Frecuencia** | Alta |

**Flujo Básico:**
1. El gestor accede a la sección Histórico
2. El sistema muestra la tabla maestra de reservas completadas
3. El gestor puede aplicar filtros:
   - Rango de fechas
   - Tipo de evento
   - Estado final
   - Importe
4. El gestor puede usar búsqueda full-text:
   - Por nombre del cliente
   - Por número de reserva
   - Por email
   - Por observaciones
5. El sistema muestra resultados paginados
6. El gestor puede acceder al detalle de cualquier reserva (modo lectura)

---

#### UC-33: Exportar Reservas

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-33 |
| **Nombre** | Exportar Reservas |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor exporta datos de reservas a formato CSV |
| **Precondiciones** | - El gestor está autenticado<br>- Hay reservas que exportar |
| **Postcondiciones** | - Archivo CSV generado y descargado |
| **Prioridad** | Media |
| **Frecuencia** | Baja |

**Flujo Básico:**
1. El gestor accede al histórico o pipeline
2. El gestor aplica filtros deseados
3. El gestor selecciona "Exportar CSV"
4. El sistema genera el archivo con:
   - Todos los atributos de la reserva
   - Filtros aplicados
5. El sistema inicia la descarga

---

### ÁREA: DASHBOARD

---

#### UC-34: Visualizar Dashboard Operativo

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-34 |
| **Nombre** | Visualizar Dashboard Operativo |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor visualiza el dashboard operativo con la información clave del estado actual del negocio, proyectada en 7 widgets de lectura pura agregados desde una única llamada a la API. |
| **Precondiciones** | - El gestor está autenticado |
| **Postcondiciones** | - Dashboard mostrado con datos actualizados del tenant |
| **Prioridad** | Alta |
| **Frecuencia** | Muy alta |
| **US** | US-044 |
| **Endpoint** | `GET /dashboard` — sin parámetros; responde `DashboardResponse` con los 7 widgets agregados |
| **Entidades afectadas** | RESERVA, FECHA_BLOQUEADA (solo lectura, sin mutación — dashboard es read-only puro)

**Flujo Básico:**
1. El gestor navega a `/dashboard` (entrada en posición 1 del sidebar)
2. El frontend llama a `GET /dashboard` mediante el SDK generado; mientras espera muestra un esqueleto de carga
3. El sistema agrega los datos del tenant y responde con los 7 widgets (`DashboardResponse`):
   - **`hoyManana`** (`hoyMañana`): eventos del día actual y del día siguiente
   - **`pipeline`**: consultas por sub-estado, pre-reservas y reservas confirmadas
   - **`subProcesosCriticos`**: reservas con pre-evento, liquidación o fianza atrasada
   - **`pendientes`**: pagos vencidos y TTLs próximos a expirar
   - **`consultasEnCola`**: leads en espera agrupados por fecha bloqueada
   - **`visitasProgramadas`**: próximas visitas ordenadas por fecha ascendente
   - **`proximos30Dias`**: eventos y bloqueos en los próximos 30 días
4. El gestor puede interactuar con cada widget para ver el detalle de cada ítem
5. El gestor puede navegar directamente a las fichas de reserva desde cada widget

```mermaid
flowchart TD
    subgraph Dashboard[Dashboard Operativo]
        A[Hoy y Mañana]
        B[Pipeline]
        C[Sub-procesos Críticos]
        D[Pendientes]
        E[Consultas en Cola]
        F[Visitas Programadas]
        G[Próximos 30 días]
    end
    
    A --> H[Detalle evento]
    B --> I[Ficha consulta/reserva]
    C --> J[Alertas urgentes]
    D --> K[Acciones inmediatas]
    E --> L[Vista fecha con cola]
    F --> M[Ficha visita]
    G --> N[Calendario completo]
```

---

### ÁREA: COMUNICACIONES

---

#### UC-35: Enviar Email Automático

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-35 |
| **Nombre** | Enviar Email Automático |
| **Actor Principal** | Sistema |
| **Actores Secundarios** | Cliente |
| **Descripción** | El sistema envía automáticamente un email cuando se cumple un trigger específico |
| **Precondiciones** | - Trigger activado<br>- Datos del cliente disponibles<br>- Plantilla configurada |
| **Postcondiciones** | - Email enviado<br>- Registro en log de comunicaciones |
| **Prioridad** | Crítica |
| **Frecuencia** | Muy alta |

**Emails implementados en MVP:**
| ID | Trigger | Contenido | Estado plantilla |
|----|---------|-----------|-----------------|
| E1 | Lead entrante | Respuesta inicial + tarifa estimada | Activa |
| E2 | (1) Activar pre-reserva (UC-14) · (2) Reenvío de presupuesto actualizado UC-15 (`es_reenvio=true`) | Presupuesto PDF + instrucciones señal | Inactiva (diferida) |
| E3 | Acción manual del gestor: "Enviar factura 40%" — `POST /reservas/{id}/facturas/senal/enviar` (US-023, 6.4b) | Factura 40% + condicions particulars (adjunto opcional) | Activa |
| E4 | Inicio sub-proceso liquidación | Factura liquidación + recibo fianza | Inactiva (diferida) |
| E5 | Evento finalizado | Agradecimiento + solicitud IBAN | Inactiva (diferida) |
| E6 | Programar visita | Confirmación visita | Inactiva (diferida) |
| E7 | Visita realizada + interés | Confirmación bloqueo post-visita | Inactiva (diferida) |
| E8 | Cliente proporciona IBAN | Confirmación recepción + próximos pasos | Inactiva (diferida) |

> **Nota**: E1 y E3 son las únicas plantillas activas en el catálogo de plantillas del backend. E3 usa `EnviarEmailPort` directo (sin `DespacharEmailService`) para garantizar rollback atómico si el proveedor falla. Las demás están diseñadas pero con cableado diferido.
>
> **Gap E2 resuelto (US-015 / D1 — decisión PO/humano 2026-07-15):** UC-15 (editar/reenviar presupuesto estando ya en `pre_reserva`) no tenía código `E` propio asignado. Tras revisar las opciones en el gate SDD (crear `E2b`/`E9` vs reutilizar `E2`), el PO aprobó la **opción A**: reutilizar el template **E2** con `COMUNICACION.es_reenvio = true`. Esto encaja con el índice UNIQUE parcial `(reserva_id, codigo_email) WHERE es_reenvio = false` (permite N reenvíos por reserva) y con el precedente de US-023/US-028. Sin migración del enum `CodigoEmail`.

**Flujo Básico:**
1. El sistema detecta el trigger
2. El sistema selecciona la plantilla correspondiente
3. El sistema reemplaza variables con datos de la reserva
4. El sistema genera adjuntos si aplica (PDF)
5. El sistema envía el email
6. El sistema registra en log de comunicaciones de la reserva
7. El sistema registra en audit log

---

#### UC-36: Revisar y Enviar Email Borrador

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-36 |
| **Nombre** | Revisar y Enviar Email Borrador |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor revisa, edita y confirma el envío de un email generado como borrador |
| **Precondiciones** | - Email en estado borrador<br>- Generado automáticamente con comentarios o manualmente |
| **Postcondiciones** | - Email enviado<br>- Registro en log |
| **Prioridad** | Alta |
| **Frecuencia** | Alta |

**Flujo Básico:**
1. El sistema genera email como borrador (ej: lead con comentarios)
2. El sistema notifica al gestor
3. El gestor accede a la ficha de la reserva
4. El gestor abre el borrador de email
5. El gestor revisa el contenido
6. El gestor puede editar texto
7. El gestor confirma el envío
8. El sistema envía el email
9. El sistema registra en logs

---

### ÁREA: GESTIÓN DEL PIPELINE DE RESERVAS

---

#### UC-37: Visualizar Pipeline de Reservas Activas

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-37 |
| **Nombre** | Visualizar Pipeline de Reservas Activas |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | El gestor visualiza un tablero Kanban con todas las reservas activas del tenant agrupadas en 5 columnas por fase del pipeline: Consulta, Pre-reserva, Confirmada, En Curso y Post-evento. Cada tarjeta muestra el nombre del evento, fecha, aforo estimado, progreso de logística y liquidación, y una nota de estado. Clic en tarjeta navega a la FichaConsulta. |
| **Precondiciones** | - El gestor está autenticado |
| **Postcondiciones** | - Kanban mostrado con reservas activas del tenant agrupadas por fase |
| **Prioridad** | Alta |
| **Frecuencia** | Muy alta |
| **US** | US-049 (backend `GET /reservas` — implementado), US-050 (frontend Kanban) |
| **Endpoint** | `GET /reservas` (`operationId: listarReservas`) — excluye siempre terminales `2x/2y/2z`, `reserva_completada`, `reserva_cancelada`; params opcionales: `estado`, `subEstado`, `fechaDesde`, `fechaHasta`, `search`, `page`, `limit` |
| **Entidades leídas** | RESERVA (solo lectura) + join CLIENTE (para `nombreEvento`); `preEventoStatus` y `liquidacionStatus` de RESERVA para derivar los progresos. Sin migración de esquema. |

**Flujo Básico (implementado en US-049):**
1. El gestor navega a `/reservas` (tab "Flujo de Reserva" activo por defecto)
2. El frontend llama a `GET /reservas` (sin filtros adicionales)
3. El sistema — autenticado por JWT, `tenant_id` inyectado en la query y reforzado por RLS — devuelve la lista paginada de reservas activas ordenadas por `fechaCreacion` descendente. Cada elemento de `data[]` incluye `nombreEvento`, `progressLogistica` y `progressLiquidacion` ya derivados.
4. El frontend agrupa en 5 columnas: Consulta (2a/2b/2c/2d/2v) · Pre-reserva · Confirmada · En Curso · Post-evento
5. Cada tarjeta muestra: `nombreEvento`, fecha, aforo estimado, barras LOGÍSTICA y LIQUIDACIÓN
6. El gestor hace clic en cualquier tarjeta → navega a `/reservas/:id`

**Flujos Alternativos:**
- **FA-01** (sin reservas activas): el sistema responde `200` con `{ data: [], metadata: { total: 0, page: 1, limit: 20 } }`
- **FA-02** (filtro por estado): `?estado=pre_reserva` devuelve solo las activas en ese estado; el filtro de exclusión de terminales se aplica siempre con independencia de los filtros de query
- **FA-03** (sin sesión): `401` sin datos

**Reglas de Negocio:**
- Estados activos (incluidos): `2a`, `2b`, `2c`, `2d`, `2v`, `pre_reserva`, `reserva_confirmada`, `evento_en_curso`, `post_evento`
- Estados excluidos siempre: `2x`, `2y`, `2z`, `reserva_completada`, `reserva_cancelada`
- RLS: solo reservas con `tenant_id` del JWT del gestor autenticado; el `tenant_id` no es configurable por el usuario
- `nombreEvento` = `{CLIENTE.nombre} {CLIENTE.apellidos}`; fallback a `RESERVA.codigo` si no hay cliente resoluble
- `progressLogistica` (0/50/100) derivado de `preEventoStatus`: `pendiente=0`, `en_curso=50`, `cerrado=100`; en estados de consulta (`2a`/`2b`/`2c`/`2d`/`2v`) y `pre_reserva` vale siempre `0`
- `progressLiquidacion` (0/50/100) derivado de `liquidacionStatus`: `pendiente=0`, `facturada=50`, `cobrada=100`; en estados de consulta y `pre_reserva` vale siempre `0`
- La derivación de progreso es una función pura de dominio (mapa declarativo estado→valor), no lógica dispersa
- Operación de **lectura pura**: no muta ninguna entidad, no produce bloqueos, sin concurrencia mutante

---

#### UC-38: Visualizar Listado de Reservas Activas

| Campo | Descripción |
|-------|-------------|
| **ID** | UC-38 |
| **Nombre** | Visualizar Listado de Reservas Activas |
| **Actor Principal** | Gestor |
| **Actores Secundarios** | Sistema |
| **Descripción** | Desde la misma página `/reservas`, el gestor selecciona el tab "Listado" y visualiza una tabla con todas las reservas activas. Cada fila muestra el nombre del evento, estado, fecha y aforo. Clic en fila navega a la FichaConsulta. |
| **Precondiciones** | - El gestor está autenticado |
| **Postcondiciones** | - Tabla mostrada con reservas activas del tenant |
| **Prioridad** | Alta |
| **Frecuencia** | Alta |
| **US** | US-050 (frontend Listado; comparte el endpoint `GET /reservas` implementado en US-049) |
| **Endpoint** | `GET /reservas` (`operationId: listarReservas`) — mismo filtro que UC-37 |
| **Entidades leídas** | RESERVA + join CLIENTE — igual que UC-37; sin migración de esquema. |

**Flujo Básico:**
1. El gestor accede a `/reservas` y selecciona el tab "Listado"
2. El frontend reutiliza los datos ya obtenidos en UC-37 (sin llamada adicional al endpoint)
3. El frontend renderiza una tabla con columnas: Nombre · Estado · Fecha · Aforo · Acciones
4. El gestor hace clic en cualquier fila → navega a `/reservas/:id`

**Reglas de Negocio:**
- Mismos filtros de exclusión, aislamiento multi-tenant y derivaciones de `nombreEvento`/progreso que UC-37
- Tabla vacía con CTA "Nueva Reserva" cuando no hay reservas activas

---

## 4. Diagrama de Interconexión de Casos de Uso

```mermaid
flowchart TB
    subgraph Auth[Autenticación]
        UC01[UC-01: Iniciar Sesión]
        UC02[UC-02: Cerrar Sesión]
    end
    
    subgraph Leads[Gestión de Leads]
        UC03[UC-03: Alta Lead]
        UC04[UC-04: Transición 2.a→2.b]
        UC05[UC-05: Extender Bloqueo]
        UC06[UC-06: Transición 2.b→2.c]
        UC07[UC-07: Programar Visita]
        UC08[UC-08: Resultado Visita]
        UC09[UC-09: Expirar Consulta]
        UC10[UC-10: Descartar Consulta]
    end
    
    subgraph Cola[Cola de Espera]
        UC11[UC-11: Visualizar Cola]
        UC12[UC-12: Promover de Cola]
        UC13[UC-13: Salir de Cola]
    end
    
    subgraph PreRes[Pre-reserva]
        UC14[UC-14: Generar Presupuesto]
        UC15[UC-15: Editar/Reenviar Presupuesto]
        UC16[UC-16: Calcular Tarifa]
    end
    
    subgraph Confirm[Confirmación]
        UC17[UC-17: Confirmar Señal]
        UC18[UC-18: Generar Factura Señal]
        UC19[UC-19: Condiciones Particulares]
    end
    
    subgraph SubProc[Sub-procesos]
        UC20[UC-20: Pre-evento]
        UC21[UC-21: Liquidación]
        UC22[UC-22: Fianza]
    end
    
    subgraph Evento[Evento]
        UC23[UC-23: Iniciar Evento]
        UC24[UC-24: Documentación]
        UC25[UC-25: Finalizar Evento]
    end
    
    subgraph Post[Post-evento]
        UC26[UC-26: Solicitar IBAN]
        UC27[UC-27: Devolver Fianza]
        UC28[UC-28: Archivar]
    end
    
    subgraph Calendario[Calendario]
        UC29[UC-29: Consultar]
        UC30[UC-30: Bloquear]
        UC31[UC-31: Liberar]
    end
    
    subgraph Historico[Histórico]
        UC32[UC-32: Buscar]
        UC33[UC-33: Exportar]
    end
    
    subgraph Dashboard[Dashboard]
        UC34[UC-34: Visualizar]
    end
    
    subgraph Comms[Comunicaciones]
        UC35[UC-35: Email Auto]
        UC36[UC-36: Email Borrador]
    end
    
    subgraph Pipeline[Pipeline de Reservas]
        UC37[UC-37: Visualizar Pipeline]
        UC38[UC-38: Listado Activas]
    end
    
    %% Flujo principal
    UC01 --> UC34
    UC01 --> UC37
    UC37 --> UC38
    UC03 --> UC04
    UC03 --> UC30
    UC04 --> UC14
    UC06 --> UC12
    UC07 --> UC08
    UC08 --> UC04
    UC08 --> UC14
    UC09 --> UC31
    UC09 --> UC12
    UC14 --> UC16
    UC14 --> UC17
    UC17 --> UC18
    UC17 --> UC19
    UC17 --> UC20
    UC17 --> UC21
    UC17 --> UC22
    UC20 --> UC23
    UC21 --> UC23
    UC22 --> UC23
    UC23 --> UC24
    UC24 --> UC25
    UC25 --> UC26
    UC26 --> UC27
    UC27 --> UC28
    UC28 --> UC32
    
    %% Relaciones transversales
    UC03 --> UC35
    UC14 --> UC35
    UC17 --> UC35
    UC36 -.-> UC35
    UC29 --> UC11
    UC31 --> UC12
```

---

## 5. Tabla Comparativa de Casos de Uso

| ID | Caso de Uso | Actor Principal | Impacto Negocio | Prioridad | Complejidad |
|----|-------------|-----------------|-----------------|-----------|-------------|
| UC-01 | Iniciar Sesión | Gestor | Alto | Crítica | Baja |
| UC-02 | Cerrar Sesión | Gestor | Bajo | Alta | Baja |
| UC-03 | Alta Lead | Gestor | Crítico | Crítica | Alta |
| UC-04 | Transición 2.a→2.b | Gestor | Alto | Alta | Media |
| UC-05 | Extender Bloqueo | Gestor | Medio | Media | Baja |
| UC-06 | Transición 2.b→2.c | Gestor | Alto | Alta | Media |
| UC-07 | Programar Visita | Gestor | Alto | Alta | Media |
| UC-08 | Resultado Visita | Gestor | Alto | Alta | Media |
| UC-09 | Expirar Consulta | Sistema | Alto | Crítica | Media |
| UC-10 | Descartar Consulta | Gestor | Medio | Media | Baja |
| UC-11 | Visualizar Cola | Gestor | Medio | Alta | Baja |
| UC-12 | Promover de Cola (automático US-018 / manual US-019) | Sistema/Gestor | Crítico | Crítica | Alta |
| UC-13 | Salir de Cola | Cliente/Gestor | Bajo | Media | Baja |
| UC-14 | Generar Presupuesto | Gestor | Crítico | Crítica | Alta |
| UC-15 | Editar y Reenviar Presupuesto en Pre-reserva | Gestor | Medio | Media | Media |
| UC-16 | Calcular Tarifa | Sistema | Crítico | Crítica | Media |
| UC-17 | Confirmar Señal | Gestor | Crítico | Crítica | Alta |
| UC-18 | Generar Factura Señal | Sistema | Alto | Crítica | Media |
| UC-19 | Condiciones Particulares | Gestor | Alto | Alta | Media |
| UC-20 | Gestión Pre-evento | Gestor | Alto | Alta | Media |
| UC-21 | Gestión Liquidación | Gestor | Crítico | Crítica | Alta |
| UC-22 | Gestión Fianza | Gestor | Alto | Alta | Media |
| UC-23 | Iniciar Evento | Sistema/Gestor | Alto | Alta | Media |
| UC-24 | Capturar Documentación | Gestor/Equipo | Medio | Alta | Baja |
| UC-25 | Finalizar Evento | Gestor | Alto | Alta | Baja |
| UC-26 | Solicitar IBAN | Sistema | Medio | Alta | Baja |
| UC-27 | Devolver Fianza | Gestor | Medio | Alta | Media |
| UC-28 | Archivar Reserva | Sistema/Gestor | Bajo | Media | Baja |
| UC-29 | Consultar Calendario | Gestor | Alto | Crítica | Media |
| UC-30 | Bloquear Fecha | Sistema | Crítico | Crítica | Alta |
| UC-31 | Liberar Fecha | Sistema | Crítico | Crítica | Alta |
| UC-32 | Buscar Histórico | Gestor | Medio | Alta | Media |
| UC-33 | Exportar Reservas | Gestor | Bajo | Media | Baja |
| UC-34 | Dashboard Operativo | Gestor | Alto | Alta | Media |
| UC-35 | Email Automático | Sistema | Alto | Crítica | Media |
| UC-36 | Email Borrador | Gestor | Medio | Alta | Baja |
| UC-37 | Visualizar Pipeline de Reservas (Kanban) | Gestor | Alto | Alta | Media |
| UC-38 | Visualizar Listado de Reservas Activas | Gestor | Medio | Alta | Baja |

---

## 6. Diagrama de Estados Completo del Sistema

```mermaid
stateDiagram-v2
    [*] --> consulta_2a: Lead sin fecha
    [*] --> consulta_2b: Lead con fecha libre
    [*] --> consulta_2d: Lead con fecha bloqueada por 2.b
    
    consulta_2a --> consulta_2b: Indica fecha libre
    consulta_2a --> consulta_2v: Solicita visita
    consulta_2a --> pre_reserva: Info completa
    consulta_2a --> consulta_2z: Cliente descarta (US-013)
    
    consulta_2b --> consulta_2c: Confirma pero<br>falta invitados
    consulta_2b --> consulta_2v: Solicita visita
    consulta_2b --> pre_reserva: Info completa
    consulta_2b --> consulta_2x: TTL 3d expira
    consulta_2b --> consulta_2z: Cliente descarta (US-013)
    
    consulta_2c --> pre_reserva: Info completa
    consulta_2c --> consulta_2x: TTL expira
    consulta_2c --> consulta_2z: Cliente descarta (US-013)
    
    consulta_2d --> consulta_2b: Promoción automática FIFO (US-018) o manual por Gestor (US-019)
    consulta_2d --> consulta_2y: Bloqueante avanza
    consulta_2d --> consulta_2z: Cliente descarta (US-013)
    
    consulta_2v --> consulta_2b: Visita OK<br>+ interés
    consulta_2v --> pre_reserva: Visita OK<br>+ reserva inmediata
    consulta_2v --> consulta_2x: Bloqueo expira
    consulta_2v --> consulta_2z: Cliente descarta (US-013)
    
    pre_reserva --> reserva_confirmada: Señal cobrada
    pre_reserva --> reserva_cancelada: TTL 7d expira
    
    state reserva_confirmada {
        [*] --> subprocesos
        state subprocesos {
            pre_evento --> cerrado_pe
            liquidacion --> cobrada_liq
            fianza --> cobrada_fi
        }
    }
    
    reserva_confirmada --> evento_en_curso: Día evento<br>+ precondiciones
    
    evento_en_curso --> post_evento: Evento finalizado
    
    post_evento --> reserva_completada: T+7d o<br>archivo manual
    
    consulta_2x --> [*]: Terminal
    consulta_2y --> [*]: Terminal
    consulta_2z --> [*]: Terminal
    reserva_completada --> [*]: Terminal
    reserva_cancelada --> [*]: Terminal
```

---

## 7. Verificación de Cobertura del MVP

### 7.1 Matriz de Trazabilidad

| Funcionalidad MVP | Casos de Uso que la cubren | Estado |
|-------------------|---------------------------|--------|
| Auth básica + multi-tenant | UC-01, UC-02 | ✅ Cubierto |
| Pipeline completo (2.a-2.z) | UC-03 a UC-13 | ✅ Cubierto |
| Sub-procesos paralelos | UC-20, UC-21, UC-22 | ✅ Cubierto |
| Cola de espera | UC-11, UC-12, UC-13 | ✅ Cubierto |
| Sub-estado 2.v (visita) | UC-07, UC-08 | ✅ Cubierto |
| Calendario visual + bloqueo atómico | UC-29, UC-30, UC-31 | ✅ Cubierto |
| Ficha de reserva | UC-03, UC-17 | ✅ Cubierto |
| Ficha operativa evento | UC-20 | ✅ Cubierto |
| Histórico consultable | UC-32, UC-33 | ✅ Cubierto |
| Motor de tarifas | UC-16 | ✅ Cubierto |
| Generación presupuestos PDF | UC-14, UC-15 | ✅ Cubierto |
| Generación facturas | UC-18, UC-21 | ✅ Cubierto |
| Gestión fianza | UC-22, UC-26, UC-27 | ✅ Cubierto |
| Datos fiscales cliente | UC-03, UC-14 | ✅ Cubierto |
| Condiciones particulares | UC-19 | ✅ Cubierto |
| Documentación día evento | UC-24 | ✅ Cubierto |
| Emails automáticos (E1-E8) | UC-35, UC-36 | ✅ Cubierto |
| Dashboard operativo | UC-34 | ✅ Cubierto |
| Pipeline de reservas activas (Kanban + Listado) | UC-37 (Kanban), UC-38 (Listado) | ✅ Cubierto |
| Audit log | Transversal en todos los UC | ✅ Cubierto |

### 7.2 Funcionalidades Excluidas del MVP (Solo diseñadas)

| Funcionalidad | Motivo de exclusión |
|---------------|---------------------|
| Detección automática leads recurrentes | Complejidad, no crítico para MVP |
| Importación CSV histórico | No necesario para Masia l'Encís |
| Factura complementaria post-evento | Bajo uso, diferido a V1 |
| Emails de cola | Gestión manual en MVP |
| Recordatorios extendidos | Diferido a V1 |
| Dashboard financiero + KPIs | Diferido a V1 |
| Política cancelación configurable | Hardcoded "Negociable" en MVP |
| Parser emails entrantes | Requiere LLM, diferido |
| Integración Stripe | Pagos manuales en MVP |
| WhatsApp Business API | Diferido a V2 |

---

## 8. Conclusiones

Este análisis ha identificado **38 casos de uso** que cubren completamente la funcionalidad del MVP de Slotify. Los casos se organizan en 13 áreas funcionales que abarcan desde la autenticación hasta el archivo en histórico.

**Puntos clave:**

1. **Flujo principal robusto**: Los casos de uso cubren el ciclo completo lead → archivo con todos los sub-estados y transiciones definidos en la especificación.

2. **Gestión de cola implementada**: La mecánica de cola de espera (UC-11, UC-12, UC-13) está completamente definida. UC-12 cubre los dos flujos: promoción automática FIFO por el Sistema (US-018) y promoción manual por el Gestor de cualquier posición de la cola (US-019), con coordinación anti-doble-promoción via `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA`.

3. **Sub-procesos paralelos**: La gestión simultánea de pre-evento, liquidación y fianza (UC-20, UC-21, UC-22) está claramente especificada con sus interacciones.

4. **Bloqueo atómico de fecha**: Los casos UC-30 y UC-31 garantizan la prevención de dobles reservas, el dolor crítico D4.

5. **Comunicaciones automatizadas**: Los 8 emails del flujo principal (E1-E8) están cubiertos por UC-35 y UC-36.

6. **Trazabilidad completa**: Cada caso de uso traza a requisitos específicos de la especificación funcional y a dolores operativos identificados.

---

*Documento generado el 22/05/2026 como parte del análisis de requisitos del TFM de Slotify. Versión 1.8 (15/07/2026): refleja US-013 — Marcar consulta como descartada por cliente (UC-10 / A17): reemplaza la ficha stub de UC-10 con la especificación completa implementada: guarda de origen declarativa `{consulta, sub_estado ∈ {2a,2b,2c,2d,2v}}`; tabla de efectos por origen (liberación de `FECHA_BLOQUEADA`, promoción FIFO A15 vía `PromocionColaPort`, reordenación de cola o no-op según el sub-estado de partida); motivo opcional anexado a `RESERVA.notas`; atomicidad all-or-nothing; endpoint `POST /reservas/{id}/descartar` con body `{ motivo?: string }` (operationId `descartarConsultaPorCliente`); flujos alternativos FA-01..FA-09 (incluyendo RC-1/RC-2/RC-3 de concurrencia); diagrama Mermaid; distinción semántica de terminales `2x`/`2y`/`2z`; sin email al cliente (no mapeado a ningún código E1–E8). Actualiza el diagrama de estados §6: añade las aristas `consulta_2a`/`consulta_2b`/`consulta_2c → consulta_2z` que faltaban (ya existían `2d→2z` y `2v→2z`). Sin migración de esquema (columnas y enums ya existentes desde US-000/US-004).*
*Documento generado el 22/05/2026 como parte del análisis de requisitos del TFM de Slotify. Versión 1.7 (07/07/2026): refleja US-049 y US-050 — Pipeline de Reservas. UC-37 (Kanban) y UC-38 (Listado) marcados como implementados. Añadidos a la tabla §5, a la matriz de trazabilidad §7.1 y actualizados los totales de §8 (36 → 38 casos, 12 → 13 áreas). Fix de conformidad del backend (US-050 bloque 5b): la proyección de `GET /reservas` ahora es conforme al schema `Reserva` del contrato — emite `idReserva` (no `id`) y propaga `fechaEvento`, `numInvitadosFinal`, `numAdultosNinosMayores4`, `numNinosMenores4`, `notas`. Fix de filtro (US-050 bloque 5c): el adaptador admite `subEstado IS NULL` vía `AND/OR`, por lo que `pre_reserva`, `reserva_confirmada`, `evento_en_curso` y `post_evento` (con `subEstado = null`) aparecen correctamente en el pipeline. Ninguno de los dos fixes supone cambio de contrato ni de esquema de datos.*
*Documento generado el 22/05/2026 como parte del análisis de requisitos del TFM de Slotify. Versión 1.6 (04/07/2026): refleja US-028 — Gestor Aprueba y Envía la Factura de Liquidación (UC-21 / UC-22): actualiza el flujo básico de UC-21 — paso 3 añade la posibilidad de descuento negociado en borrador (D-2 US-028); paso 4 documenta `AprobarYEnviarLiquidacionUseCase` con atomicidad síncrona E4 confirmada (D-1 US-028: excepción al patrón post-commit, rollback total si E4 falla); pasos 5–6 detallan los efectos (`liquidacion_status='facturada'`, `fianza_status='recibo_enviado'`, `COMUNICACION E4 es_reenvio=false`); añade FA-02 (rollback total ante fallo de E4), FA-03 (reenvío D-4 US-028: `es_reenvio=true`, sin reasignación fiscal), FA-04 (descuento negociado), FA-05 (PDF no disponible). Actualiza el flujo básico de UC-22 — paso 3 documenta `EnviarReciboFianzaUseCase` (US-028 D-3: endpoint `POST /reservas/{id}/facturas/fianza/enviar`, `codigo_email='manual'`, solo `fianza_status`); añade FA-03 (fianza ya enviada antes de la aprobación de liquidación — E4 no sobreescribe). Sin cambios en UC-28 (sigue siendo "Archivar Reserva", distinto de US-028 de facturación).*
*Documento generado el 22/05/2026 como parte del análisis de requisitos del TFM de Slotify. Versión 1.5 (03/07/2026): refleja US-010 — Registrar resultado de visita: reserva inmediata (2.v → pre_reserva / UC-08 FA-08 / UC-14): actualiza la ficha de UC-08 con la descripción del flujo B implementado (US-010), postcondiciones para "reserva inmediata" (`estado='pre_reserva'`, `sub_estado=NULL`, TTL de 7 días, cola A16 vaciada, sin email propio), endpoint polimórfico (`resultado: "interesado" | "reserva_inmediata"`), entidades afectadas ampliadas; añade el Flujo Básico B (pasos 1–8) con validación de datos obligatorios UC-14 + transacción RESERVA + FECHA_BLOQUEADA UPDATE + cola A16 + AUDIT_LOG; añade FA-10 (datos incompletos — 422 con `camposFaltantes`), FA-11 (cola vacía — válida), FA-12 (concurrencia D4 y vaciado de cola); actualiza el diagrama Mermaid con la rama `reserva_inmediata`. Sin migración de esquema (todos los campos ya existían desde US-000/US-008).*
*Documento generado el 22/05/2026 como parte del análisis de requisitos del TFM de Slotify. Versión 1.4 (03/07/2026): refleja US-019 — Promoción Manual de Consulta en Cola (UC-12 flujo B): actualiza la ficha de UC-12 con el actor dual (Sistema/Gestor), postcondiciones y entidades afectadas para el flujo manual; añade el flujo B completo (pasos 1–8 + FA-01..FA-07) con endpoint `POST /reservas/{id}/promover`, mecánica de expiración forzosa de la bloqueante (`2b/2c/2v → 2x`), re-asignación atómica de `FECHA_BLOQUEADA`, reordenación por cierre de hueco, AUDIT_LOG con `origen: 'promocion_manual'` y política de arbitraje (FIFO estricto, 409 al Gestor si el automático gana); añade diagrama de secuencia Mermaid del flujo B; actualiza la nota sobre US-019 (ya implementada, no futura); precisa la transición `consulta_2d → consulta_2b` en el diagrama §6 para distinguir automática (US-018) y manual (US-019); actualiza §5, §7, §8 con la referencia al flujo manual. Sin migración de esquema (US-019 no añade entidades ni columnas; reutiliza `RESERVA`, `FECHA_BLOQUEADA`, `AUDIT_LOG` y sus campos existentes). Versión 1.3 (30/06/2026): refleja US-039 — visualizar el Calendario de Disponibilidad (UC-29): reemplaza la ficha original de UC-29 con la especificación completa implementada: vista de lectura pura (sin mutación); endpoint `GET /calendario` (query `desde`/`hasta`/`vista`; respuesta `CalendarioResponse` con `rango` + `fechas[]` agregadas por fecha ocupada, incluyendo `color`/`estado`/`subEstado`/`reservaId`/`cliente`/`ttlRestante`/`enCola`; 401 sin sesión; 422 rango inválido); código de colores canónico (SlotifyGeneralSpecs §11.3) como tabla de datos declarativa; indicador `🔁 N en cola` sobre la celda bloqueante; popover de detalle al clic sin segunda llamada; aislamiento multi-tenant + RLS; calendar en react-big-calendar como página de inicio del App Shell; US, endpoint y entidades afectadas (`RESERVA`/`FECHA_BLOQUEADA` — lectura); flujos alternativos FA-01..FA-05 y diagrama Mermaid. Sin migración de esquema (no hay cambios en `RESERVA` ni `FECHA_BLOQUEADA`). Versión 1.2 (30/06/2026): refleja US-008 — programar visita al espacio (UC-07): reemplaza la ficha original de UC-07 con la especificación completa implementada: guarda de origen multi-estado `{2a,2b,2c}→2v`; precondición `fecha_evento` NOT NULL para `2a`; ventana `fecha_visita ∈ [hoy+1, hoy+max_dias_programar_visita]` (setting del tenant); INSERT-o-UPDATE de `FECHA_BLOQUEADA` (`ttl=visita+1 día`) según origen; atomicidad RESERVA+FECHA_BLOQUEADA+AUDIT_LOG en una única transacción; E6 post-commit vía motor US-045; US, endpoint `POST /reservas/{id}/visita`, entidades afectadas, flujos alternativos FA-01..FA-06 y diagrama Mermaid. A19/A20 (recordatorios al gestor) fuera de alcance de esta US (slice de jobs separado). Sin migración de columnas (campos de visita + sub-estado `2v` + `max_dias_programar_visita` ya existentes desde US-000). Versión 1.1 (28/06/2026): refleja US-004 — alta de consulta con fecha (UC-03): actualiza §3 UC-03 — flujo básico paso 3 (`fecha_evento > hoy`, estrictamente futura) y FA-01 (rechaza hoy y pasado con 400 en servidor; divergencia intencional Gate 1 decisión A; trazabilidad a `design.md §D-1`). Corrección transversal: UC-04 precondiciones alineadas con la regla real de `bloquearFecha()` / `validarFechaFutura` (`> hoy`; inconsistencia preexistente respecto a la ficha original).*
