# Change: us-003-alta-consulta-exploratoria

## Why

US-003 es la **primera historia que materializa el agregado raíz RESERVA** como
entidad de negocio (hasta ahora el módulo `reservas` solo cubría el mecanismo de
bloqueo/liberación de fecha — US-040/US-041 — sin crear RESERVAs). Entrega el alta
manual de un **lead exploratorio sin fecha de evento** y la respuesta automática
inicial (email E1), resolviendo **D1** (fuente única de verdad), **D2**
(visibilidad del pipeline) y **D9** (automatización de la respuesta inicial),
eliminando la dispersión en Gmail/WhatsApp/Sheets. (Fuente: `US-003 §Historia`,
`§Contexto de Negocio`, UC-03.)

El scaffolding ya está listo para esta US, **no se recrea**:

- Prisma (US-000): modelos `Reserva`, `Cliente`, `Comunicacion`, `AuditLog`,
  `TenantSettings` **completos**, con enums `EstadoReserva`, `SubEstadoConsulta`
  (`s2a`…`s2z`), `CanalEntrada` (`web|email|whatsapp|instagram|telefono`),
  `CodigoEmail` (`E1`…`E8|manual`), `EstadoComunicacion`
  (`borrador|enviado|fallido`), `AccionAudit` (incluye `crear`). RLS activo en
  todas las tablas de negocio (`ENABLE ROW LEVEL SECURITY` + policy
  `tenant_isolation`). **No requiere migración** (ver `design.md §2`).
- Backend: módulos `clientes` y `comunicaciones` son **esqueletos hexagonales
  vacíos** (`@Module({})`), esperando esta US. `PrismaService.fijarTenant(tx,
  tenantId)` ya implementa el contexto RLS (`SET LOCAL app.tenant_id`). Existe el
  puerto compartido `AuditLogPort` (`shared/audit/audit-log.port.ts`) y su adapter
  Prisma, ya usados por `auth` y `reservas`.
- Contrato OpenAPI (`docs/api-spec.yml`): ya define en borrador `POST /reservas`
  (UC-03, "alta de lead/consulta", 2.a/2.b) con `CreateReservaRequest`. Este change
  **no edita** el contrato (ver `Impact` y `design.md §1`).

(Fuente: scaffolding US-000; `er-diagram.md §3.4, §3.6, §3.17`; `data-model.md`;
`architecture.md`.)

## What Changes

> Alcance propuesto: **slice vertical** (backend + contrato + frontend de "Nueva
> consulta"). Sujeto al **Gate de revisión humana SDD** (decisiones en `design.md`).

- **Alta de consulta exploratoria sin fecha** (`POST /reservas`, autenticado):
  crea **una única entidad RESERVA** con `estado = 'consulta'`,
  `sub_estado = '2a'` (Prisma `s2a`), `ttl_expiracion = NULL`, vinculada a un
  CLIENTE del tenant. **No** crea fila en `FECHA_BLOQUEADA` (la consulta es una
  **fase** de la RESERVA, no entidad aparte). (Fuente: `US-003 §Happy Path`,
  `§Reglas de Validación`.)
- **Creación idempotente de CLIENTE** por `(tenant_id, email)`: si ya existe un
  cliente con ese email en el tenant se reutiliza; si no, se crea. (Fuente:
  `US-003 §Supuestos`; `design.md §4`.)
- **Campos obligatorios** validados en cliente y servidor: `nombre`, `apellidos`,
  `email` (RFC 5322 básico), `telefono`, `canal_entrada` (ENUM). Opcionales (nº
  invitados, horas, tipo evento) se almacenan; **sin fecha no se calcula tarifa**
  (no se invoca UC-16). (Fuente: `US-003 §Reglas de Validación`, FA tarifa.)
- **Email E1 (respuesta inicial automática)**: si **no** hay `comentarios` →
  se crea `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'enviado'` y se
  dispara el envío vía un **puerto de email** (`EnviarEmailPort`); si **hay**
  `comentarios` → `COMUNICACION` con `estado = 'borrador'`, **sin** enviar, y la UI
  alerta al gestor de un borrador pendiente. El transporte real de email se
  **difiere a US-045** mediante un adaptador stub (ver `design.md §1`). (Fuente:
  `US-003 §Happy Path`, `§FA Lead con comentarios`.)
- **Auditoría**: todo alto exitoso escribe `AUDIT_LOG` con `accion = 'crear'`,
  `entidad = 'RESERVA'`, `usuario_id` del gestor y los datos de la nueva RESERVA en
  `datos_nuevos`, vía el `AuditLogPort` compartido. (Fuente: `US-003 §Happy Path`
  3.er escenario; `design.md §1` para la capitalización de `entidad`.)
- **Atomicidad y RLS**: CLIENTE + RESERVA + COMUNICACION + AUDIT_LOG se crean en
  **una transacción** con `fijarTenant(tx, tenantId)`; ante validación fallida
  **no se crea NADA**. (Fuente: `US-003 §FA-03`; `design.md §4`.)
- **Frontend "Nueva consulta"**: formulario (TanStack Form + SDK generado) con
  validación por campo (obligatorios, email, selector de `canal_entrada`), submit
  bloqueado si hay errores, y alerta de "borrador E1 pendiente" cuando aplica.
  (Fuente: `US-003 §Criterios de Aceptación`.)

## Impact

- Specs afectadas: **nueva capability `consultas`** (alta y gestión de leads /
  fase de consulta de la RESERVA; UC-03). No modifica `auth`, `app-shell`,
  `bloqueo-fecha`, `calculo-tarifa` ni `foundation`.
- Contrato OpenAPI (`docs/api-spec.yml`): **ya existe** `POST /reservas` con
  `CreateReservaRequest` (UC-03). Este change **no edita** el contrato; lo evolución
  el `contract-engineer` tras el gate. **Gap detectado**: falta el campo
  `comentarios` (decide E1 `enviado` vs `borrador`) — hoy solo hay `notas`; y
  conviene fijar requireds de contacto (`telefono`, `email`) en
  `CreateClienteRequest` y el cuerpo de error de validación (422). (Ver `design.md
  §1` y `§5`.)
- Código afectado (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**` (alta de
  consulta), `apps/api/src/clientes/**` (find-or-create), `apps/api/src/
  comunicaciones/**` (puerto + stub de email, persistencia de COMUNICACION);
  `apps/web/src/**` (página/formulario "Nueva consulta", hook de mutación).
- Trazabilidad: **US-003**, **UC-03**; entidades `RESERVA`, `CLIENTE`,
  `COMUNICACION`, `AUDIT_LOG`, `TENANT_SETTINGS`; automatización **A1**, email
  **E1**.
- Dependencias: **US-001** (sesión activa; ya hecha). **No** depende de US-002
  (logout, en PR #19 sin mergear) ni de bloqueo de fecha/cola. **US-045** (infra de
  email automático E1–E8) **depende de esta** y va después: aquí solo se persiste
  la COMUNICACION y se difiere el transporte real.

## Lo que NO entra (anti-scope)

- **Infra real de envío de email (US-045)**: integración Resend/Postmark,
  plantillas E1–E8, reintentos, colas, webhooks de entrega. Aquí el envío se
  resuelve con un **stub** del puerto que marca la COMUNICACION como `enviado` sin
  red. (Fuente: `US-003 §Email relacionado`; orden de backlog: US-045 después.)
- **Consulta con fecha (sub-estado 2.b) y bloqueo blando**: es US-004/US-005.
  `fecha_evento` está ausente en este flujo. (Fuente: `US-003 §Reglas de Validación`.)
- **Cálculo de tarifa (UC-16)**: sin fecha no se determina temporada; los opcionales
  se almacenan sin calcular importe. (Fuente: `US-003 §FA tarifa`.)
- **Detección automática de cliente recurrente y vínculo `consulta_vinculo`**:
  `📐 Solo diseñado` en MVP, no se implementa. (Fuente: `US-003 §Notas de alcance`.)
- **Máquina de estados completa (16+ transiciones)**: este change solo cubre la
  **entrada inicial** (creación → `consulta`/`2a`); el resto se modela en US
  posteriores. (Ver `design.md §3`.)
- **Envío manual del borrador E1**: el flujo de revisar/editar/confirmar el envío
  del borrador por el gestor se aborda con la infra de US-045; aquí solo se crea el
  borrador y la alerta UI.

## Decisiones de alcance pendientes de aprobación humana

Las 4 decisiones de diseño (email E1 vs US-045; modelo de datos / migración;
máquina de estados; multi-tenancy + idempotencia de CLIENTE) están **razonadas con
recomendación** en `design.md`. Quedan **abiertas hasta el OK del Gate SDD**.
