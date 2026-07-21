# Spec Delta — Capability `auth`

> Amplía la conducta de **gestión de sesión en el frontend** (`apps/web`) sin tocar
> backend, contrato ni tokens: (1) el interceptor de refresh reintenta la petición
> original tras renovar (adiós al banner de error en 401), (2) la sesión se
> recupera en recarga (F5) desde la cookie de refresh, y (3) el gestor recibe un
> aviso de expiración con countdown 60 s. Regla dura conservada: el access token
> vive SOLO en memoria (REQ 10). Fuente: petición de usuario (Enfoque A: hook +
> modal); `auth/spec.md` REQ "Sesión del frontend en memoria",
> "Renovación de access token vía refresh"; `US-001`; `US-002`; patrón CaixaBank.

## MODIFIED Requirements

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

## ADDED Requirements

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
