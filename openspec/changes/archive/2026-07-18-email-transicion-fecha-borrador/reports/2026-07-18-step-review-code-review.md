# Informe de Code-Review — change `email-transicion-fecha-borrador`

- Fecha: 2026-07-18
- Rama: `feature/email-transicion-fecha-borrador` (base `master`)
- Alcance revisado: working tree (tracked + nuevos) del worktree `slotify-email-transicion`.
- Herramientas en solo lectura: `git diff`, `tsc --noEmit` (EXIT 0), `eslint` sobre los 10 ficheros del change (EXIT 0).
- Tests de integración/concurrencia: NO ejecutados aquí (requieren Postgres); la sesión principal los reporta en verde 49/49.

## Resumen del cambio
El correo E1 de la transición de fecha deja de auto-enviarse con texto hardcodeado y pasa a
crear un BORRADOR con redacción dinámica en la MISMA transacción, en ambas ramas (2.b libre
y 2.d cola), para revisión/envío manual del gestor (flujo US-046). Se extrae un módulo puro
de render (`plantilla-transicion-fecha.ts`), un helper de fecha compartido
(`formato-fecha.ts`) y se elimina por completo el puerto/adaptador/wiring de
`ConfirmacionBloqueoEmailPort`.

## Bloqueantes
- Ninguno.

## Advertencias
- Ninguna que impida el merge.

## Observaciones (Baja / informativas)
- [idempotencia] `ComunicacionTransicionPrismaRepository.crear` implementa el upsert manual
  (`findFirst` por `(tenantId, reservaId, codigoEmail='E1')` + `create`/`update`) porque el
  índice `uq_comunicacion_reserva_codigo` es PARCIAL y Prisma no lo modela como `@@unique`.
  Correcto para no violar la UNIQUE parcial. Está documentado en el docblock que el único
  escritor de la E1 en este camino es la propia transición (RESERVA bloqueada por la vía 2.b),
  así que no dispara el retry de re-derivación a cola de la UoW. Nota informativa: la clave
  de búsqueda incluye `tenantId`, coherente con multi-tenancy.
- [dominio-vs-infra] `plantilla-transicion-fecha.ts` vive en `application/` e importa el
  helper desde `comunicaciones/infrastructure/plantillas/formato-fecha.ts`. No viola el
  guardrail hexagonal (la regla dura prohíbe imports de framework/infra en `domain/`, y este
  módulo está en `application/`, no en `domain/`; además `formato-fecha.ts` es una función
  pura sin `@nestjs/*`/`@prisma/*`). Es coherente con el patrón ya existente en el repo
  (reuso del formateo del catálogo US-045). Deuda futura ya anotada en el propio código:
  firma "Ari — Masia l'Encís" hardcodeada (parametrizar por tenant).

## Checklist verificado (OK)
- **Hexagonal/DDD**: `plantilla-transicion-fecha.ts` y `formato-fecha.ts` son PUROS — sin
  `@nestjs/*` ni `@prisma/*`. `transicion-fecha.use-case.ts` sigue dependiendo solo de
  puertos inyectados. El adapter Prisma mapea correctamente enum `DuracionHoras`
  (`h4/h8/h12`) → número vía `duracionHorasPrismaANumero` (reusa el mapper existente, evita
  el `NaN` de `Number('h4')`).
- **Arrow functions (func-style ESLint)**: todo lo nuevo usa arrow functions
  (`renderMensajeTransicionFecha`, `renderDisponibleCA/ES`, `renderColaCA/ES`,
  `valorOplaceholder`, `formatarFechaCA/ES`). `eslint` pasa EXIT 0.
- **Sin código muerto / imports huérfanos**: limpieza COMPLETA de
  `ConfirmacionBloqueoEmailPort` — se elimina la interfaz y los tipos
  `EnviarConfirmacionBloqueoParams/Resultado`, el adaptador
  `confirmacion-bloqueo-email.adapter.ts`, el token `CONFIRMACION_BLOQUEO_EMAIL_PORT`, el
  provider/inject/useFactory en `reservas.module.ts`, el campo `emailPendiente` y el método
  `enviarConfirmacionTolerante`, y las constantes `ASUNTO/CUERPO_CONFIRMACION_BLOQUEO`. El
  tipo `ComunicacionTransicion` SÍ sigue en uso (return de `crear`), no es huérfano. `tsc`
  EXIT 0 confirma que no quedan referencias colgantes.
- **Bloqueo atómico**: la COMUNICACION (borrador) nace DENTRO de la UoW (misma tx) en ambas
  ramas; la rama libre sigue usando `bloquearEnTx` (UNIQUE + FOR UPDATE de US-040), la cola
  serializa `MAX+1` sin nuevo bloqueo. No se introdujo Redis ni ningún lock distribuido.
- **Idempotencia (rama cola y libre)**: upsert por `(reserva_id, codigo_email='E1')`, no
  rompe la UNIQUE parcial (ver Observaciones).
- **Multi-tenancy/RLS**: la lectura ampliada (`cliente { nombre, email }` + `idioma`,
  `num_invitados_final`, `duracion_horas`) sigue bajo el `tx` de la UoW con
  `where { idReserva, tenantId }`; el `tenantId` procede del comando (JWT), no del body.
- **Fidelidad de contenido**: asunto/cuerpo, idioma (`ca` → catalán; resto → castellano
  incl. texto y mes), placeholder `___` para personas/horas nulos (solo "disponible"), firma
  hardcodeada y "40 %" fijo — todo conforme a la spec-delta y cubierto por
  `plantilla-transicion-fecha.spec.ts`.
- **Tests primero (TDD)**: existe test hermano nuevo del módulo puro y se reescribieron los
  specs de use-case e integración con las nuevas expectativas (borrador sin envío, cola con
  borrador, no-encolable sin comunicación). Sesión principal: 49/49 verde.
- **Contrato/SDK/Front**: NO tocados (diffstat 100% backend `apps/api` + tests; sin cambios
  en `docs/api-spec.yml`, SDK ni `apps/web`).
- **Convenciones (español, kebab/camel/Pascal)**: nombres, comentarios y textos en español;
  ficheros kebab-case; clases PascalCase.
- **Responsive (frontend)**: N/A — el change no toca UI.

Veredicto: APTO
