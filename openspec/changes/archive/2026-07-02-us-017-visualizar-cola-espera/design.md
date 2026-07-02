# Design — us-017-visualizar-cola-espera

## Context

US-017 (UC-11, actor **Gestor**) es la **vista de solo lectura** de la cola de espera de
una fecha: la consulta bloqueante + la cola FIFO de consultas en `2.d`. Es el destino del
clic sobre el indicador `🔁 N en cola` del calendario, cuya navegación US-039 dejó
**explícitamente delegada** en US-017 (`calendario/spec.md` → *"Clic en el indicador de
cola abre la vista de cola"*). No muta estado. La infraestructura de cola ya existe y se
**reutiliza sin redefinir**:

- `apps/api/src/reservas/infrastructure/cola-query.prisma.adapter.ts` — `ColaQueryPort`
  (US-018): lectura pura *"¿hay cola activa apuntando a esta bloqueante?"* (`hayColaActiva`,
  filtro `sub_estado = s2d` + `consulta_bloqueante_id`, contexto RLS vía `fijarTenant`). Es
  la **base del read model** de US-017: mismo filtro, misma tabla, mismo RLS; US-017 lo
  **extiende** con una proyección de lectura (bloqueante + lista de cola ordenada), NO lo
  duplica.
- `apps/api/src/reservas/domain/promocion-cola.ts` (US-018) — modela la cola como
  `EntradaCola { reservaId, subEstado, posicionCola, consultaBloqueanteId }` y valida
  contigüidad FIFO. US-017 **reutiliza los nombres** (español/camelCase) para su read model,
  para que back de lectura y back de promoción hablen el mismo lenguaje de cola.
- `apps/api/src/reservas/application/obtener-reserva.query.ts` (US-005) — patrón CQRS-lite de
  **query de lectura** (`ObtenerReservaUseCase` + `ReservaDetalleQueryPort` + adaptador
  Prisma, sin transacción de escritura, cross-tenant → `null` → 404). US-017 **clona este
  patrón** para `ObtenerColaEsperaUseCase`.
- `apps/api/src/reservas/interface/reserva-detalle.dto.ts` — convención de DTO de salida
  (camelCase, `@ApiProperty`/`@ApiPropertyOptional`, sin `class-validator` en salida, TTL
  como `date-time` string). El DTO de cola sigue esta convención.
- `RESERVA` (`posicion_cola`, `consulta_bloqueante_id`, `sub_estado`, `ttl_expiracion`,
  `fecha_creacion`, `visita_programada_fecha`), `FECHA_BLOQUEADA`, `CLIENTE` — todo
  provisionado. Índice de cola `reserva_cola_posicion_key` (US-004) aprovechado para el
  ORDER BY. **Sin migración nueva.**
- `docs/api-spec.yml` — el path `GET /reservas/{id}/cola` (tag `Cola`, UC-11) y el esquema
  `ColaItem` (`idReserva`, `codigo`, `posicionCola`, `clienteNombre`) **ya están
  reservados**; US-017 los madura al DTO completo (el `contract-engineer` cierra el delta).

Este documento fija las decisiones no triviales. Los puntos marcados **⚠ para el gate SDD**
requieren el OK humano antes de implementar.

## D-1. Endpoint: lectura agregada por la RESERVA bloqueante (`GET /reservas/{id}/cola`)

**Decisión.** Un único endpoint de lectura `GET /reservas/{id}/cola`, donde `{id}` es el
`reservaId` de la **consulta bloqueante** (la que posee la `FECHA_BLOQUEADA` activa).
Devuelve un read model con dos secciones (bloqueante + cola), en una sola llamada, sin N+1.

**Por qué el path por-reserva y no por-fecha (`GET /fechas/{fecha}/cola`):**

- El contrato OpenAPI **ya reserva** `GET /reservas/{id}/cola` con `ColaItem` (L666-679,
  L1814). Maduramos lo existente en lugar de introducir una superficie nueva y competir con
  el placeholder — menos deuda de contrato, trazabilidad limpia.
- El **flujo de entrada** es el calendario: `GET /calendario` ya devuelve, por cada fecha
  ocupada, el `reservaId` de la bloqueante y `enCola` (US-039 §D-1/D-3). Al hacer clic en el
  indicador, el frontend **ya conoce el `reservaId`** de la bloqueante; navegar por `{id}`
  evita un segundo salto fecha→bloqueante en el backend.
- La ficha de reserva (`GET /reservas/{id}`, US-005) y la cola comparten el mismo `{id}` de
  agregado raíz: coherencia de rutas alrededor de `RESERVA` como raíz DDD.

**Nota de contrato (⚠ para el `contract-engineer`).** `{id}` es el id de la **bloqueante**.
Si en implementación se detectara que la UI a veces solo dispone de la fecha (no del
`reservaId`), la alternativa sería un `GET /calendario/{fecha}/cola`; **no se adopta** salvo
que el gate lo pida, para no duplicar superficie.

## D-2. Read model y DTO (madurando `ColaItem`)

**Decisión.** Read model `ColaEsperaLectura` (aplicación) → `ColaEsperaResponseDto` (HTTP),
superset del `ColaItem` del contrato:

```jsonc
{
  "bloqueante": {
    "idReserva": "uuid",
    "codigo": "SLO-2026-0007",
    "clienteNombre": "Ana García",
    "subEstado": "2b",                 // 2b | 2c | 2v
    "ttlExpiracion": "2026-09-13T10:00:00Z", // date-time | null
    "ttlRestante": "22 h",             // derivado, legible | null
    "visitaProgramadaFecha": null      // date | null (solo 2v)
  },
  "cola": [
    {
      "idReserva": "uuid",
      "codigo": "SLO-2026-0008",
      "clienteNombre": "Luis Pérez",
      "posicionCola": 1,
      "fechaCreacion": "2026-07-02T08:00:00Z", // date-time
      "tiempoEnCola": "2 h"            // derivado, legible
    }
  ]
}
```

- `cola[].` es un **superset del `ColaItem` actual** (`idReserva`, `codigo`, `posicionCola`,
  `clienteNombre` ya existen; se añaden `fechaCreacion` y `tiempoEnCola`).
- **Nombres alineados** con `promocion-cola.ts` (`reservaId`/`posicionCola`/`subEstado`) y
  con la convención de `reserva-detalle.dto.ts` (camelCase, TTL como `date-time` string).
- **Derivación en backend, no en cliente**: `ttlRestante` y `tiempoEnCola` se calculan en el
  use-case (o en el mapper del controlador) sobre instantes `timestamptz`
  (`ttl_expiracion − now()`, `now() − fecha_creacion`), **nunca** formateando fechas — mitiga
  el off-by-one de TZ documentado. La respuesta expone tanto el instante crudo
  (`ttlExpiracion`, `fechaCreacion`) como el legible derivado, para que el frontend pueda
  reformatear si lo prefiere. La representación legible exacta ("22 h", "2 días") la afina
  el `contract-engineer`/`frontend-developer`.

## D-3. FA-04 (fecha sin FECHA_BLOQUEADA) — forma de respuesta ⚠ decisión de contrato para el gate

Cuando la reserva `{id}` **no** es bloqueante de ninguna fecha activa (no hay
`FECHA_BLOQUEADA` con `reserva_id = {id}`), la UI debe mostrar "Fecha disponible". Hay dos
formas posibles, **a decidir en el gate SDD** (la cierra el `contract-engineer`):

- **(a) 200 con indicador** `{ "estaBloqueada": false, "bloqueante": null, "cola": [] }`.
  Ventaja: un solo código feliz, la UI ramifica por `estaBloqueada`. Más alineado con la
  semántica "consulta de estado de una fecha" (no es un error que la fecha esté libre).
- **(b) 404** si `{id}` no bloquea ninguna fecha. Ventaja: coherente con el 404 de
  `GET /reservas/{id}` cuando no existe/otro tenant; pero **mezcla** "reserva inexistente"
  con "reserva existente pero no bloqueante", lo que la UI tendría que desambiguar.

**Propuesta por defecto: (a) 200 con `estaBloqueada: false`**, reservando 404 solo para
reserva inexistente / de otro tenant (RLS), coherente con `ObtenerReservaUseCase`. El shape
final entra en el contrato en el step de contrato. (`US-017 FA-04`.)

## D-4. Indicador de cola en el calendario — reutilización, SIN cambio de contrato

**Decisión.** US-017 **NO** amplía `GET /calendario` ni la capability `calendario`. El
indicador `🔁 N en cola` ya está **vivo en la spec de `calendario`** (Requirement *"Indicador
de cola de espera sobre la fecha bloqueante"*): `enCola = COUNT(RESERVA WHERE sub_estado='2d'
AND consulta_bloqueante_id = <bloqueante>)`, visible solo si `enCola ≥ 1` (US-039 §D-3). La
regla de negocio de US-017 *"el indicador solo es visible con ≥1 RESERVA en 2.d"* **ya está
satisfecha**.

- Lo único que US-017 aporta en el frontend es **cablear el clic** del indicador (hoy
  delegado por la spec de `calendario`: *"La visualización de la cola se delega en US-017 /
  UC-11"*) a la nueva vista de cola, navegando con el `reservaId` de la bloqueante que la
  respuesta del calendario ya provee.
- No se toca el use-case ni el DTO de calendario. No hay delta de la capability `calendario`.

Justificación: evita duplicar el conteo de cola (una sola fuente de verdad en `calendario`),
respeta la frontera de capabilities y la delegación ya escrita en la spec viva.

## D-5. Frontend — ubicación de la vista (⚠ decisión menor para el gate/`frontend-developer`)

Vista de **solo lectura**, responsive mobile-first (390/768/1280 sin overflow, objetivos
táctiles accesibles; nav lateral colapsa a drawer en `<lg` — regla dura `CLAUDE.md`). Dos
ubicaciones posibles (estilo Bulletproof React, barrel `index.ts`):

- **(a)** feature propia `apps/web/src/features/cola-espera/` (`api/ components/ lib/ model/
  pages/`). Ventaja: aislamiento y reutilización por US-019/US-020 (que dependen de US-017).
- **(b)** pantalla dentro de `features/calendario/` (es su destino de navegación natural) o
  `features/reservas/`.

**Propuesta por defecto: (a) `features/cola-espera/`**, porque US-019 (promoción manual) y
US-020 (salir de cola) construirán acciones **sobre esta misma vista** y conviene un hogar
estable. El cliente HTTP se **genera** desde el contrato (nunca editado a mano). La lista
muestra "tiempo en cola" por elemento y enlaces a la ficha (`GET /reservas/{id}`).

## D-6. Backend hexagonal (lectura pura)

- **Dominio (puro, sin `@nestjs`/Prisma — hook `no-infra-in-domain`)**: tipos del read model
  (`ColaEsperaLectura`, reutilizando `EntradaCola`/nombres de `promocion-cola.ts`) y, si se
  necesita, una función pura de derivación `ttlRestante`/`tiempoEnCola` desde instantes
  (unit-testeable sin BD). Sin máquina de estados (no hay transición: es lectura).
- **Aplicación**: `ObtenerColaEsperaUseCase` (clon de `ObtenerReservaUseCase`): recibe
  `{ tenantId, reservaId }`, invoca `ColaEsperaQueryPort.buscarCola(...)`; si la reserva no
  existe/no es del tenant → error tratado como no encontrada (D-3 caso RLS).
- **Infraestructura**: `ColaEsperaQueryPrismaAdapter implements ColaEsperaQueryPort`,
  **reutilizando el patrón** de `ColaQueryPrismaAdapter` (RLS vía `fijarTenant`, filtro
  `sub_estado = s2d` + `consulta_bloqueante_id`, `ORDER BY posicion_cola ASC`). Lee la
  bloqueante (+ cliente) y su cola (+ cliente por elemento). Binding en `reservas.module.ts`.
- **Interfaz**: controller NestJS expone `GET /reservas/{id}/cola`, mapea a
  `ColaEsperaResponseDto`, resuelve `tenantId` del JWT.

## D-7. Por qué NO hay tests de concurrencia en esta US

Misma justificación que US-039 §D-7: **lectura pura, no muta estado**. Las garantías de
concurrencia de la cola residen en US-004 (unicidad de posición) y US-018 (promoción atómica),
ya implementadas. Un stale-read de milisegundos (p. ej. una promoción en curso) no es riesgo
operativo para una vista visual. El bloque TDD-RED cubre, por tanto:

- **Derivación pura** de `ttlRestante`/`tiempoEnCola` desde instantes (incl. TTL `null`).
- **Use-case de proyección**: bloqueante en `2b`/`2c`/`2v` (con `visitaProgramadaFecha` en
  `2v`), cola ordenada ASC por `posicion_cola`, **exclusión** de sub_estados no `2d` y de la
  propia bloqueante, y **aislamiento por tenant**.
- **Los 5 FA**: sin cola (FA-01), 2.c (FA-02), 2.v con visita (FA-03), sin FECHA_BLOQUEADA
  (FA-04, según shape de D-3), cola de 1 (FA-05).

Sin tests de bloqueo distribuido (prohibido por hook `no-distributed-lock`) ni de escritura.

## Riesgos / Trade-offs

- **Placeholder de contrato divergente**: `ColaItem` actual es mínimo; madurarlo + añadir la
  sección bloqueante es un delta de contrato real (no NO-OP). Mitigación: lo cierra el
  `contract-engineer` en su step; el SDK del frontend se regenera.
- **FA-04 shape (D-3)**: 200-con-indicador vs 404 afecta la UI y otros consumidores futuros;
  por eso es decisión de gate/contrato, no del implementador.
- **Coherencia con US-018 en curso de datos**: si una promoción ocurre entre el render del
  calendario y la apertura de la cola, la vista puede mostrar un estado ligeramente distinto
  (la bloqueante cambió). Es aceptable para lectura; un refresco lo reconcilia.
- **Off-by-one de TZ**: mitigado computando derivados sobre `timestamptz` (D-2); el arreglo
  de `formatearFechaHora` es deuda de un change aparte.

## Pendiente / fuera de alcance

- **Promoción manual** por el Gestor (US-019) y **salida voluntaria** de cola (US-020):
  añadirán acciones sobre esta misma vista; US-017 solo entrega la lectura.
- **Mutación** de cualquier estado de la cola: fuera de alcance (lectura pura).
- **Rediseño del indicador** del calendario: es US-039, ya vivo; US-017 solo cablea el clic.
- **Arreglo del off-by-one de TZ** en `formatearFechaHora`: change aparte.
