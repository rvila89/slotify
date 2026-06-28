# Code Review — US-001 "Iniciar Sesión"

- Fecha: 2026-06-27
- Revisor: code-reviewer (harness Slotify)
- Rama: `feature/us-001-iniciar-sesion`
- Alcance: diff completo de la rama vs `master` (trabajo en working tree; HEAD==master)
- Skills aplicadas: `review-checklist`, `architecture-guardrails`
- Modo: SOLO LECTURA (no se modificó código ni tests)

## Resumen

Implementación de login/refresh/logout/me con arquitectura hexagonal limpia,
anti-enumeration correcto, sesión en memoria sin storage, contrato y cliente
generado coherentes y E2E real sin mocks. No se detectan Bloqueantes ni Mayores.
Dos Notas y una observación Menor, todas no bloqueantes.

## Validación punto por punto (encargo)

1. **Fix del controller (`auth.controller.ts`)** — CORRECTO.
   - `login()` y `refresh()` envueltos en `try/catch`; `CredencialesInvalidasError`
     se traduce a `UnauthorizedException('Credenciales incorrectas')` (401) en la
     CAPA INTERFACE (no en dominio). El dominio (`login.use-case.ts`) lanza un único
     `CredencialesInvalidasError` para email inexistente, contraseña incorrecta y
     `activo=false` (anti-enumeration OWASP A01), sin auditar el intento fallido ni
     revelar la causa (no se llama a `auditoria.registrar` en los caminos de fallo).
   - `@HttpCode(HttpStatus.OK)` presente en `login` y `refresh`.
   - Cuerpo 401 idéntico para credenciales inválidas y cuenta inactiva (mismo status
     y mensaje genérico). Verificado en `auth.controller.http.spec.ts` (compara el
     envelope estable byte a byte).

2. **Fix del refresh-interceptor (`refresh-interceptor.ts`)** — CORRECTO.
   - Guard `request?.url?.includes('/auth/refresh')` corta la recursión: un 401 del
     propio `/auth/refresh` retorna sin reintentar; el error se propaga y la limpieza
     de sesión la dispara el intento original. Sin doble `onSesionExpirada`.
   - Cubierto por `refresh-interceptor.recursion.test.ts` (0 reintentos cuando el 401
     es del refresh; exactamente 1 `refrescar()` y 1 `onSesionExpirada()` en el ciclo).

3. **Throttler 429 self-contained (ACEPTADO)** — CORRECTO y seguro.
   - `LoginThrottleGuard` con `Map` en memoria del proceso, clave `IP+email`
     normalizada, ventana 5 intentos / 60 s (`auth.throttle.ts`). No usa Redis ni
     locks distribuidos. No enumera usuarios: el 429 es genérico e independiente de
     si el email existe. Adecuado para el MVP. (No se exige migrar a `@nestjs/throttler`.)

4. **Cookie `refresh_token`** — CORRECTO.
   - `httpOnly: true`, `secure`/`sameSite` condicionados a producción
     (`secure=true` + `sameSite='none'` en prod; `lax` en dev), `path: '/api/auth'`,
     `maxAge ~7d`. Gestionada íntegramente en el controlador (capa framework): set en
     login, clear en logout y ante refresh inválido. El dominio no la toca.

5. **`AuditLogPort` extraído a `shared/audit`** — CORRECTO, hexagonal limpio.
   - Puerto compartido genérico `AuditLogPort<R extends RegistroAuditoria>` en
     `shared/audit/audit-log.port.ts` (interfaz pura, sin `@nestjs`/Prisma).
   - `reservas/domain/liberar-fecha.service.ts` reusa el puerto: `RegistroAuditoriaLiberacion
     extends RegistroAuditoria` y `auditoria: AuditLogPort<RegistroAuditoriaLiberacion>`,
     con re-export para no romper consumidores. Sin duplicar la interfaz.
   - Reservas conserva su adaptador especializado; `auth` usa el adaptador genérico
     `shared/audit/audit-log.prisma.adapter.ts`. US-040/US-041 no se rompen (tipos
     estrechados, no cambios de comportamiento).

6. **Puertos en `application/*.use-case.ts`** — CORRECTO, inversión mantenida.
   - Los puertos (`UsuarioRepositoryPort`, `PasswordHasherPort`, `TokenEmitterPort`)
     y el error de dominio viven en la capa application (pura): no importan `@nestjs/*`,
     Prisma ni `infrastructure/`. La infraestructura (`infrastructure/*.adapter.ts`) los
     implementa y `auth.module.ts` los enlaza por Symbol vía factory. DI hexagonal OK.

7. **Sesión frontend en memoria** — CORRECTO.
   - `accessTokenEnMemoria` a nivel de módulo; `iniciarSesion`/`cerrarSesion` solo mutan
     memoria. Grep confirma que NO hay escritura en `localStorage`/`sessionStorage` en
     código de producción (solo comentarios y aserciones de tests que verifican la
     ausencia). Refresh en cookie httpOnly, nunca leído desde JS.

8. **Cliente generado intacto + contrato coherente** — CORRECTO.
   - `schema.d.ts` y `client.ts` conservan la cabecera "GENERADO… NO EDITAR A MANO".
     El diff de `schema.d.ts` (401 inline anti-enumeration + `429 TooManyRequests`)
     corresponde exactamente a los cambios de `docs/api-spec.yml`: coherente con
     regeneración, sin señales de edición manual. `client.ts` mantiene
     `credentials: 'include'`. DTO `LoginDto` validado con `class-validator` y alineado
     con `LoginRequest`.

9. **E2E nuevo** — CORRECTO, sin workarounds que enmascaren bugs.
   - `e2e/login.spec.ts` + `playwright.config.ts` levantan API+SPA reales
     (`reuseExistingServer`), credenciales seed reales, sin mocks de red salvo el caso
     de validación cliente (donde `route.abort()` se usa legítimamente para AFIRMAR que
     la API NO se invoca). Tres escenarios: login OK, credenciales inválidas (aserción
     anti-enumeración explícita), validación cliente.

## Guardrails

- Hexagonal: domain/application sin imports de framework/infra. OK.
- Bloqueo atómico: sin Redis/Redlock/locks distribuidos (grep solo en comentarios). OK.
- Multi-tenancy/RLS: `buscarPorEmail` es pre-auth (email único global, documentado);
  `/auth/me` filtra por `tenant_id` del JWT y fija contexto RLS (`fijarTenant`) dentro
  de la transacción. Tenant nunca tomado de path/body. OK.
- Arrow functions: grep no encuentra `function` declarativo en los ficheros nuevos. OK.
- Errores y mensajes en español; convenciones de nombres correctas. OK.
- Importes `Decimal`: no aplica a esta US (sin importes monetarios).

## Hallazgos

### Bloqueante
- (ninguno)

### Mayor
- (ninguno)

### Menor
- **[robustez/observabilidad] `catch` amplio en el controller**
  (`apps/api/src/auth/interface/auth.controller.ts:109` y `:128`). El `catch {}`
  traduce CUALQUIER excepción a 401, no solo `CredencialesInvalidasError` /
  `RefreshInvalidoError`. Un fallo de infraestructura (BD caída, error de Prisma o
  del puerto de auditoría) se enmascararía como "Credenciales incorrectas" (401) en
  lugar de 500, perjudicando el diagnóstico y dando feedback engañoso al usuario
  durante una incidencia. Recomendación: estrechar el `catch` a los errores de
  dominio esperados (`instanceof CredencialesInvalidasError` / `RefreshInvalidoError`)
  y re-lanzar el resto para que el `HttpExceptionFilter` produzca el 500 real.
  No bloqueante: el comportamiento anti-enumeration de los casos legítimos es correcto.

### Nota
- **[doc/contrato] Comentario desactualizado en `docs/api-spec.yml`**
  (respuesta `TooManyRequests`): menciona "Rate-limiting con @nestjs/throttler", pero
  la implementación aceptada es un guard self-contained en memoria. Alinear el
  comentario para evitar confusión (la decisión §3-A ya es la fuente de verdad).
- **[escalabilidad] Throttle en memoria por proceso**
  (`login-throttle.guard.ts`): el contador no se comparte entre instancias y se
  reinicia al rearrancar. Aceptado y documentado para el MVP; revisar si se despliega
  multi-instancia.

## Conclusión

Desarrollo y QA en verde (api 130/130, web 31/31, E2E 3/3, depcruise/lint/typecheck
OK). El diff respeta todos los guardrails duros y resuelve correctamente los dos
fixes de QA. No hay Bloqueantes ni Mayores; los hallazgos Menor/Nota son mejoras
no bloqueantes.

Veredicto: APTO
