# Change: us-041-liberar-fecha

## Why

Una fecha bloqueada que nunca se libera es **doble riesgo comercial** (dolor **D4**):
la fecha queda perpetuamente fuera del mercado y, si había leads en cola, esas
oportunidades se pierden (dolor **D13**). La US-040 introdujo `bloquearFecha()` (la
mitad que ocupa la fecha); la **US-041 (UC-31)** introduce su **complemento atómico**:
`liberarFecha()`, la operación que **elimina** atómicamente la fila de `FECHA_BLOQUEADA`
de una `(tenant_id, fecha)` y, si existe cola activa, **dispara** la promoción del primer
lead en espera. (`US-041 §Historia`, `§Reglas de negocio`; `use-cases.md` UC-31;
`er-diagram.md §3.6`, `§5.3`.)

Sin esta operación, las automatizaciones **A4** (TTL agotado en `2.b` → liberar +
promover cola), **A5** (TTL agotado en `pre_reserva` → liberar + cancelar) y **A21**
(día post-visita sin resultado → liberar) no tienen dónde apoyarse: cada flujo invocante
(US-012 expiración, US-013 descarte, US-011 descarte post-visita, US-019 promoción
manual y la cancelación de reserva confirmada) llama a `liberarFecha()` como servicio
compartido. (`US-041 §Contexto`, `§Dependencias`.)

Es **infraestructura de dominio (solo backend)**, gemela de US-040: no aporta vista
propia ni, previsiblemente, endpoint HTTP propio (el actor de UC-31 es el **Sistema**;
ver `design.md` D-7). La liberación es **efecto** de transiciones de estado y del cron de
barrido de TTL, no una acción de usuario. (`US-041 §Historia`, `§Notas de alcance`.)

## What Changes

- **Extiende la capability existente `bloqueo-fecha`** (NO crea una nueva): añade la
  operación de dominio `liberarFecha()`, complemento atómico de `bloquearFecha()` sobre
  la misma primitiva (`FECHA_BLOQUEADA`) y el mismo agregado raíz `Reserva`. Vive en el
  mismo módulo `reservas/domain` (hexagonal, sin importar infra), sirviendo un nuevo
  servicio/puerto de liberación. (`US-041 §Reglas de negocio`; `AGENTS.md §Regla crítica`.)
- **Eliminación atómica** del registro `(tenant_id, fecha)` dentro de una transacción
  (DELETE serializado). **NO** Redis/Redlock/locks distribuidos (hook
  `no-distributed-lock`): el patrón es exclusivamente PostgreSQL + transacción.
  (`US-041 §Reglas de negocio`; `er-diagram.md §5.3`.)
- **Idempotencia**: un DELETE con **0 filas afectadas** es **éxito silencioso** (sin
  excepción), de modo que los retries del cron de barrido no generan errores. La tentativa
  idempotente queda registrada en `AUDIT_LOG`. (`US-041 §Edge Cases idempotencia`,
  `§Reglas de Validación`.)
- **Guarda del bloqueo firme**: un `tipo_bloqueo = 'firme'` **solo** puede liberarse si
  la `RESERVA` referenciada está en estado terminal `reserva_cancelada`. Validación de
  dominio **previa** al DELETE; en cualquier otro estado se **rechaza** y el bloqueo firme
  permanece **intacto** (el intento se registra en `AUDIT_LOG`). La guarda se apoya en la
  estructura declarativa de transiciones, no en código disperso. (`US-041 §Reglas de
  Validación`, §Intento de liberar bloqueo firme sin cancelación.)
- **Disparo de promoción de cola (US-018) como seam**: si tras liberar existe cola activa
  (`RESERVA` con `sub_estado = '2d'` y `consulta_bloqueante_id` apuntando a la liberada),
  se **dispara** la mecánica de promoción de US-018. US-041 **solo garantiza el trigger**;
  NO redefine la reordenación de cola ni el email (eso es US-018, aún **no** implementada).
  Se modela como **puerto/seam** `PromocionColaPort` que US-041 invoca; la implementación
  real llegará con US-018. (`US-041 §Notas de alcance`, `§Reglas de Validación`;
  `er-diagram.md §5.2`.)
- **Exactamente-una-vez en la promoción**: solo el worker que **realmente eliminó** la
  fila (1 row affected) dispara la promoción; el worker que obtiene 0 filas no la dispara.
  Esto evita la doble promoción ante dos liberaciones concurrentes. (`US-041 §Concurrencia`,
  §Criterio de éxito.)
- **Barrido en lote**: N fechas expiradas en un mismo barrido se liberan cada una en una
  **transacción independiente**; el fallo de una no bloquea las demás; cada liberación
  exitosa dispara promoción si corresponde. (`US-041 §Edge Cases barrido`.)
- **No muta la RESERVA**: la operación NO cambia `estado`/`sub_estado` de la reserva; esa
  transición la ejecuta el flujo invocante (US-012/US-013/US-011/cancelación).
  (`US-041 §Reglas de Validación`.)
- **AUDIT_LOG**: toda liberación exitosa (y todo intento idempotente o rechazado) queda
  registrada con `accion = 'eliminar'`, `entidad = 'FECHA_BLOQUEADA'` y la **causa**
  (TTL / descarte / cancelación). (`US-041 §Reglas de Validación`; `er-diagram.md §3.17`.)

## Impact

- Specs afectadas: **se extiende `bloqueo-fecha`** con `ADDED Requirements` para la
  liberación. NO se crea capability nueva ni se modifican `foundation`, `calculo-tarifa`
  ni `app-shell`. (`spec-delta` en `specs/bloqueo-fecha/spec.md`.)
- Datos: ninguna entidad nueva. Usa `FECHA_BLOQUEADA`, `RESERVA` (campos de cola
  `posicion_cola`, `consulta_bloqueante_id`) y `AUDIT_LOG`, todas ya provisionadas. NO se
  requieren migraciones de esquema (el DELETE opera sobre la tabla existente y sus
  constraints de US-040).
- Contrato OpenAPI: **previsiblemente NO se expone endpoint HTTP propio** — operación
  interna de dominio invocada por flujos/cron, no acción de usuario. Decisión razonada y
  **revisable en el gate** en `design.md` D-7; este change **no edita `docs/api-spec.yml`**.
- Alcance del cron/endpoint de barrido: **decisión de alcance a aprobar en el gate**
  (`design.md` D-9). Recomendación: US-041 entrega la **operación de dominio reutilizable**
  `liberarFecha()` + el **caso de uso de aplicación de liberación en lote** (orquestación
  de transacciones independientes), **difiriendo** el wiring del cron/endpoint protegido a
  la US de jobs asíncronos / US-012, igual que US-040 difirió el barrido.
- Promoción de cola: se introduce el **seam** `PromocionColaPort` con un stub no-op
  documentado; la lógica real es **US-018** (aún no implementada). Decisión de alcance a
  aprobar en el gate (`design.md` D-2).
- Concurrencia: **zona crítica — TDD primero**. Tests de dos liberaciones concurrentes
  (1 promoción exactamente), race liberación vs nuevo bloqueo, idempotencia 0 filas, guarda
  firme y lote con fallo aislado. (`US-041 §Concurrencia`, `CLAUDE.md §Testing`.)
- Trazabilidad: **US-041**, **UC-31**, dolores **D4**/**D13**; automatizaciones A4/A5/A21;
  invocada por US-012, US-013, US-011, US-019 y la cancelación de reserva confirmada;
  dispara US-018.
- Fuera de alcance: la **reordenación de cola** y el **email** al lead promovido (US-018);
  el **wiring del cron/endpoint** de barrido (US de jobs / US-012); las **transiciones de
  estado** de `RESERVA` (responsabilidad del flujo invocante). (`US-041 §Notas de alcance`.)
