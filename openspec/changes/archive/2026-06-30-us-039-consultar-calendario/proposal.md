# Change: us-039-consultar-calendario

## Why

US-039 (UC-29, prioridad **Crítica**) entrega la **primera vista funcional del
App Shell**: el Calendario de Disponibilidad, página de inicio tras el login
(sidebar → primera opción). Hoy ese slot es un placeholder (US-000A).

Resuelve **D2** (cero visibilidad del pipeline) y **D4** (riesgo de doble
reserva): el Gestor obtiene visión instantánea del estado de ocupación de cada
fecha mediante un código de colores canónico, sin abrir fichas individuales,
reduciendo la inspección diaria de ~15 min (Sheets manual) a <1 min.
(Fuente: `US-039 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`.)

Es una **vista de lectura pura**: NO muta estado. Refleja el estado actual de
`RESERVA` y `FECHA_BLOQUEADA` filtrado por el `tenant_id` del JWT. Los estados
que pinta son escritos por otras automatizaciones (A1, A2, A4, A5, A6, A15, A21)
y por US-040 (quien escribe `FECHA_BLOQUEADA`).
(Fuente: `US-039 §Contexto`, `§Concurrencia / Race Conditions`.)

> Esta US se adelanta fuera del orden del backlog por decisión explícita del
> usuario. Su única dependencia (US-000A, el App Shell autenticado) ya está
> implementada y archivada, por lo que todas las dependencias están satisfechas.

## What Changes

> Alcance estricto: **vista de lectura agregada**. NO escribe `RESERVA` ni
> `FECHA_BLOQUEADA`; NO implementa la cola de espera ni el bloqueo atómico.
> (Fuente: `US-039 §Concurrencia`, `§Reglas de Validación`, `§Notas de alcance`.)

- **Endpoint de lectura agregado por rango de fechas** (capability nueva
  `calendario`): dado un rango (mes/semana/día/lista) devuelve, por cada fecha
  ocupada del tenant, el **color/estado derivado** del par `estado`/`sub_estado`
  de la reserva bloqueante y el **conteo de cola** (`N` reservas en `2d`
  apuntando a esa fecha). Filtra siempre por `tenant_id` del JWT + RLS.
  (Fuente: `US-039 §Happy Path`, `§Reglas de Validación`, `§Aislamiento`.)
- **Derivación del código de colores canónico** (SlotifyGeneralSpecs §11.3):
  gris = consulta activa (`2a`/`2b`/`2c`/`2v`); ámbar = `pre_reserva`; verde =
  `reserva_confirmada`/`evento_en_curso`/`post_evento`; azul =
  `reserva_completada`; rojo = `reserva_cancelada`; sin color = fecha libre.
  (Fuente: `US-039 §Happy Path`, `§Reglas de Negocio`.)
- **Indicador `🔁 N en cola`** sobre la fecha bloqueante (en `2b`) cuando hay
  ≥ 1 `RESERVA` en `sub_estado = 2d` con `consulta_bloqueante_id` apuntando a la
  reserva bloqueante. (Fuente: `US-039 §Happy Path` 2º escenario,
  `§Reglas de Validación`.)
- **Vista de Calendario en el frontend** (slot Calendario del App Shell): vistas
  mes / semana / día / lista con navegación entre períodos, código de colores
  consistente entre vistas; librería de calendario negociable (FullCalendar o
  react-big-calendar). Mobile-first responsive (390/768/1280).
  (Fuente: `US-039 §Reglas de Negocio`, `§Cambio de vista`; `CLAUDE.md` regla
  responsive.)
- **Detalle resumido al clic en fecha con bloqueo activo**: panel/popover con
  cliente, `sub_estado`, TTL restante y enlace a la ficha completa de la reserva
  (lectura, sin mutación). (Fuente: `US-039 §Clic en fecha con reserva activa`.)
- **Clic en `🔁`** → navega a la vista de cola de esa fecha (delega en US-017 /
  UC-11, **fuera de alcance** aquí). (Fuente: `US-039 §Clic en indicador de cola`.)

## Impact

- Specs afectadas: **nueva capability `calendario`** (vista de lectura agregada
  de disponibilidad). No modifica `consultas`, `bloqueo-fecha` ni `app-shell`.
- Código afectado (implementación posterior, fuera de este change de spec):
  - Backend: `apps/api/src/calendario/**` (controller + use-case de lectura
    agregada + adaptador de query Prisma con RLS por `tenant_id`).
  - Contrato: nuevo `GET /calendario` (rango de fechas + vista) en
    `docs/api-spec.yml`; SDK regenerado.
  - Frontend: `apps/web/src/features/calendario/**` (página, componentes de
    calendario, derivación de color en `model/`/`lib/`, popover de detalle),
    cableado del slot Calendario del App Shell como página de inicio.
- Trazabilidad: **US-039**, **UC-29**; código de colores SlotifyGeneralSpecs
  §11.3; entidades `RESERVA`, `FECHA_BLOQUEADA`, `TENANT` (`er-diagram.md`).
- Dependencias: **US-000A** (App Shell autenticado — ya archivada). Lee datos
  escritos por US-040 (bloqueo atómico — ya archivada) y por el flujo de
  consultas (US-003..US-008 — archivadas).
- **No-objetivos (fuera de alcance):**
  - **US-017 / UC-11 (vista de cola de espera)**: el calendario solo muestra el
    indicador `🔁 N` y enlaza; la visualización de la cola la entrega US-017.
  - **US-040 (bloqueo atómico de fecha) y garantías de concurrencia**: las
    garantías de concurrencia sobre `FECHA_BLOQUEADA` residen en US-040; esta US
    no escribe bloqueos ni añade tests de race condition propios (lectura pura;
    el stale-read de milisegundos no es un riesgo operativo para una vista).
    (Fuente: `US-039 §Concurrencia / Race Conditions`.)
  - Cualquier **mutación de estado** de `RESERVA` o `FECHA_BLOQUEADA`.
