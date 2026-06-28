# Code Review — us-045-motor-email-automatico

Veredicto: APTO

- Fecha: 29/06/2026 (re-revisión tras endurecimiento de la deuda Bj3)
- Rama: `feature/us-045-motor-email-automatico` (base `master`)
- Revisor: code-reviewer (solo lectura)
- Alcance de esta pasada: diff del fix Bj3 (config/wiring + tests) sobre el change ya
  APTO. Ficheros: `apps/api/src/config/env.validation.ts`,
  `apps/api/src/comunicaciones/comunicaciones.module.ts`,
  `apps/api/src/config/env.validation.spec.ts`. Se re-pasan los guardrails y se
  reevalúa si Bj3 deja de ser deuda residual.

> NOTA para el hook `require-code-review`: la PRIMERA (y única) línea `Veredicto:` es
> el veredicto FINAL y vale APTO. El historial de pasadas previas se conserva abajo
> para trazabilidad SIN reusar ese marcador.

---

## Resultado de esta re-revisión (fix Bj3)

El endurecimiento de **Bj3** queda **verificado en código** (no por declaración) y
con tests. **Bj3 pasa de deuda residual a RESUELTA.** El resto del veredicto APTO
previo (B1, M1, M2, Bj1 resueltos; Bj2 deuda aceptada; gap de test-design aceptado)
**se sostiene sin cambios**: el fix es acotado a configuración/cableado de transporte y
no toca dominio, contrato ni la máquina de estados.

### Bj3 (Baja → operativa de seguridad) — RESUELTA

El default de `EMAIL_SANDBOX` deja de ser inseguro (antes unset → `false`, envío real)
y pasa a default SEGURO con doble barrera (defensa en profundidad):

1. **Capa de validación de entorno** — `apps/api/src/config/env.validation.ts`:
   `EMAIL_SANDBOX: z.enum(['true','false']).optional().transform((valor) => valor !== 'false')`.
   - unset → `undefined !== 'false'` → **true** (sandbox activo, sin envíos reales).
   - `'true'` → **true**. `'false'` → **false** (único opt-in explícito al envío real).
2. **Capa de cableado del transporte** — `apps/api/src/comunicaciones/comunicaciones.module.ts`
   (`useFactory` de `ENVIAR_EMAIL_PORT`, rama `resend`):
   `const sandbox = !(sandboxRaw === false || sandboxRaw === 'false');`. Trata como
   envío real SOLO el `false`/`'false'` explícito; cualquier otro valor —incluido
   unset y la ambigüedad boolean/string con que `ConfigService` pueda resolver el
   campo— deja el sandbox activo. El comentario justifica la doble cobertura.
3. **Efecto real verificado** en `resend.email.adapter.ts:38-41`: con `sandbox=true`
   el destinatario se reescribe a `delivered@resend.dev`, por lo que el default seguro
   garantiza cero correos al cliente final.

Cobertura nueva en `env.validation.spec.ts` (3 tests, todos verdes):
`debe_activar_sandbox_por_defecto_cuando_EMAIL_SANDBOX_no_esta_seteada` (unset→true),
`debe_mantener_sandbox_activo_con_EMAIL_SANDBOX_true` ('true'→true),
`debe_desactivar_sandbox_solo_con_EMAIL_SANDBOX_false_explicito` ('false'→false).

QA re-ejecutado y reportado: 41 suites / 238 tests verdes (+3 Bj3 respecto a los 235
post-B1), lint y arch (`depcruise` 0 violaciones) limpios; sin envíos reales. Ver
`reports/2026-06-28-step-N+1-unit-test-and-db-verification.md` §"Re-verificación — fix Bj3".

### Guardrails sobre el diff del fix

| Regla | Estado | Nota |
|-------|--------|------|
| Hexagonal: `domain/` sin framework/infra | OK | El cambio vive en `config/` y en el módulo (composition root); `domain/` intacto. `arch` 0 violaciones |
| Secretos/env: validados con zod, sin claves hardcodeadas | OK | `RESEND_API_KEY`/`EMAIL_FROM`/`EMAIL_SANDBOX` desde `ConfigService`; default seguro; nada en el repo |
| Sin Redis/locks distribuidos | N/A | El fix no toca bloqueo de fecha ni concurrencia |
| Multi-tenancy / RLS | N/A | Sin cambios en queries ni tenant |
| Convenciones español + arrow functions | OK | `transform`/`useFactory` en arrow; comentarios y mensajes en español |
| Tipos: TS strict, sin `any` injustificado | OK | `config.get<boolean \| string>('EMAIL_SANDBOX')` tipado explícito; sin `any` |
| Tests primero y pasan | OK | 3 tests Bj3 verdes; suite global 238/238 |

Sin hallazgos nuevos en esta pasada.

### Residuales que se mantienen (no bloqueantes)

- **Bj2** (Baja, deuda aceptada): `crear` (borrador) y `actualizarEstado` sin tx común
  en el flujo del motor; una caída intermedia deja un `borrador` recuperable, nunca un
  `enviado` falso. Outbox-lite, aceptable para MVP.
- **Gap de test-design aceptado**: el camino `fallido` de E1 no es alcanzable por curl
  (`FakeEmailAdapter.forzarFallo` es in-memory); cubierto por unit en alta + motor.
  Documentado en los reports de QA.

---

## Estado consolidado de hallazgos

| Hallazgo | Severidad | Estado |
|----------|-----------|--------|
| B1 — E1 real no manejaba el fallo del proveedor (estado incoherente + 500) | Bloqueante | RESUELTO (pasada anterior) |
| M1 — `find`/`update` de COMUNICACION sin fijar `app.tenant_id` | Media | RESUELTO (pasada anterior) |
| M2 — `EMAIL_TRANSPORT` podía arrancar `fake` en producción | Media | RESUELTO (pasada anterior) |
| Bj1 — conflación `plantilla_no_encontrada` / `variable_nula` | Baja | RESUELTO (pasada anterior) |
| Bj3 — default inseguro de `EMAIL_SANDBOX` | Baja (operativa) | **RESUELTO (esta pasada)** |
| Bj2 — `crear`/`actualizarEstado` sin tx común | Baja | Deuda aceptada (MVP) |
| Gap test-design `fallido` E1 por curl | — | Aceptado y documentado |

---

## Checklist de guardrails (re-pasado, change completo)

| Regla | Estado | Nota |
|-------|--------|------|
| Hexagonal: `domain/` sin `@nestjs`/`@prisma`/infra | OK | `arch` 0 violaciones; puertos solo dependen de dominio |
| Adaptador proveedor solo en infraestructura | OK | `resend.email.adapter.ts`, `fake-email.adapter.ts` aislados |
| Bloqueo de fecha: sin Redis/lock distribuido | OK / N/A | idempotencia por UNIQUE parcial + `P2002`→`ComunicacionDuplicadaError` |
| Multi-tenancy / RLS: tenant del JWT, `SET LOCAL app.tenant_id` | OK | M1 cerrado: `find`/`update`/`crear` fijan `app.tenant_id`; alta propaga `tenantId` |
| Máquina de estados | N/A | change de motor de email; sin transición de reserva nueva |
| Jobs/cron | N/A | envío síncrono post-commit (decisión 2); barrido diferido |
| Secretos: env validado con zod; fake en test/CI; prod⇒resend; sandbox seguro | OK | M2 + Bj3 cerrados; sin claves hardcodeadas |
| Tipos: TS strict, sin `any` injustificado; sin Float en importes | OK | sin importes en el change |
| Contrato OpenAPI / cliente generado | N/A | motor interno, sin endpoint nuevo; cliente no tocado |
| Convenciones español + arrow functions | OK | métodos de clase exentos; factories/transform en arrow |
| Tests primero y pasan | OK | 238/238 verdes; arch + lint limpios |
| Responsive (frontend) | N/A | change backend-only, sin UI |

---

## Historial — primera pasada (resultado: NO APTO, B1 abierto)

> Conservado para trazabilidad. El B1 descrito aquí está RESUELTO (ver arriba). Esta
> sección NO reusa el marcador de veredicto del hook.

**Resultado primera pasada: NO APTO.** B1 — E1 real no manejaba el fallo del proveedor:
la COMUNICACION quedaba `enviado` + 500, contra el spec-delta y la decisión 6 del
Gate 1. El cableado E1 se había hecho solo por re-binding del token (STUB → Fake/Resend)
sin recablear `AltaConsultaUseCase` para delegar en el motor: la fila E1 nacía `enviado`
con `fecha_envio` dentro de la tx y el envío post-commit corría sin try/catch, de modo
que un fallo del proveedor dejaba la fila en estado incoherente y devolvía 500.

**Fix aplicado y verificado en la re-revisión posterior**: el alta crea E1 en
`borrador` dentro de la tx (atomicidad US-003 intacta) y delega el envío post-commit en
`DespacharEmailService.finalizarEnvio`, que centraliza éxito/fallo en `enviarYFinalizar`
(reusado por `despachar`): en fallo → `fallido` sin fecha + AUDIT_LOG, sin reintento, sin
propagar (201). Con cobertura unit nueva en alta y motor. Hallazgos Media/Baja de la
primera pasada (M1, M2, Bj1) → todos cerrados.

---

## Veredicto final

**APTO para merge.** El fix Bj3 cierra la última deuda residual operativa con default
seguro de `EMAIL_SANDBOX` en doble barrera (validación de entorno + cableado), efecto
verificado en el adaptador Resend y cubierto por 3 tests; suite global 238/238 verde,
lint y arch limpios. B1, M1, M2, Bj1 y Bj3 resueltos y verificados en código. Solo
quedan Bj2 (deuda aceptada para el MVP) y el gap de test-design documentado, ninguno
bloqueante. Apto para archivar y abrir PR.
