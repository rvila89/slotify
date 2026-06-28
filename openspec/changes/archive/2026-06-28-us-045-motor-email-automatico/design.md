# Design — us-045-motor-email-automatico

> Decisiones técnicas no triviales del motor de email automático (US-045 / UC-35).
> Cada decisión trae **recomendación concreta** para llevar al Gate SDD. Fuentes:
> `US-045`, `architecture.md §2.5–§2.6`, `er-diagram.md`, schema US-000
> (`apps/api/prisma/schema.prisma`), código existente del puerto y del alta.

## Contexto técnico verificado (estado del proyecto)

- **Puerto de dominio existente** `EnviarEmailPort`
  (`apps/api/src/comunicaciones/domain/enviar-email.port.ts`): interfaz pura
  `enviar(comando: { destinatario; asunto; cuerpo; codigoEmail }): Promise<void>`.
  Su test de contrato vive en `enviar-email.port.spec.ts`.
- **Adaptador actual**: `EnviarEmailStubAdapter` (no-op, solo `Logger`), enlazado en
  `ComunicacionesModule` al token `ENVIAR_EMAIL_PORT` y exportado.
- **Consumidor**: `AltaConsultaUseCase`
  (`reservas/application/alta-consulta.use-case.ts`) inyecta el puerto por token,
  crea la `COMUNICACION` E1 dentro de la transacción (estado `enviado`/`borrador`
  según `comentarios`) y, **post-commit**, llama `enviar(...)` solo si es
  auto-envío. Los tests de US-003/004 usan un **doble** del puerto.
- **Config**: `config/env.validation.ts` valida el entorno con `zod`
  (`ConfigModule.forRoot({ validate })`); ya hay `CRON_TOKEN` opcional.

---

## Decisión 1 — Proveedor, configuración/secretos y modo sandbox

**Opciones**: Resend vs Postmark.

**Recomendación: Resend.**

- **Por qué Resend**: SDK TypeScript first-class y minimalista, alta gratuita
  generosa para MVP, envío transaccional con **adjuntos** (base64 / URL) directo,
  y **direcciones de prueba** integradas (`delivered@resend.dev`,
  `bounced@resend.dev`) ideales para QA sin enviar a clientes reales. Encaja con el
  stack del proyecto (`Resend / Postmark` ya citado en `CLAUDE.md` y `US-045
  §Supuestos`). Postmark es igualmente válido pero su DX y onboarding para MVP es
  más pesado; se deja como alternativa si el tenant ya tiene cuenta Postmark.
- **Hexagonal**: el proveedor vive **solo** en infraestructura
  (`comunicaciones/infrastructure/resend.email.adapter.ts`). El dominio sigue
  dependiendo del puerto. Cambiar de Resend a Postmark = nuevo adaptador, sin tocar
  dominio/aplicación.
- **Configuración/secretos** (en `config/env.validation.ts`, zod):
  - `EMAIL_TRANSPORT`: enum `resend | fake`, default `fake` (en `test`/CI siempre
    `fake`; en `production` debe ser `resend`).
  - `RESEND_API_KEY`: requerida **solo** si `EMAIL_TRANSPORT=resend` (validación
    condicional con `superRefine`).
  - `EMAIL_FROM`: remitente verificado (p. ej. `no-reply@<dominio>`).
  - `EMAIL_SANDBOX` (bool, default según `NODE_ENV`): si `true`, el adaptador real
    fuerza destinatario de prueba / no entrega (QA contra Resend sin alcanzar al
    cliente). Secretos **nunca** en repo; van por entorno (Railway/Render).
- **Modo sandbox/fake para CI y QA**: adaptador `FakeEmailAdapter` en memoria que
  **registra** los envíos (para aserciones) y **no hace red**. Se selecciona por
  `EMAIL_TRANSPORT=fake`. Así `pnpm test` y los curl/E2E de QA no envían correos
  reales. El binding del módulo elige el adaptador por config (`useFactory`).

---

## Decisión 2 — Cómo se "detecta el trigger": síncrono vs barrido

**Opciones**: (a) envío **síncrono post-commit** dentro del use-case que provoca el
evento (como hoy E1); (b) patrón **estado-en-fila + barrido periódico** (cron
idempotente, `architecture.md §2.5`).

**Recomendación: síncrono post-commit para los triggers E1–E8, con la fila
`COMUNICACION` actuando como registro de estado (outbox-lite); el barrido/cron se
reserva para los recordatorios programados (diferidos).**

- **Justificación**: los triggers E1–E8 son **reacciones a transiciones de estado
  que ocurren dentro de un use-case** (alta, confirmación, facturación…). El envío
  inmediato post-commit es lo más simple, cumple el criterio de éxito **<30 s** y es
  exactamente el patrón ya validado para E1. La fila `COMUNICACION` (creada en la
  misma transacción del trigger) es el **estado en fila**: deja traza incluso si el
  envío falla (`fallido`) o queda en `borrador`. No hay reintento en MVP, así que no
  se necesita cron para E1–E8.
- **Coherencia con `§2.5`**: el patrón estado-en-fila + barrido del proyecto está
  pensado para **vencimientos temporales** (TTL) y para los **recordatorios
  programados** (`📐 Solo diseñado`). El motor deja el **hook** preparado (la fila
  `COMUNICACION` como cola) para que esos recordatorios futuros usen el barrido sin
  rediseño. Mezclar cron en E1–E8 ahora sería complejidad prematura.
- **Orden transaccional** (preserva el de US-003): la `COMUNICACION` y el
  `AUDIT_LOG` se escriben **dentro** de la transacción del trigger; el **envío real
  ocurre post-commit** (nunca dentro de la tx ni si revierte). Si el proveedor
  falla, se actualiza la fila a `fallido` + `AUDIT_LOG` (operación post-commit
  idempotente).

---

## Decisión 3 — Sistema de plantillas: ubicación, formato, i18n

**Recomendación: catálogo de plantillas en código, tipado, indexado por
`codigo_email` + idioma; i18n por `TENANT_SETTINGS.idioma` (default `es`).**

- **Ubicación**: `comunicaciones/infrastructure/plantillas/` (registro de
  infraestructura). El **dominio** define el puerto `CatalogoPlantillasPort`
  (`seleccionar(codigoEmail, idioma) → { asunto, render(variables) }`) y el
  contrato de variables requeridas por plantilla; la infra implementa el registro.
- **Formato**: funciones de render tipadas (arrow functions) que devuelven
  `{ asunto, cuerpoHtml, cuerpoTexto }` a partir de un objeto de variables tipado.
  **Sin motor de plantillas externo** (evita dependencia nueva); sustitución por
  interpolación tipada. Si más adelante se quiere edición por el tenant, se migra a
  plantillas persistidas sin romper el puerto.
- **i18n**: el idioma se resuelve desde `TENANT_SETTINGS.idioma` (hoy `String`
  default `"es"`). MVP entrega **`es`**; el registro admite más locales (`ca`,
  `en`) como ampliación. Si falta la plantilla en el idioma del tenant, **fallback a
  `es`** y se anota en `AUDIT_LOG`.
- **Cobertura E1–E8**: el registro **declara** E1–E8 (metadatos + variables
  requeridas) pero solo **E1 está activa** (con render real). E2–E8 quedan como
  entradas **diseñadas/inactivas**: sin trigger cableado, su render se completa en
  la US correspondiente. Cada entrada documenta su variable set y sus adjuntos.

---

## Decisión 4 — Idempotencia por `(reserva_id, codigo_email)`

**Recomendación: índice UNIQUE parcial en BD + chequeo en transacción. Requiere
migración.**

- **Constraint**: `CREATE UNIQUE INDEX ... ON comunicacion (reserva_id,
  codigo_email) WHERE reserva_id IS NOT NULL`. Es **parcial** porque `reserva_id` es
  **nullable** (emails `manual` desvinculados de reserva, US-046) y esos no deben
  colisionar entre sí. Garantiza **una** entrada por `(reserva, código E)`.
  Multi-tenancy: `reserva_id` es UUID global, así que `(reserva_id, codigo_email)`
  basta; no hace falta incluir `tenant_id` (la RLS ya aísla las lecturas).
- **Chequeo en transacción**: antes de insertar, el motor consulta si existe la
  `COMUNICACION` para `(reserva_id, codigo_email)`; si existe, **no duplica** (ni
  reenvía). El índice es la **red de seguridad** ante carreras (dos triggers
  simultáneos): la segunda inserción viola el UNIQUE y se trata como "ya existe".
- **Migración**: nueva migración Prisma que añade el `@@index`/índice parcial. En
  Prisma, el índice parcial con `WHERE` se expresa como SQL crudo en la migración
  (Prisma schema no modela `WHERE` parcial directamente); se documenta en
  `schema.prisma` con un comentario y el índice se crea en el `.sql` de la
  migración. (Patrón ya usado en US-040: migración con constraints SQL.)

---

## Decisión 5 — Modelo de datos `COMUNICACION` (confirmación vs US-000)

**Verificado contra `apps/api/prisma/schema.prisma` (modelo `Comunicacion`,
líneas ~526–544).** Campos existentes:

| Campo | Tipo | Notas |
|-------|------|-------|
| `idComunicacion` | uuid PK | ✔ |
| `tenantId` | string | ✔ obligatorio (RLS) |
| `reservaId` | string? | ✔ **nullable** (manual) |
| `clienteId` | string | ✔ obligatorio |
| `codigoEmail` | enum `CodigoEmail` | ✔ `E1..E8 | manual` |
| `asunto` | string | ✔ |
| `cuerpo` | string? `@db.Text` | ✔ |
| `destinatarioEmail` | string | ✔ |
| `estado` | enum `EstadoComunicacion` | ✔ `borrador | enviado | fallido` |
| `fechaEnvio` | DateTime? | ✔ nullable |
| `fechaCreacion` | DateTime | ✔ default now |

**Conclusión**: el modelo `COMUNICACION` **ya soporta** todos los observables de
US-045 (registro enviado/borrador/fallido, `fecha_envio` condicional, vínculos).
Enums `CodigoEmail` y `EstadoComunicacion` están completos. `TENANT_SETTINGS.idioma`
existe (default `"es"`). `AUDIT_LOG` existe y el `AuditLogPort` compartido ya se usa.

**Lo único que falta = migración del índice UNIQUE parcial de la Decisión 4.**

- **Adjuntos**: **no** se añade columna a `COMUNICACION`. Los adjuntos se resuelven
  **por referencia** desde `FACTURA`/`DOCUMENTO`/`PRESUPUESTO` (`pdf_url`) en tiempo
  de envío; el motor define la **interfaz** de adjuntos, pero su origen llega con
  las US de E2/E3/E4. Evita columnas especulativas.
- **`RESERVA.cond_part_enviadas_fecha`** (línea ~293): existe; lo usa E3
  (`reserva_confirmada`), **diferido** a US-021/022/023. No se toca ahora.

---

## Decisión 6 — Regresión: sustituir el STUB sin romper US-003/004

**Recomendación: mantener el puerto `EnviarEmailPort` (contrato estable), sustituir
solo el binding del adaptador, y centralizar render+envío+estado en el motor.**

- **Contrato estable**: `EnviarEmailPort.enviar(...)` se conserva. Se amplía
  `EnviarEmailComando` con campos **opcionales** retro-compatibles
  (`idioma?`, `variables?`, `adjuntos?`, `tenantId?`) para que **los llamadores
  actuales compilen sin cambios** y los tests de US-003/004 (que pasan un doble)
  sigan en verde.
- **Re-binding del módulo**: en `ComunicacionesModule`, `ENVIAR_EMAIL_PORT` pasa de
  `EnviarEmailStubAdapter` a un `useFactory` que elige `ResendEmailAdapter` o
  `FakeEmailAdapter` según `EMAIL_TRANSPORT`. El STUB se conserva como base del Fake
  (o se elimina si el Fake lo cubre). El export del token no cambia.
- **Manejo de fallo post-commit (única lógica nueva en el flujo de alta)**: hoy el
  use-case llama `enviar(...)` post-commit y asume éxito (el STUB nunca falla). Con
  el adaptador real, el envío puede fallar; entonces hay que marcar la
  `COMUNICACION` E1 como `fallido` (sin `fecha_envio`) + `AUDIT_LOG`. Para no
  dispersar lógica, se introduce un **servicio de aplicación `DespacharEmailService`**
  que: renderiza (si procede), invoca el puerto, y **actualiza el estado de la
  `COMUNICACION`** según resultado. El alta delega el post-commit en ese servicio.
  Alternativa más conservadora: envolver el `enviar(...)` actual en try/catch dentro
  del use-case y actualizar la fila — se descarta por dispersar la lógica de M10 en
  `reservas`.
- **Garantía de regresión cero**: los tests existentes de US-003/004 se ejecutan
  primero (baseline verde); el happy path (envío OK → `enviado` + `fecha_envio`) se
  mantiene idéntico; solo se añade el camino de fallo. Cualquier cambio de firma es
  por opcionales. El QA (step-N+1) verifica explícitamente la **no regresión** de
  `alta-consulta.use-case.spec.ts` y `alta-consulta.controller.spec.ts`.

---

## Riesgos y mitigaciones

- **Spec especulativa de E2–E8**: mitigado difiriendo el cableado; el catálogo solo
  declara metadatos, no triggers.
- **Acoplar el motor a `reservas`**: mitigado manteniendo el puerto y un servicio de
  aplicación en `comunicaciones`; `reservas` solo consume el puerto.
- **Envío de correos reales en CI/QA**: mitigado con `EMAIL_TRANSPORT=fake` forzado
  en `test` y direcciones de prueba de Resend en QA.
- **Carreras de doble trigger**: mitigado con índice UNIQUE parcial (Decisión 4).
