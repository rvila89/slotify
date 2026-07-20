# Change: cambiar-fecha-consulta-en-cola

## Why

Cuando el gestor da de alta una consulta cuya fecha ya está bloqueada por otra
consulta en `2b`, la consulta entra en **cola de espera** (`sub_estado = '2d'`) y el
lead recibe un email E1 `fecha_cola`. **Eso ya funciona** (US-004 índice de cola;
US-051 §D-2.3 diferido; rama cola de la transición de fecha). El hueco de producto:
al recibir ese email, el lead puede pedir **otra fecha**, pero hoy el gestor **NO
puede** cambiar la fecha de una consulta en cola desde el detalle:

- `POST /reservas/{id}/cambiar-fecha` (requirement vivo *"Cambio atómico de una fecha
  ya bloqueada"*, `apps/api/src/reservas/application/cambiar-fecha.use-case.ts`) solo
  admite orígenes `2b/2c/2v` (`ORIGENES_CAMBIAR_FECHA_BLOQUEADA` en
  `maquina-estados.ts`). La guarda `esOrigenValidoParaCambiarFecha` rechaza `2d`
  con **422**.
- La UI del detalle (`apps/web/src/features/reservas`) muestra *"La fecha no puede
  cambiarse en el estado actual"* para una consulta en `2d`.

Es un **cambio de comportamiento con reglas de negocio** (nueva rama de origen,
salida de cola con reordenación, bloqueo de la fecha nueva, borrador E1), por lo que
nace como change de OpenSpec y pasa por los gates humanos del harness.

(Fuente: `US-051 §D-2.3` (diferido a change propio); requirement vivo *"Cambio
atómico de una fecha ya bloqueada"*; requirement vivo *"Salida de cola con
reordenación al descartar desde 2.d"* (US-013); US-004 índice de cola;
`CLAUDE.md §Regla crítica: bloqueo atómico de fecha`.)

## What Changes

> Slice sobre la capability `consultas`. Habilita `2d` como origen de
> `POST /reservas/{id}/cambiar-fecha` con la semántica de las **dos decisiones de
> producto ya tomadas**. **Sin cambios de esquema del contrato OpenAPI/SDK**
> (`docs/api-spec.yml` solo documental) y **SIN migración de BD** (las columnas
> `posicion_cola`, `consulta_bloqueante_id`, `ttl_expiracion`, `sub_estado` ya
> existen). Sujeto al **Gate de revisión humana SDD**.

- **MODIFICA** el requirement *"Cambio atómico de una fecha ya bloqueada"* para incluir
  el origen `2d` (además de `2b/2c/2v`), conservando sus 4 escenarios actuales y
  añadiendo los escenarios de la rama de cola:
  1. **Nueva fecha LIBRE → la consulta SALE de la cola y pasa a `2b`**: bloquea la
     fecha nueva `F2` (bloqueo blando con TTL, primitiva atómica existente),
     `fecha_evento = F2`, `sub_estado 2d → 2b`, `posicion_cola → NULL`,
     `consulta_bloqueante_id → NULL`; **reordena la cola vieja** (mecánica idéntica al
     requirement *"Salida de cola con reordenación al descartar desde 2.d"*); crea un
     **borrador E1** (no autoenviado, `fecha_envio = NULL`) reutilizando
     `plantilla-transicion-fecha.ts` rama `'disponible'`; `AUDIT_LOG`. **NO promueve
     ninguna cola** (la consulta en `2d` no posee bloqueo; su bloqueante sigue intacto).
  2. **Nueva fecha OCUPADA → conflicto 409 terminal**: rollback total, la consulta
     conserva su posición en cola; **NO** se ofrece re-encolar (mismo shape que hoy:
     solo `motivo`, sin `colaDisponible`).

### Impacto por capa

- **Backend** `apps/api/src/reservas`:
  - Dominio: nueva guarda declarativa `esOrigenCambiarFechaEnCola` +
    `ORIGENES_CAMBIAR_FECHA_EN_COLA = [{ estado: 'consulta', subEstado: '2d' }]` en
    `maquina-estados.ts` (**separada** de `esOrigenValidoParaCambiarFecha` de 2b/2c/2v);
    seam de salida de cola con reordenación (reutiliza la mecánica de US-013).
  - Application: rama `2d` en `CambiarFechaUseCase` seleccionada por el origen; creación
    del borrador E1 en la misma transacción.
  - Infra: adaptador UoW/repositorio para INSERTAR bloqueo nuevo de `F2` + CAMBIAR
    `sub_estado 2d → 2b` + reordenar cola vieja, todo en una `$transaction` con RLS.
  - Controller: mapeo de la nueva guarda de origen (422) y del conflicto (409).
- **Frontend** `apps/web/src/features/reservas`: habilitar el botón *"Cambiar fecha"*
  en el detalle para una consulta en `2d` (hoy deshabilitado con motivo).
- **Contrato** `docs/api-spec.yml`: **solo documental** (sin cambio de esquemas de
  request/response; el endpoint ya existe).
- **BD**: **SIN migración** (columnas ya existentes).

## Impact

- **Specs afectadas**: `openspec/specs/consultas/spec.md` — requirement *"Cambio
  atómico de una fecha ya bloqueada"* (MODIFIED).
- **Riesgo**: concurrencia del bloqueo de `F2` (misma serialización PostgreSQL que
  hoy) e integridad de la reordenación de cola bajo `UNIQUE(tenant_id,
  consulta_bloqueante_id, posicion_cola)`. Cubierto por TDD (concurrencia + máquina de
  estados) antes de implementar.
- **No rompe** el comportamiento actual de `2b/2c/2v` (rama separada por guarda).
