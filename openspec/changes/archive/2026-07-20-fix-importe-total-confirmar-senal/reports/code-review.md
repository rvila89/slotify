# Informe de code-review — fix-importe-total-confirmar-senal

Fecha: 2026-07-20
Revisor: code-reviewer (solo lectura)
Rama: worktree-fix-importe-total-confirmar-senal

## Alcance revisado (working tree)
Ficheros de producción:
- apps/api/src/confirmacion/application/confirmar-pago-senal.use-case.ts
- apps/api/src/confirmacion/infrastructure/cargar-reserva-confirmacion.prisma.adapter.ts
- apps/api/src/confirmacion/infrastructure/confirmar-pago-senal-uow.prisma.adapter.ts

Tests:
- __tests__/confirmar-pago-senal-concurrencia.spec.ts
- __tests__/confirmar-pago-senal-integracion.spec.ts
- __tests__/confirmar-pago-senal.use-case.spec.ts
- __tests__/disparo-borradores-liquidacion-fianza.use-case.spec.ts

(El resto del diff vs master pertenece a trabajo ya mergeado de presupuestos/facturacion/web,
ajeno a este fix; no se evalúa aquí.)

## Bloqueantes
Ninguno.

## Altas
Ninguna.

## Medias
Ninguna.

## Bajas
- [idempotencia — invariante implícita] La serialización del doble-clic descansa en el
  `SELECT … FOR UPDATE` del `upgradeAFirme`, que SOLO se ejecuta si `reserva.fechaEvento !== null`
  (confirmar-pago-senal.use-case.ts:485). Es correcto porque un origen válido (`pre_reserva`)
  siempre tiene fecha bloqueada, pero esa invariante no está aseverada en el punto donde se usa
  el non-null assertion. Recomendación (no bloqueante): documentar/aseverar la invariante
  "pre_reserva ⇒ fechaEvento no nulo" o dejar constancia de que el lock cubre 100% de los orígenes
  legales. La cobertura de concurrencia actual ya lo valida empíricamente.

## OK (verificado)
- [Hexagonal/DDD] La capa application depende solo de puertos inyectados; no importa Prisma ni
  framework. El nuevo puerto `PresupuestoConfirmacionRepositoryPort` se declara en application y
  se implementa en infrastructure (dirección correcta). Los adaptadores importan `@prisma/client`
  y `@nestjs/*` solo en infrastructure. Ningún import de infra en domain.
- [Bloqueo atómico de fecha] La primitiva `SELECT … FOR UPDATE` + `UNIQUE` (`upgradeAFirme`,
  US-040) NO se altera. El congelado de `importe_total` y el marcado `aceptado` van DENTRO de la
  misma `$transaction` all-or-nothing (pasos c/c'). Sin Redis ni locks distribuidos.
- [Multi-tenancy/RLS] La UoW llama `fijarTenant(tx, tenantId)` como primera operación de la tx,
  por lo que `presupuestos.aceptar` corre bajo el contexto RLS del tenant. La lectura del
  presupuesto vigente (cargar-reserva adapter) filtra explícitamente `tenantId` en el WHERE y
  también fija tenant. `tenant_id` procede del JWT (comando.tenantId), nunca del path/body.
  El `where: { idPresupuesto }` sin `tenant_id` explícito en `aceptar` sigue el MISMO patrón
  ya establecido en `confirmarSenal` (where por PK bajo RLS) — coherente, no regresión.
- [Presupuesto vigente = MAX(version) enviado] `where estado='enviado' orderBy version desc`
  coincide con la definición de la spec (proposal.md:58-59). Cubierto por test de integración
  (v1 rechazado + v2 enviado → congela v2).
- [Importes en Decimal] Lectura `total.toFixed(2)` (Decimal→string) y escritura
  `new Prisma.Decimal(...)`. Sin Float en ningún punto.
- [Máquina de estados] Origen validado por tabla declarativa
  `ORIGENES_TRANSICION_CONFIRMAR_SENAL` + `esOrigenValidoParaConfirmarSenal`, sin if/else disperso.
  Importe inválido → 422 `IMPORTE_TOTAL_INVALIDO`; origen inválido → 422.
- [Contrato/DTO/cliente generado] Endpoint, DTO, respuesta HTTP y `docs/api-spec.yml` sin cambios.
  Capa interface/controller intacta. Cliente HTTP del frontend no editado.
- [Idempotencia] Test de concurrencia asevera: una sola confirmación; presupuesto queda
  `aceptado` una vez; `count(presupuesto) === 1` (no re-congela ni re-acepta). El non-null
  assertion `presupuestoVigente!` en el closure es seguro: `validarImporteTotal` en el paso (0)
  rechaza con 422 si es null antes de abrir la tx.
- [Coherencia read-path] `importe_total` deja de leerse en la confirmación como fuente de guarda,
  pero ahora SÍ se puebla en RESERVA al confirmar; otros read paths que leen `reserva.importe_total`
  mejoran (dejan de ver NULL). No hay rotura de consumidores.
- [Convenciones] Métodos de clase NestJS (exentos de arrow); helpers de dominio como arrow.
  Nombres en español; errores y mensajes en español.
- [Tests primero] Existen y pasan tests de concurrencia (doble-clic + fecha firme de otra
  reserva) y de integración (congelado, MAX(version), 422 sin presupuesto). QA report:
  unit 50/50, integración+concurrencia 16/16, confirmacion+facturacion 526/526 contra Postgres
  real; tsc + eslint limpios.

## Responsive (frontend)
No aplica: el fix es exclusivamente de backend (application + infrastructure). No hay cambios de UI
en apps/web dentro del alcance de este fix.

## Veredicto: APTO

No hay hallazgos bloqueantes. El único hallazgo (Baja) es una recomendación de documentación de
invariante, no un defecto. Apto para merge.
