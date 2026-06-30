# Design — us-039-consultar-calendario

> Decisiones técnicas de la vista de Calendario de Disponibilidad (US-039, UC-29).
> Vista de **lectura pura**: no muta estado. Fuentes: `US-039`, `er-diagram.md`,
> `architecture.md`, `CLAUDE.md` (hexagonal, multi-tenancy/RLS, frontend por dominio,
> responsive), SlotifyGeneralSpecs §11.3 (código de colores).

## D-1. Un único endpoint de lectura agregado por rango de fechas

**Decisión.** Un endpoint `GET /calendario` que, dado un **rango de fechas** y la
**vista** solicitada, devuelve la **agregación por fecha ocupada** del tenant: el
color/estado derivado y el conteo de cola. No se exponen las reservas crudas ni
se hace agregación en el cliente.

- **Query params (negociable en el contrato por `contract-engineer`):**
  `desde` (date), `hasta` (date) y `vista` (`mes`|`semana`|`dia`|`lista`). El
  rango lo calcula el frontend según la vista y el período activo; el backend
  solo agrega sobre `[desde, hasta]`. La vista es informativa (paginación/forma);
  el conjunto de datos es el mismo para todas las vistas del mismo rango — lo que
  garantiza el código de colores idéntico entre vistas (US-039 §Reglas de
  Validación).
- **Forma de respuesta (una entrada por fecha ocupada):**
  ```jsonc
  {
    "rango": { "desde": "2026-06-01", "hasta": "2026-06-30" },
    "fechas": [
      {
        "fecha": "2026-06-12",
        "color": "gris",            // gris|ambar|verde|azul|rojo
        "estado": "consulta",       // estado de la reserva bloqueante
        "subEstado": "2b",          // sub_estado (para etiqueta y popover)
        "reservaId": "uuid",        // enlace a la ficha
        "cliente": "Ana García",    // detalle resumido del popover
        "ttlRestante": "2 días",    // null si no aplica (firme/histórica)
        "enCola": 2                  // conteo de reservas en 2d; 0 si no hay cola
      }
    ]
  }
  ```
  Las fechas **libres** simplemente **no aparecen** en `fechas` (la celda neutra
  es la ausencia de entrada). Esto mantiene la respuesta proporcional al número de
  fechas ocupadas, no al tamaño del rango.

**Por qué.** Un solo endpoint agregado evita N+1 desde el cliente, mantiene la
derivación del color y el conteo de cola como **lógica de dominio en el backend**
(testeable, una sola fuente de verdad) y deja al frontend solo el render. El
detalle del popover (cliente, sub_estado, TTL, enlace) viaja ya en la respuesta:
el clic en una celda no dispara otra llamada.

## D-2. Derivación del color desde estado / sub_estado (tabla de datos)

**Decisión.** El color se deriva del par `(estado, sub_estado)` de la reserva
bloqueante mediante una **estructura de datos declarativa** (mapa), nunca con
`if` dispersos — coherente con "transiciones como estructura de datos" del
`CLAUDE.md`. Reglas (SlotifyGeneralSpecs §11.3, US-039 §Happy Path):

| Estado / sub_estado                                   | Color      |
|-------------------------------------------------------|------------|
| consulta activa: `2a`, `2b`, `2c`, `2v`               | `gris`     |
| `pre_reserva`                                         | `ambar`    |
| `reserva_confirmada`, `evento_en_curso`, `post_evento`| `verde`    |
| `reserva_completada`                                  | `azul`     |
| `reserva_cancelada`                                   | `rojo`     |
| fecha libre (sin bloqueo activo)                      | sin color  |

- Sub-estados **terminales** de consulta (`2x`/`2y`/`2z`) **no** aparecen: su
  bloqueo en `FECHA_BLOQUEADA` ya fue liberado, así que no entran en la query de
  fechas ocupadas (US-039 §Supuestos, §Histórico). Quedan visibles para auditoría
  vía la ficha de la reserva, no como celda bloqueada.
- `evento_en_curso` y `post_evento` **heredan** el verde de `reserva_confirmada`;
  la diferenciación de detalle solo se ve en la ficha (US-039 §Supuestos).
- El color es un **token semántico** ya cableado por US-000A (estados de reserva
  como tokens nombrados, no hex inline). El frontend mapea
  `color → token Tailwind`; el backend emite el nombre lógico.

## D-3. Indicador de cola `🔁 N`

**Decisión.** `enCola` = `COUNT(RESERVA WHERE sub_estado = '2d' AND
consulta_bloqueante_id = <id de la reserva bloqueante de esa fecha>)`, calculado
en el backend dentro de la misma agregación. El frontend muestra `🔁 N en cola`
solo si `enCola ≥ 1`, sobre la celda gris (no cambia el color base). El clic en el
indicador **navega** a la vista de cola (US-017) — esta US solo enlaza.
(Fuente: US-039 §Happy Path 2º, §Clic en indicador de cola, §Notas de alcance:
el violeta "= en cola" se reserva para futuras vistas de pipeline; aquí el
indicador actúa sobre la fecha bloqueante, no una celda propia para `2d`.)

## D-4. Multi-tenancy y RLS

**Decisión.** La query del use-case filtra **siempre** por `tenant_id` del JWT,
reforzado por **RLS** activo en PostgreSQL (defensa en profundidad). El
`tenant_id` viaja en el payload firmado del JWT (`CLAUDE.md` Multi-tenancy). El
adaptador de lectura establece el contexto de tenant antes de consultar; ninguna
fila de otro tenant es alcanzable aunque el filtro de aplicación fallara.
(Fuente: US-039 §Aislamiento, `CLAUDE.md`.)

## D-5. Arquitectura backend (hexagonal, lectura)

**Decisión.** Caso de uso de lectura `obtener-calendario` en `application/`, con
un **puerto de consulta** (interfaz en `domain/`) implementado por un adaptador
Prisma en `infrastructure/`. El `domain/` no importa Prisma ni NestJS. La
**derivación del color** (D-2) es una función pura de dominio, lo que la hace
unit-testeable sin BD. El controller NestJS expone `GET /calendario`.
(Fuente: `CLAUDE.md` arquitectura hexagonal; hook `no-infra-in-domain`.)

## D-6. Librería de calendario del frontend (negociable)

**Decisión.** El render de mes/semana/día/lista usa una librería de calendario;
la elección es **negociable**: **FullCalendar** (`@fullcalendar/react`) o
**react-big-calendar**. Criterios de decisión para el `frontend-developer`:

- Soporte nativo de las 4 vistas (mes/semana/día/lista/agenda).
- **Responsive mobile-first** real en 390/768/1280 sin romper (regla dura del
  `CLAUDE.md`); la nav lateral del shell colapsa a drawer en `<lg`.
- Theming con los **tokens** de US-000A (colores de estado de reserva).
- Tamaño de bundle y licencia (FullCalendar tiene plugins premium para algunas
  vistas; react-big-calendar es MIT más ligera).

La feature vive en `apps/web/src/features/calendario/` (estilo *Bulletproof
React*: `api/ components/ lib/ model/ pages/` + barrel `index.ts`), con la
derivación de etiqueta de color/sub_estado en `model/`/`lib/`. El cliente HTTP se
**genera** desde el contrato OpenAPI (nunca se edita a mano). El calendario es la
**página de inicio** del slot Calendario del App Shell.
(Fuente: US-039 §Reglas de Negocio; `CLAUDE.md` frontend por dominio + responsive.)

## D-7. Por qué NO hay tests de concurrencia en esta US

**Decisión.** Esta US **no** añade tests de race condition propios. Justificación
explícita de la US (§Concurrencia / Race Conditions): es **lectura pura**, no muta
estado. Las garantías de concurrencia sobre los bloqueos de fecha residen en
**US-040** (quien escribe `FECHA_BLOQUEADA` con `SELECT … FOR UPDATE` +
`UNIQUE(tenant_id, fecha)`), ya implementada y archivada. El calendario refleja el
estado actual de la BD; un stale-read de milisegundos no es un riesgo operativo
para una vista visual. El bloque TDD-RED de esta US cubre, por tanto:

- **Función pura de derivación de color** (D-2): todas las filas de la tabla,
  incluida la exclusión de terminales `2x`/`2y`/`2z` y la herencia verde de
  `evento_en_curso`/`post_evento`.
- **Use-case de agregación**: conteo de cola `enCola`, ausencia de fechas libres
  en la respuesta, y **aislamiento por tenant** (no se filtran datos cross-tenant).
- **No-mutación**: el use-case no escribe `RESERVA` ni `FECHA_BLOQUEADA`.

Sin tests de bloqueo distribuido (prohibido por hook `no-distributed-lock`) ni de
escritura de `FECHA_BLOQUEADA`.

## D-8. Edge cases de UI

- **Mes vacío**: respuesta `fechas: []`; calendario navegable y sin errores
  (US-039 §Mes sin reservas).
- **Fechas pasadas con consulta activa (`2a`/`2b`/`2c`/`2v`)** — caso anómalo: no
  se bloquean a nivel de UI (interacción normal) pero **sí se muestran** coloreadas
  para auditoría (US-039 §Reglas de Validación).
- **Detalle al clic**: el popover usa los campos ya presentes en la respuesta
  agregada (cliente, subEstado, ttlRestante, reservaId) — sin segunda llamada.
