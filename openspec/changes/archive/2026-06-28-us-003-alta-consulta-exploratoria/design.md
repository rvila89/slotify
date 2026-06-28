# Design — us-003-alta-consulta-exploratoria

> Decisiones técnicas no triviales de US-003. Cada una lleva **recomendación
> argumentada** pero queda **abierta hasta el OK del Gate SDD**. Verificadas contra
> el código actual (rama `master`).

## Contexto verificado en el código

- **Schema Prisma** (`apps/api/prisma/schema.prisma`, migración `20260619190625_init`):
  `Reserva`, `Cliente`, `Comunicacion`, `AuditLog`, `TenantSettings` ya existen con
  todos los campos necesarios. Enums presentes: `EstadoReserva` (incluye `consulta`),
  `SubEstadoConsulta` (`s2a`…`s2z`), `CanalEntrada`, `CodigoEmail` (incluye `E1`),
  `EstadoComunicacion` (`borrador|enviado|fallido`), `AccionAudit` (incluye `crear`).
- **RLS**: `init` ejecuta `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY
  tenant_isolation` en `cliente`, `reserva`, `comunicacion`, `audit_log` (y resto de
  tablas de negocio). `PrismaService.fijarTenant(tx, tenantId)` fija
  `SELECT set_config('app.tenant_id', $1, true)` (SET LOCAL) dentro de un
  `$transaction`.
- **Auditoría**: existe el puerto compartido `AuditLogPort` /
  `RegistroAuditoria` (`apps/api/src/shared/audit/audit-log.port.ts`) y su adapter
  Prisma. Ya lo usan `auth` y `reservas`.
- **Email/COMUNICACION**: el módulo `comunicaciones`
  (`apps/api/src/comunicaciones/comunicaciones.module.ts`) es un **esqueleto vacío**
  (`@Module({})`). **No existe** ningún puerto/adaptador de email ni integración
  Resend/Postmark en el backend.
- **Máquina de estados**: **no existe** una estructura declarativa de transiciones.
  El único artefacto relacionado es
  `reservas/infrastructure/reserva-estado.prisma.adapter.ts`, un adaptador de
  **lectura pura** (`obtenerEstado`) creado en US-041 para la guarda de liberación.
- **Contrato OpenAPI** (`docs/api-spec.yml`): ya existe `POST /reservas` (tag
  Reservas, summary "Dar de alta un nuevo lead/consulta (UC-03)") con
  `CreateReservaRequest`. **Falta** el campo `comentarios`.

---

## §1 — Email E1: encaje con US-045 (infra de email) sin sobre-construir

**Problema**: el BDD exige persistir COMUNICACION (E1) con `estado = 'enviado'`
(sin comentarios) o `'borrador'` (con comentarios) y, en el primer caso, "enviar"
el email. Pero la infra real de envío (Resend/Postmark, plantillas E1–E8,
reintentos) es **US-045**, posterior. No existe puerto/adaptador de email hoy.

- **Opción A (recomendada): puerto de dominio mínimo + adaptador stub; persistir
  siempre la COMUNICACION.**
  - Definir `EnviarEmailPort` (interfaz pura en `domain/`, sin `@nestjs/*` ni
    Prisma) con una operación mínima `enviar({ destinatario, asunto, cuerpo,
    codigoEmail })`.
  - La **lógica E1 (auto-envío vs borrador según `comentarios`) vive en la
    aplicación/dominio de US-003** y es completa: sin comentarios → persistir
    COMUNICACION `estado='enviado'`, `fecha_envio=now` e invocar el puerto; con
    comentarios → persistir `estado='borrador'` y **no** invocar el puerto.
  - El **adaptador** del puerto en `infrastructure/` es un **stub/no-op** que no
    hace red (registra/loggea y retorna éxito). US-045 sustituye ese adaptador por
    el real (Resend/Postmark) **sin tocar el dominio** (puerto estable).
- **Opción B**: persistir solo la fila COMUNICACION y no definir puerto todavía
  (diferir todo el envío a US-045). Más simple, pero deja la "intención de envío"
  implícita y obliga a US-045 a reescribir la decisión de invocación.
- **Opción C**: implementar ya el puerto + adaptador real de email. Sobre-construye
  US-045 (queda fuera de alcance).

**Recomendación: A.** Es la mínima que cumple el BDD respetando hexagonal: el
contrato de envío (puerto) queda fijado y testeable con un doble; el transporte
real se enchufa en US-045 cambiando solo el adaptador. El observable del BDD en
US-003 es la **fila COMUNICACION** con el `estado` correcto, que A garantiza.
**Anti-scope**: nada de plantillas, reintentos, webhooks ni config de proveedor.

---

## §2 — Modelo de datos: ¿migración? **NO**

Verificado campo a campo contra `schema.prisma` + `init`:

- `Reserva`: tiene `estado`, `subEstado` (`SubEstadoConsulta?`), `canalEntrada`,
  `ttlExpiracion?`, `clienteId`, `tenantId`, `codigo` (unique), y los opcionales
  `duracionHoras?`, `tipoEvento?`, `numAdultosNinosMayores4?`, `numNinosMenores4?`.
  Cubre el alta en 2.a por completo.
- `Cliente`: `tenantId`, `nombre`, `apellidos?`, `email?`, `telefono?` +
  `@@index([tenantId, email])`. Suficiente para crear/buscar.
- `Comunicacion`: `tenantId`, `reservaId?`, `clienteId`, `codigoEmail`, `asunto`,
  `cuerpo?`, `destinatarioEmail`, `estado`, `fechaEnvio?`. Cubre E1.
- `AuditLog`: `entidad` (String libre), `entidadId`, `accion` (`AccionAudit`),
  `datosNuevos` (Json). Cubre la auditoría.

**Conclusión: US-003 NO requiere ninguna migración de schema.** Dos matices, **sin
cambio de schema**:

1. **`sub_estado` `2a` ↔ Prisma `s2a`**: el enum `SubEstadoConsulta` NO tiene
   `@map`, así que el literal en BD/Prisma es `s2a` (un identificador TS no puede
   empezar por dígito). El valor de dominio `'2a'` del BDD debe **mapearse** a
   `s2a` en la capa de infraestructura (helper de mapeo dominio↔Prisma). Es código,
   no migración.
2. **Idempotencia de CLIENTE**: hoy hay **índice** `(tenant_id, email)` pero **no**
   restricción `UNIQUE`. Esto condiciona la §4 (upsert vs find-or-create); la
   recomendación de §4 **no** exige migración.

---

## §3 — Máquina de estados: entrada inicial, estructura mínima

**Estado actual**: no existe estructura declarativa de transiciones; solo el
adapter de lectura `reserva-estado.prisma.adapter.ts` (US-041). El alta de US-003 es
la **transición de creación** (entrada al agregado): `∅ → consulta / 2a`, no una
transición entre dos estados existentes.

- **Opción A (recomendada): introducir una estructura declarativa MÍNIMA** que
  modele los estados/sub-estados como datos y la **regla de entrada** (creación →
  `consulta`/`2a` con `ttl_expiracion = NULL`), diseñada para extenderse por las US
  siguientes (US-004/US-005…). Confirma la skill `state-machine` (transiciones como
  estructura de datos, no código disperso) sin construir las 16+ transiciones ahora.
- **Opción B**: codificar la entrada inicial "a pelo" en el use-case sin estructura
  declarativa, y crear la máquina completa cuando llegue la primera transición real
  (US-005). Menos arquitectura ahora, riesgo de lógica dispersa.

**Recomendación: A en su versión mínima.** Confirmado: `consulta`/`2a` con
`ttl_expiracion = NULL` es el **estado inicial válido** documentado para una
consulta sin fecha (`CLAUDE.md §Máquina de estados`, ficha §Reglas de negocio).
**Anti-scope**: no se modelan transiciones salientes de 2.a (eso es US-005+).

---

## §4 — Multi-tenancy/RLS y creación idempotente de CLIENTE

**RLS (patrón establecido, sin novedad)**: el `tenant_id` viaja en el payload
firmado del JWT (`req.user.tenantId`). El use-case de alta ejecuta **todo dentro de
un único `prisma.$transaction`** y llama `fijarTenant(tx, tenantId)` como primera
operación (igual que `reserva-estado.prisma.adapter.ts`). Así las policies
`tenant_isolation` filtran/insertan por tenant. La atomicidad de la transacción
satisface la regla "si falla, no se crea NADA" (FA-03) en el lado servidor (la
validación de forma ocurre antes, en el DTO/pipe).

**Idempotencia de CLIENTE por `(tenant_id, email)`**:

- **Opción A (recomendada): find-or-create dentro de la transacción.**
  `findFirst({ where: { tenantId, email } })`; si existe, reutilizar `idCliente`; si
  no, `create`. Usa el `@@index([tenantId, email])` ya presente. **Sin migración.**
  Ventana de carrera teórica entre find y create, pero el alta es **manual y de un
  único gestor** (concurrencia ~nula en MVP), por lo que el riesgo es despreciable.
- **Opción B**: añadir `@@unique([tenant_id, email])` y usar `upsert` atómico real.
  Da garantía dura ante concurrencia, pero **es una migración** y un cambio de
  invariante de datos (email nullable: Postgres trata NULLs como distintos, así que
  no rompe clientes sin email; aun así cambia el modelo). Excede el alcance de
  US-003.

**Recomendación: A** (sin migración) para US-003, dejando B documentado como
endurecimiento futuro si aparece concurrencia real de alta.

---

## Resumen de impacto en contrato (no se toca en este change)

`POST /reservas` ya existe en `docs/api-spec.yml` con `CreateReservaRequest`. El
`contract-engineer` (tras el gate) debería: (a) **añadir `comentarios`** al request
(decide E1 `enviado` vs `borrador`); (b) fijar requireds de contacto (`telefono`,
`email`) y forma de `nombre`/`apellidos` en `CreateClienteRequest`; (c) confirmar el
cuerpo de error de validación (400/422). US-003 **no** edita el contrato.
