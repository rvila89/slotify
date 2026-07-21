# auth Specification

## Purpose
TBD - created by archiving change us-001-iniciar-sesion. Update Purpose after archive.
## Requirements
### Requirement: Login con credenciales válidas emite tokens y audita
El sistema SHALL (DEBE) exponer `POST /auth/login` como ruta **pública**. Dado un
`email` y `password` correctos de un `Usuario` con `activo = true`, el sistema
DEBE verificar la contraseña contra el `passwordHash` (argon2) del usuario dentro
de su `tenant_id`, emitir un **access token JWT** de vida corta (~15 min) cuyo
payload firmado incluye `{sub, tenantId, rol, email}`, establecer el **refresh
token** (~7 días) en una cookie `httpOnly + Secure + SameSite`, y registrar el
evento `login` en `AUDIT_LOG`. La respuesta DEBE devolver el access token y los
datos públicos del usuario (`LoginResponse`). El sistema nunca DEBE almacenar ni
transmitir la contraseña en claro. (Fuente: `US-001 §Happy Path`,
`§Reglas de negocio`, `§Reglas de Validación`; UC-01 paso 7; `architecture.md §2.8`.)

#### Scenario: Gestor con cuenta activa inicia sesión correctamente
- **GIVEN** un gestor con cuenta `activo = true` en su tenant
- **WHEN** envía a `POST /auth/login` su `email` y `password` correctos
- **THEN** el sistema verifica la contraseña contra el hash argon2 almacenado
- **AND** responde 200 con un access token JWT que lleva `tenantId` y `rol` en el
  payload firmado, y los datos públicos del usuario
- **AND** establece el refresh token en una cookie `httpOnly + Secure + SameSite`
- **AND** escribe un registro `login` en `AUDIT_LOG`

#### Scenario: La contraseña nunca viaja ni se persiste en claro
- **WHEN** se inspecciona la verificación de credenciales y los registros
- **THEN** la contraseña se compara únicamente mediante hash argon2
- **AND** ni la respuesta ni `AUDIT_LOG` contienen la contraseña en claro

### Requirement: Aislamiento multi-tenant desde el token firmado
En toda petición autenticada, el sistema SHALL (DEBE) extraer `tenant_id` y `rol`
del **payload firmado del access token** y aplicar el aislamiento multi-tenant sin
consultar la base de datos para validar el tenant en cada llamada. (Fuente:
`US-001 §Happy Path` 2º escenario, `§Reglas de negocio`; `architecture.md §2.8`.)

#### Scenario: El backend resuelve el tenant desde el access token
- **GIVEN** un gestor autenticado con un access token válido
- **WHEN** el frontend realiza una petición autenticada a la API
- **THEN** el backend extrae `tenant_id` y `rol` del token firmado
- **AND** aplica el aislamiento multi-tenant sin consultar la BD para validar el
  tenant en esa llamada

### Requirement: Credenciales inválidas devuelven error genérico (anti-enumeration)
El sistema SHALL (DEBE) responder un **401 genérico y uniforme** ("Credenciales
incorrectas") cuando el `email` no existe o la contraseña no coincide con el hash
almacenado, sin distinguir cuál campo es incorrecto, para no revelar qué emails
existen (OWASP A01). El usuario DEBE poder reintentar. No se emite token ni se
registra `login`. (Fuente: `US-001 §FA-01`.)

#### Scenario: Email inexistente y contraseña incorrecta dan la misma respuesta
- **GIVEN** un intento de login con un email inexistente, y otro con email válido
  pero contraseña incorrecta
- **WHEN** se envían a `POST /auth/login`
- **THEN** ambos reciben un 401 con el mismo mensaje genérico
- **AND** la respuesta no permite distinguir si el email existe
- **AND** no se emite token ni se registra `login` en `AUDIT_LOG`

### Requirement: Cuenta deshabilitada no autentica
Cuando un `Usuario` tiene `activo = false`, el sistema SHALL (DEBE) rechazar el
login: no emite token ni registra `login` en `AUDIT_LOG`, e informa de que la
cuenta está deshabilitada sugiriendo contactar con el administrador. El **código
de estado HTTP** de esta respuesta (401 genérico vs 403 informativo) está sujeto a
la decisión §5(b) del `proposal.md`. La reactivación se hace por script/seed, no
por UI. (Fuente: `US-001 §FA-02`.)

#### Scenario: Login con cuenta activo=false es rechazado sin token ni auditoría
- **GIVEN** un gestor cuya cuenta tiene `activo = false`
- **WHEN** envía credenciales a `POST /auth/login`
- **THEN** el sistema rechaza la autenticación
- **AND** no emite token ni registra `login` en `AUDIT_LOG`
- **AND** informa de que la cuenta está deshabilitada

### Requirement: Renovación de access token vía refresh
El sistema SHALL (DEBE) exponer `POST /auth/refresh`, autenticado por la cookie
`refresh_token`. Con un refresh token válido DEBE emitir un nuevo access token
(`LoginResponse`). Si el refresh token ha expirado o es inválido, el sistema DEBE
responder **401 y limpiar la cookie** del refresh token; el frontend DEBE redirigir
al login. (Fuente: `US-001 §Edge case refresh token`.)

#### Scenario: Refresh válido renueva el access token
- **GIVEN** un gestor con un refresh token válido en cookie
- **WHEN** llama a `POST /auth/refresh`
- **THEN** el sistema responde 200 con un nuevo access token

#### Scenario: Refresh expirado o inválido cierra la sesión
- **GIVEN** un gestor cuyo access y refresh token han expirado o el refresh es
  inválido
- **WHEN** el frontend llama a `POST /auth/refresh`
- **THEN** el sistema responde 401 y limpia la cookie del refresh token
- **AND** el frontend redirige al formulario de login

### Requirement: Logout limpia la sesión de refresh
El sistema SHALL (DEBE) exponer `POST /auth/logout` para cerrar la sesión activa del
dispositivo actual. El endpoint DEBE identificar al usuario a partir del **refresh
token de la cookie `httpOnly`**, limpiar esa cookie y responder de forma
**idempotente** (200/204): un segundo logout con refresh token expirado, invalidado
o ausente DEBE responder igualmente 200/204 **sin error**, limpiando cualquier
cookie presente. Cuando el usuario es **identificable** desde el token, el sistema
DEBE registrar el evento en `AUDIT_LOG` con `accion = logout`, el `usuario_id` y el
`tenant_id` correspondientes (inserción bajo el contexto RLS del tenant); si **no**
hay usuario identificable, NO se registra `AUDIT_LOG`. El endpoint es **no anónimo**:
actúa únicamente sobre la cookie de refresh del propio llamante y no acepta un
identificador de usuario de destino, por lo que no puede invalidarse la sesión de
otro usuario. El **access token no se revoca de forma activa**: sigue siendo válido
hasta su expiración natural (~15 min) y es el frontend quien lo elimina de memoria;
el logout completa con éxito **independientemente** del estado del access token
(incluso si ya expiró). En MVP la invalidación opera sobre la sesión del dispositivo
actual (limpieza de la cookie, best-effort); el global logout sobre otros
dispositivos queda fuera de alcance. (Fuente: `US-002 §Happy Path`,
`§Reglas de Validación`, `§Edge cases`; UC-02 paso 4; `er-diagram §3.17`;
`data-model.md §3.17`; `architecture.md §2.8`.)

#### Scenario: Logout con sesión activa limpia la cookie y audita
- **GIVEN** un gestor autenticado con un refresh token válido en cookie `httpOnly`
- **WHEN** llama a `POST /auth/logout`
- **THEN** el sistema identifica al usuario desde el refresh token
- **AND** responde 200/204 y limpia la cookie de refresh en la respuesta
- **AND** registra en `AUDIT_LOG` un evento `accion = logout` con el `usuario_id` y
  el `tenant_id` del usuario

#### Scenario: Logout doble es idempotente y no da error
- **GIVEN** un gestor que ya cerró sesión (su refresh token fue limpiado/invalidado)
- **WHEN** intenta cerrar sesión de nuevo con la cookie ausente, expirada o inválida
- **THEN** el sistema responde 200/204 de forma idempotente, sin devolver error
- **AND** registra el evento en `AUDIT_LOG` **solo si** el token aún identifica a un
  usuario; si no hay usuario identificable, no escribe `AUDIT_LOG`

#### Scenario: Access token ya expirado — el logout completa igual
- **GIVEN** un gestor cuyo access token ha expirado por su TTL natural (~15 min) pero
  cuyo refresh token sigue siendo válido
- **WHEN** selecciona "Cerrar sesión"
- **THEN** el sistema igualmente identifica al usuario por el refresh token, limpia
  la cookie y responde 200/204
- **AND** el logout completa con éxito con independencia del estado del access token

#### Scenario: El logout no puede invalidar la sesión de otro usuario (no anónimo)
- **GIVEN** una petición a `POST /auth/logout`
- **WHEN** se procesa el cierre de sesión
- **THEN** el sistema actúa únicamente sobre la cookie de refresh del propio llamante
- **AND** no acepta ningún identificador de usuario de destino, de modo que no puede
  cerrarse la sesión de otro usuario

#### Scenario: El access token previo no se revoca activamente
- **GIVEN** un gestor que acaba de cerrar sesión en el servidor
- **WHEN** se evalúa la validez de su access token previo
- **THEN** el access token sigue siendo criptográficamente válido hasta su expiración
  natural (≤ 15 min), porque el MVP no mantiene una blocklist de access tokens
- **AND** el cliente garantiza la pérdida de acceso eliminando el access token de
  memoria

### Requirement: Endpoint de usuario autenticado
El sistema SHALL (DEBE) exponer `GET /auth/me`, autenticado por bearer (access
token), que devuelve los datos públicos del `Usuario` autenticado
(`{idUsuario, email, nombre, apellidos?, rol}`). Sin token válido DEBE responder
401. Este endpoint pasa del stub de US-000A (que devolvía el payload del JWT) a
resolver el usuario real. (Fuente: contrato `GET /auth/me`; scaffolding US-000A.)

#### Scenario: Usuario autenticado consulta sus datos
- **GIVEN** un gestor autenticado con access token válido
- **WHEN** llama a `GET /auth/me`
- **THEN** el sistema responde 200 con `{idUsuario, email, nombre, apellidos?, rol}`

#### Scenario: Sin token válido devuelve 401
- **GIVEN** una petición sin bearer válido
- **WHEN** llama a `GET /auth/me`
- **THEN** el sistema responde 401

### Requirement: Sesión del frontend en memoria sin almacenamiento persistente
El frontend SHALL (DEBE) almacenar el access token y la sesión **solo en memoria**
de la SPA, nunca en `localStorage` ni `sessionStorage`. Tras un login exitoso DEBE
poblar la sesión (consumida por el guard `RequireAuth` de US-000A) y **redirigir al
calendario**. El cliente HTTP DEBE incluir un interceptor que, ante un access token
expirado (401), **renueve vía `POST /auth/refresh` y, si la renovación tiene éxito,
reintente de forma transparente la petición original con el nuevo access token,
devolviendo la Response del reintento** — de modo que la capa de datos (TanStack
Query) reciba un resultado exitoso y **nunca** el 401 intermedio. Si la renovación
falla, el interceptor DEBE cerrar la sesión y redirigir al login. El estado de
sesión del frontend SHALL (DEBE) contemplar, además de `authenticated` y
`unauthenticated`, un estado transitorio `recovering` durante el intento de
rehidratación en el arranque de la app (ver requisito de recuperación en recarga).
(Fuente: `US-001 §Happy Path`, `§Reglas de Validación`; `architecture.md §2.8`;
scaffolding US-000A `session.tsx`/`RequireAuth.tsx`; petición de usuario Pieza 1.)

#### Scenario: Tras login la sesión se puebla en memoria y redirige al calendario
- **GIVEN** un gestor que completa el login con éxito
- **WHEN** el frontend recibe el access token y los datos del usuario
- **THEN** la sesión se puebla en memoria (sin `localStorage`/`sessionStorage`)
- **AND** la aplicación redirige al calendario

#### Scenario: El access token no se persiste en almacenamiento del navegador
- **WHEN** se inspecciona el código del cliente y el estado del navegador
- **THEN** el access token no aparece en `localStorage` ni `sessionStorage`

#### Scenario: Un 401 con refresh exitoso se resuelve sin error visible
- **GIVEN** un gestor autenticado cuyo access token en memoria ha expirado
- **WHEN** realiza una petición autenticada y la API responde 401
- **THEN** el interceptor llama a `POST /auth/refresh` y obtiene un nuevo access token
- **AND** reejecuta la petición original con el nuevo access token en el header
  `Authorization`
- **AND** devuelve a la capa de datos la Response del reintento (2xx), de modo que
  **no** se muestra ningún banner de error ni el usuario debe reintentar a mano

#### Scenario: Un 401 con refresh fallido cierra la sesión
- **GIVEN** un gestor cuya cookie de refresh ha expirado o es inválida
- **WHEN** una petición autenticada responde 401 y el `POST /auth/refresh` también falla
- **THEN** el interceptor cierra la sesión de memoria y redirige al formulario de login
- **AND** no entra en bucle de reintentos (el 401 del propio `/auth/refresh` no dispara
  otro refresh)

### Requirement: Validación de formulario de login en el frontend
El frontend SHALL (DEBE) bloquear el envío del formulario y mostrar mensajes de
validación **por campo** cuando el `email` o la `password` estén vacíos, o cuando
el `email` tenga un formato inválido, **antes** de realizar cualquier llamada a la
API. (Fuente: `US-001 §Edge case campos vacíos`.)

#### Scenario: Campos vacíos o email inválido no llegan a la API
- **GIVEN** el formulario de login
- **WHEN** el gestor deja email o contraseña vacíos, o introduce un email mal
  formado, e intenta confirmar
- **THEN** el frontend bloquea el envío y muestra mensajes de validación por campo
- **AND** no se realiza ninguna llamada a la API

### Requirement: Multi-device (FA-03) — diferido en US-001
El flujo interactivo de FA-03 SHALL (DEBE) quedar **diferido** en US-001 (informar
de sesión existente y ofrecer continuar o cerrar la sesión anterior), sujeto a la
decisión §4 del `proposal.md`. En US-001, con refresh stateless (§2), las sesiones
multi-device coexisten en silencio; la invalidación real de una sesión anterior
requiere la estrategia stateful con registro de sesiones, fuera de alcance.
(Fuente: `US-001 §FA-03`, `§Notas de alcance`.)

#### Scenario: Sesiones desde varios dispositivos coexisten sin flujo interactivo
- **GIVEN** un gestor con una sesión activa en un dispositivo
- **WHEN** inicia sesión desde un segundo dispositivo
- **THEN** ambas sesiones coexisten (no hay flujo "continuar / cerrar la anterior")
- **AND** el flujo interactivo de FA-03 queda registrado como diferido a una
  decisión de sprint posterior

### Requirement: Cierre de sesión desde el frontend
El frontend SHALL (DEBE) ofrecer una opción "Cerrar sesión" en el app shell (US-000A)
que, al activarse, llame a `POST /auth/logout` mediante el SDK generado, **elimine el
access token y la sesión de la memoria** de la SPA (`session.tsx`, sin
`localStorage`/`sessionStorage`) y **redirija al formulario de login**. La opción DEBE
ser accesible y responsive (mobile-first): visible y usable también en el drawer móvil
(`<lg`). (Fuente: `US-002 §Happy Path`; `architecture.md §2.8`; `CLAUDE.md` regla
web responsive.)

#### Scenario: El gestor cierra sesión desde la interfaz
- **GIVEN** un gestor con una sesión activa y el app shell visible
- **WHEN** selecciona la opción "Cerrar sesión"
- **THEN** el frontend llama a `POST /auth/logout`
- **AND** elimina el access token y la sesión de la memoria de la SPA
- **AND** redirige al gestor al formulario de login

#### Scenario: La opción de cerrar sesión es usable en móvil
- **GIVEN** el app shell renderizado en un viewport móvil (`<lg`)
- **WHEN** el gestor abre el drawer de navegación
- **THEN** la opción "Cerrar sesión" es visible y accionable, sin overflow horizontal

### Requirement: Cierre de sesión degradado ante error de red
El frontend SHALL (DEBE) degradar con seguridad ante un **error de red** durante el
logout: cuando la llamada a `POST /auth/logout` falle y el frontend no reciba
confirmación del servidor, DEBE **limpiar igualmente** el access token y la sesión de
memoria, **mostrar un mensaje de aviso** y dejar al gestor sin acceso efectivo en el
cliente. El refresh token en cookie `httpOnly` caducará por
su TTL natural (~7 días) si no llegó a invalidarse en el servidor; este comportamiento
degradado es **aceptable y documentado** en el MVP. (Fuente: `US-002 §Edge case error
de red`.)

#### Scenario: Error de red durante el logout no deja la sesión abierta en el cliente
- **GIVEN** un gestor que selecciona "Cerrar sesión"
- **WHEN** la llamada a `POST /auth/logout` falla por error de red
- **THEN** el frontend limpia el access token y la sesión de memoria igualmente
- **AND** muestra un mensaje de aviso del cierre degradado
- **AND** el gestor queda sin acceso efectivo en el cliente, aunque el refresh token
  pudiera no haberse invalidado en el servidor

### Requirement: Rutas protegidas tras el logout redirigen al login
Tras un cierre de sesión, el frontend SHALL (DEBE) impedir el acceso a cualquier ruta
protegida: un intento de acceso directo por URL (p. ej. el calendario) DEBE redirigir
al formulario de login **sin exponer datos protegidos**, al quedar la sesión vacía y
ser interceptado por el guard `RequireAuth` (US-000A). (Fuente: `US-002 §Happy Path`
2º escenario; `architecture.md §2.8` convención de layouts.)

#### Scenario: Acceso por URL a ruta protegida tras el logout
- **GIVEN** un gestor que ha cerrado sesión (sesión de memoria vacía)
- **WHEN** intenta acceder directamente por URL a una ruta protegida como el calendario
- **THEN** el guard `RequireAuth` redirige al formulario de login
- **AND** no se expone ningún dato protegido

### Requirement: Recuperación de sesión en recarga (F5) desde la cookie de refresh
El frontend SHALL (DEBE), al **arrancar la aplicación** (montaje inicial / recarga
de página), intentar **rehidratar la sesión** a partir de la cookie de refresh
`httpOnly` sin exigir un nuevo login. El `SessionProvider` DEBE partir del estado
transitorio `recovering` cuando no se le inyecta una sesión inicial. Un componente
de arranque sin UI (`AuthBootstrap`) DEBE, al montarse, llamar a `POST /auth/refresh`:
si responde con éxito, DEBE decodificar el payload del access token devuelto (lectura
del JWT, **sin verificación de firma**, que compete al backend) e iniciar la sesión
en memoria; si falla, DEBE dejar la sesión como `unauthenticated`. Mientras el estado
sea `recovering`, `RequireAuth` DEBE mostrar un indicador de carga (spinner) y **no**
redirigir al login; solo redirige cuando el estado resuelve a `unauthenticated`. El
access token recuperado SHALL (DEBE) vivir **solo en memoria** (REQ 10). (Fuente:
petición de usuario Pieza 2; `auth/spec.md` REQ "Renovación de access token vía
refresh", REQ "Rutas protegidas tras el logout"; `US-001 §Edge case refresh token`.)

#### Scenario: F5 con cookie de refresh válida mantiene la sesión
- **GIVEN** un gestor autenticado que recarga la página (F5), perdiéndose el access
  token en memoria, pero con la cookie de refresh `httpOnly` aún válida
- **WHEN** la app arranca y `AuthBootstrap` llama a `POST /auth/refresh`
- **THEN** mientras dura el intento el estado es `recovering` y `RequireAuth` muestra
  un spinner en vez de redirigir al login
- **AND** al recibir el nuevo access token la sesión se rehidrata en memoria y el
  gestor permanece en la ruta protegida, sin volver a introducir credenciales

#### Scenario: F5 sin cookie válida cae a login
- **GIVEN** un gestor cuya cookie de refresh ha expirado o no existe
- **WHEN** la app arranca y `AuthBootstrap` llama a `POST /auth/refresh` y este falla
- **THEN** la sesión queda `unauthenticated`
- **AND** `RequireAuth` redirige al formulario de login

#### Scenario: El token recuperado no se persiste en storage
- **WHEN** se completa la recuperación de sesión en recarga y se inspecciona el navegador
- **THEN** el access token recuperado vive solo en memoria y no aparece en
  `localStorage` ni `sessionStorage`

### Requirement: Aviso de expiración de sesión con countdown y cierre por inactividad
El frontend SHALL (DEBE) avisar al gestor **antes** de que el access token expire y
gestionar el cierre por inactividad, adoptando el patrón de un modal con countdown.
Un hook (`useSessionExpiry`) DEBE decodificar el campo `exp` del access token en
memoria (lectura del JWT, **sin verificar firma**) y programar dos temporizadores:
(a) en `exp − 60 s`, mostrar un **modal de aviso** con un countdown regresivo de
60 s y las acciones "Mantener sesión" y "Cerrar sesión"; (b) en `exp`, si el modal
de aviso sigue abierto sin que el gestor haya reaccionado, **forzar el cierre de
sesión** y mostrar un **modal de sesión cerrada** ("Tu sesión se ha cerrado por
inactividad") con la acción "Iniciar sesión". La acción "Mantener sesión"
(`keepSession`) DEBE renovar el token vía `POST /auth/refresh`, obtener un nuevo
access token y **reprogramar los temporizadores** con el nuevo `exp`. Toda
renovación del access token en memoria (login, refresh transparente del interceptor,
`keepSession`) DEBE notificarse mediante un evento (`slotify:token-refreshed`) para
que el hook **reprograme automáticamente** los temporizadores sin acoplarse al árbol
de React. Los modales SHALL (DEBEN) ser mobile-first y responsive (390 / 768 / 1280),
sin overflow horizontal y con objetivos táctiles accesibles. El `SessionExpiryWatcher`
que consume el hook y renderiza los modales DEBE montarse **dentro del Outlet
autenticado** (bajo `RequireAuth`), de modo que solo opere con sesión activa.
(Fuente: petición de usuario Piezas 3-5; patrón CaixaBank; `CLAUDE.md` regla web
responsive; `auth/spec.md` REQ "Sesión del frontend en memoria".)

#### Scenario: Aviso 60 s antes de expirar con countdown
- **GIVEN** un gestor autenticado cuyo access token expira en menos de 60 s
- **WHEN** el temporizador de aviso alcanza `exp − 60 s`
- **THEN** aparece el modal de aviso con un countdown regresivo desde 60 s
- **AND** ofrece las acciones "Mantener sesión" y "Cerrar sesión"

#### Scenario: Mantener sesión renueva el token y reprograma los avisos
- **GIVEN** el modal de aviso visible con el countdown en curso
- **WHEN** el gestor pulsa "Mantener sesión"
- **THEN** el frontend llama a `POST /auth/refresh`, obtiene un nuevo access token y
  cierra el modal de aviso
- **AND** los temporizadores se reprograman según el nuevo `exp` (vía el evento
  `slotify:token-refreshed`), sin recargar la página

#### Scenario: Inactividad hasta expirar cierra la sesión con modal informativo
- **GIVEN** el modal de aviso visible y el gestor sin reaccionar
- **WHEN** el temporizador alcanza `exp`
- **THEN** el frontend fuerza el cierre de sesión (elimina el token y la sesión de memoria)
- **AND** muestra el modal "Tu sesión se ha cerrado por inactividad" con la acción
  "Iniciar sesión"

#### Scenario: Cualquier renovación del token reprograma los avisos automáticamente
- **GIVEN** un gestor autenticado con los temporizadores de expiración activos
- **WHEN** el access token en memoria se renueva por cualquier vía (login, refresh
  transparente del interceptor tras un 401, o "Mantener sesión")
- **THEN** se despacha el evento `slotify:token-refreshed`
- **AND** el hook reprograma los temporizadores de aviso y de cierre con el nuevo `exp`

#### Scenario: Los modales de sesión son usables en móvil
- **GIVEN** un viewport móvil (`<lg`, p. ej. 390)
- **WHEN** se muestra el modal de aviso o el de sesión cerrada
- **THEN** el modal se renderiza sin overflow horizontal, con el countdown y los
  botones visibles y accionables

