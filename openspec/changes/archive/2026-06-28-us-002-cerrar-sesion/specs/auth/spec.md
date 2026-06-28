# Spec Delta — Capability `auth`

> US-002 cierra el ciclo de vida de la sesión iniciada en US-001: endurece el
> logout (auditoría, idempotencia, no-anonimato) y cablea el cierre de sesión del
> frontend. No pertenece a M1–M12 de negocio; es capa transversal de infraestructura
> (`SlotifyGeneralSpecs §3.1`).
> Fuente: US-002, UC-02, `architecture.md §2.8`, `er-diagram §3.17`, `data-model.md §3.17`.

## MODIFIED Requirements

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

## ADDED Requirements

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
