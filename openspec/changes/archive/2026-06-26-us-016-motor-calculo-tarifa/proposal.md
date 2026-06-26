# Change: us-016-motor-calculo-tarifa

## Why

El gestor calcula hoy los presupuestos a mano en Excel (30–60 min cada uno) y sin
ninguna automatización. La US-016 introduce el **motor de cálculo de tarifa** (UC-16):
una función pura, stateless y determinista que, dados `fecha_evento`, `duracion_horas`,
`num_adultos_ninos_mayores4` y `extras`, busca la fila correcta del tarifario del tenant
(temporada × duración × tramo de invitados), suma los extras y devuelve el total con IVA
21% incluido. Es la pieza central que hace posible el "presupuesto en 30 segundos".

Resuelve dos dolores del backlog:
- **D8 — presupuestos manuales**: elimina el cálculo en Excel; el precio es correcto,
  reproducible y congelable desde el primer cálculo. (`US-016 §Contexto`)
- **D9 — sin automatizaciones**: libera al gestor de trabajo repetitivo de cálculo.
  (`US-016 §Contexto`)

Sin este motor, UC-14 (Generar Presupuesto / activar pre-reserva) no puede funcionar:
UC-14 §Flujo paso 4 "El sistema ejecuta el motor de tarifas (UC-16)". (`use-cases.md` UC-14, UC-16)

## What Changes

- **Nueva capability `calculo-tarifa`**: motor de dominio de lectura pura que implementa
  UC-16. No introduce estado nuevo ni muta entidades; solo lee `TARIFA`,
  `TEMPORADA_CALENDARIO` y `EXTRA` del tenant. (`US-016 §Reglas de negocio`)
- **Determinación de temporada** desde `TEMPORADA_CALENDARIO` por el mes de `fecha_evento`
  (mapping canónico de Masia l'Encís: Alta {5–9}, Media {3,4,10,11}, Baja {12,1,2}).
  (`US-016 Paso 1`, `er-diagram.md §3.8`)
- **Búsqueda de TARIFA vigente** por `temporada` × `duracion_horas` (4|8|12) × tramo
  `invitados_min..invitados_max`, con ventana de vigencia (`vigente_desde`/`vigente_hasta`).
  Los 5 tramos del seed son 1-20, 21-25, 26-30, 31-40, 41-50. (`US-016 Paso 2`,
  `er-diagram.md §3.7`, `seed.ts`)
- **Caso > 50 invitados**: el tramo +51 NO tiene fila en el tarifario; el motor devuelve
  `tarifa_a_consultar: true` **sin error**, para que el flujo invocante habilite precio
  manual. (`US-016 Paso 3 / FA-01`, `use-cases.md` UC-16 FA-01)
- **Suma de extras**: por cada `{extra_id, cantidad}` lee `EXTRA.precio_eur` del catálogo del
  tenant (`subtotal = precio_eur × cantidad`). Extras reales del seed: Barbacoa 30€,
  Paellero 30€. (`US-016 Paso 4`, `seed.ts`)
- **Tres errores de dominio**: `TARIFA_NO_CONFIGURADA` (tarifario incompleto, ≤50 invitados),
  `EXTRA_NO_ENCONTRADO` (inexistente, inactivo o cross-tenant vía RLS) y
  `TEMPORADA_NO_CONFIGURADA` (mes sin mapear). (`US-016 §Reglas de negocio`, `§Reglas de Validación`)
- **Esquema de salida canónico unificado** (ver `design.md` D-1): un único contrato de salida
  válido tanto para el caso normal como para `tarifa_a_consultar`.

## Impact

- Specs afectadas: nueva capability **`calculo-tarifa`** (motor de cálculo de tarifa /
  pricing). No modifica `foundation`.
- Datos: ninguno nuevo — reutiliza `TARIFA`, `TEMPORADA_CALENDARIO`, `EXTRA` y `TENANT_SETTINGS`
  ya provisionados por el seed de US-000 (45 tarifas, 12 temporadas, 2 extras).
- Contrato OpenAPI (fase siguiente, `contract-engineer`): expondrá el esquema canónico de salida
  decidido en `design.md`. **Este change no edita `docs/api-spec.yml`.**
- Código (implementación posterior, fuera de este change de spec): módulo de dominio del motor
  de tarifa en `apps/api` (hexagonal: puertos de lectura de `TARIFA`/`TEMPORADA_CALENDARIO`/`EXTRA`).
- Trazabilidad: **US-016**, **UC-16** (invocado por UC-14/UC-15), dolores **D8**/**D9**.
- Fuera de alcance: la congelación de la tarifa en `PRESUPUESTO` (responsabilidad de UC-14/US-014),
  la persistencia de `RESERVA_EXTRA`, y cualquier endpoint/UI (lo aporta el flujo invocante).
- Concurrencia: ninguna propia — el motor es lectura pura; los tests de concurrencia del bloqueo
  de fecha pertenecen a US-014. (`US-016 §Concurrencia`)
