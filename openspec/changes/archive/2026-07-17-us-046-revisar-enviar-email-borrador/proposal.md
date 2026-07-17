# Change: us-046-revisar-enviar-email-borrador

## Why

**US-046 — Gestor revisa y envía email borrador generado por el sistema** (Área:
Comunicaciones; Módulo M10; UC-36). El Gestor necesita **revisar, editar
opcionalmente y confirmar el envío** de un email que el sistema ha dejado en
`estado = 'borrador'` (E1 con comentarios, US-045), **descartarlo** si no procede, y
**crear y enviar un email manual** desde la ficha de la RESERVA. Resuelve el dolor D1
(comunicación reactiva: el gestor supervisa y personaliza mensajes delicados) y D3
(el sistema pre-rellena el borrador; el gestor solo revisa y confirma), sin perder la
trazabilidad automática del log de comunicaciones. (Fuente: `US-046 §Historia`,
`§Impacto de Negocio`; UC-36.)

US-045 (**motor de email** `DespacharEmailService`, puertos de dominio, enum
`CodigoEmail` incl. `manual`, `EstadoComunicacion = borrador|enviado|fallido`, índice
UNIQUE parcial de idempotencia, columna `es_reenvio`) está **archivada** (capability
`comunicaciones`, spec viva). Esta historia **parte de su estado y reutiliza sus
puertos**: envío por `EnviarEmailPort` a través de los caminos ya centralizados del
motor (`finalizarEnvio` / `enviarYFinalizar` / `despacharReenvio`), `actualizarEstado`
del repositorio y `AuditLogPort`. **No reimplementa** el transporte de email, el
bloqueo atómico de fecha ni la máquina de estados de la RESERVA. Este es un flujo de
**acción manual del gestor**, no un trigger automático del ciclo de vida.

## What Changes

Se añade a la capability **`comunicaciones`** la **primera superficie HTTP del
módulo** (`apps/api/src/comunicaciones/interface/`, hoy vacío salvo `.gitkeep`) para
la gestión manual de comunicaciones de una RESERVA por el Gestor. En síntesis:

- **Listar** las `COMUNICACION` de una RESERVA (sección "Comunicaciones" de la
  ficha), con su `codigo_email`, `estado`, `asunto`, `destinatario_email`,
  `fecha_creacion`, `fecha_envio` y `es_reenvio`. Los `enviado`/`fallido` son de
  **solo lectura**; los `borrador` son accionables (enviar / descartar).
- **Revisar y confirmar el envío** de un borrador: transición
  `estado='borrador' → 'enviado'` con `fecha_envio = now()`, **reutilizando el
  camino de envío del motor** (`EnviarEmailPort` → `actualizarEstado`), con
  **edición opcional** de `asunto` y `cuerpo`. El `asunto`/`cuerpo` **persistido**
  refleja lo **efectivamente enviado** (no la versión original del borrador).
  `codigo_email` y `destinatario_email` **NO** son editables por el gestor.
- **Descartar** un borrador: transición `estado='borrador' → 'fallido'` (no existe
  estado "descartado" en el enum), **sin envío**, con `AUDIT_LOG` de causa
  "descartado por gestor". El borrador desaparece de la bandeja de pendientes.
- **Crear y enviar un email manual** desde la ficha: nueva `COMUNICACION` con
  `codigo_email='manual'`, `estado='enviado'`, `fecha_envio` no nulo, `reserva_id` y
  `cliente_id` correctos, `asunto` y `cuerpo` redactados por el gestor, con
  `AUDIT_LOG`.
- **Reglas de validación / edge cases** (guardas de servidor, no confían en la UI):
  - Solo `estado='borrador'` es enviable/descartable; `enviado` (terminal) y
    `fallido` son de solo lectura (**idempotencia**: no se revierte `enviado` a
    `borrador`, no se duplica el registro).
  - `destinatario_email` (heredado del cliente) / `CLIENTE.email` debe ser **válido
    (RFC 5321) y no nulo ANTES** de intentar el envío: si no lo es, se **bloquea** el
    envío y el borrador **permanece en `borrador`** (no pasa a `fallido`), con un
    mensaje que invita a completar el email del cliente.
  - **Fallo del proveedor** al enviar → `estado='fallido'` **sin** `fecha_envio` +
    `AUDIT_LOG` + mensaje al gestor. **Sin reintento automático** (MVP); el gestor
    puede reintentar manualmente.
  - `tenant_id` del JWT y `cliente_id` de la RESERVA deben coincidir (RLS /
    multi-tenancy); nunca cross-tenant.

### Endpoints propuestos (contrato — lo cierra `contract-engineer` tras el gate)

> Rutas y verbos concretos son **decisión abierta D-2** del `design.md`. Propuesta de
> partida (bajo el prefijo del módulo comunicaciones, ancladas a la RESERVA):

- `GET  /reservas/{id}/comunicaciones` → 200. Lista las `COMUNICACION` de la RESERVA.
- `POST /reservas/{id}/comunicaciones/{idComunicacion}/enviar` → 200. Confirma el
  envío del borrador (body opcional con `asunto`/`cuerpo` editados). 409 si no está
  en `borrador`; 422 si `destinatario_email`/`CLIENTE.email` inválido/nulo (deja en
  `borrador`); **502 si el proveedor falla** (la fila queda persistida en `fallido`;
  Gate 1 D-2).
- `POST /reservas/{id}/comunicaciones/{idComunicacion}/descartar` → 200. Pasa el
  borrador a `fallido` con AUDIT_LOG "descartado por gestor". 409 si no está en
  `borrador`.
- `POST /reservas/{id}/comunicaciones/manual` → 201. Crea y envía un email manual
  (`codigo_email='manual'`).

### Entidades tocadas

- `COMUNICACION`: **actualización de estado** de borradores existentes (enviar /
  descartar) y **nuevas filas** `manual` en cada envío manual. **Sin cambios de
  columnas** (todos los campos ya existen: `asunto`, `cuerpo`, `destinatario_email`,
  `estado`, `fecha_envio`, `es_reenvio`), pero **SÍ una migración de índice** (Gate 1
  D-5, Opción C): se recrea el índice UNIQUE parcial de idempotencia para **excluir
  `codigo_email = 'manual'`**, de modo que un email `manual` lleve `reserva_id` no
  nulo y `es_reenvio = false` (semántica honesta) sin colisionar con otros manuales de
  la misma reserva. E1–E8 conservan su idempotencia intacta.
- `AUDIT_LOG`: `accion='actualizar'`/`'crear'` (entidad `COMUNICACION`) en cada
  envío, descarte y email manual.
- `RESERVA`, `CLIENTE`, `FECHA_BLOQUEADA`: **NO se mutan** (solo lectura del cliente
  destinatario y del contexto de la reserva).

**Migración prevista:** una migración de **índice** (no de columnas), SQL crudo, que
recrea `uq_comunicacion_reserva_codigo` añadiendo `AND codigo_email <> 'manual'` al
predicado parcial (Gate 1 D-5, Opción C). NO destructiva.

### Trazabilidad

- **US**: `US-046` (todos los criterios BDD §Happy Path revisar/editar/enviar,
  §Crear email manual, §Flujos Alternativos —descartar, fallo proveedor, email
  inválido, reenvío duplicado—, §Reglas de Validación).
- **UC**: UC-36 (revisar y enviar borrador; emails salientes; parser LLM y borradores
  de cola **fuera de alcance MVP**).
- **ER**: `er-diagram §3.17 COMUNICACION`, `§CLIENTE`, `§AUDIT_LOG`.
- **Depende de**: US-045 (motor de email, archivada), US-001 (JWT con `tenant_id` y
  `rol`).
- **Reutiliza** de la spec viva `comunicaciones`: "Registro en COMUNICACION con
  estado y fecha coherentes", "Fallo del proveedor sin reintento automático",
  "Bloqueo de envío ante variable/destinatario nulo", "Idempotencia de un email por
  reserva y código".

## Impact

- Specs afectadas: `openspec/specs/comunicaciones/spec.md` (ADDED: listado de
  comunicaciones de una reserva; confirmación de envío del borrador con edición
  opcional; descarte a `fallido`; email manual; guardas de estado/destinatario/
  idempotencia/tenant de la acción manual del gestor).
- Código (post-gate, fuera de este SDD): capability `comunicaciones` — **primer
  controller e interface** del módulo, DTOs, use-case(s) de aplicación de la acción
  manual, método de repositorio de **listado por reserva**, validador de email;
  reutilizando el motor/puertos de US-045.
- Frontend: sección "Comunicaciones" en la ficha de la RESERVA (listar, revisar/
  editar/enviar borrador, descartar, nuevo email manual) → E2E aplica.
- **Decisiones que requieren visto bueno humano** (ver `design.md`): (D-1) use-case
  dedicado vs. reutilizar `finalizarEnvio`/`despacharReenvio`; (D-2) rutas REST
  concretas; (D-3) nuevo método de listado en el repositorio; (D-4) dónde vive la
  validación de email; (D-5) `descartar` vía `actualizarEstado` a `fallido` y el
  `reserva_id` del email `manual` frente al índice parcial de idempotencia.
