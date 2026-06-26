# Spec Delta — Capability `calculo-tarifa`

> Motor de cálculo de tarifa (pricing). Fuente: US-016, UC-16 (`use-cases.md`),
> `er-diagram.md §3.7–§3.9`, `seed.ts`. Invocado por UC-14/US-014 y UC-15/US-015.
> El motor es de **lectura pura**: no muta entidades.

## ADDED Requirements

### Requirement: Determinación de temporada por el mes de fecha_evento
El motor SHALL (DEBE) determinar la temporada consultando `TEMPORADA_CALENDARIO` del tenant
para el mes de `fecha_evento`. El mapping canónico de Masia l'Encís es Alta = {5,6,7,8,9},
Media = {3,4,10,11} y Baja = {12,1,2}. Si el tenant no tiene mapeada la temporada del mes,
el motor DEBE lanzar `TEMPORADA_NO_CONFIGURADA`.
(Fuente: US-016 Paso 1, §Reglas de Validación; UC-16 Flujo Básico 2; `er-diagram.md §3.8`.)

#### Scenario: Frontera de mes — marzo es temporada media
- **GIVEN** `TEMPORADA_CALENDARIO` del tenant correctamente configurado (12 meses)
- **WHEN** el motor determina la temporada para `fecha_evento = '2026-03-01'` (mes 3)
- **THEN** la temporada resuelta es `'media'` (no `'alta'` ni `'baja'`)

#### Scenario: Frontera de mes — septiembre es temporada alta
- **WHEN** el motor determina la temporada para `fecha_evento = '2026-09-30'` (mes 9)
- **THEN** la temporada resuelta es `'alta'`

#### Scenario: Frontera de mes — diciembre es temporada baja
- **WHEN** el motor determina la temporada para `fecha_evento = '2026-12-15'` (mes 12)
- **THEN** la temporada resuelta es `'baja'`

#### Scenario: Mes sin mapear lanza TEMPORADA_NO_CONFIGURADA
- **GIVEN** un tenant cuyo `TEMPORADA_CALENDARIO` no tiene fila para el mes de `fecha_evento`
- **WHEN** el motor intenta determinar la temporada
- **THEN** lanza el error de dominio `TEMPORADA_NO_CONFIGURADA`
- **AND** no devuelve ningún precio

### Requirement: Búsqueda de TARIFA vigente por temporada × duración × tramo de invitados
El motor SHALL (DEBE) buscar la fila de `TARIFA` del tenant donde `temporada` coincide,
`duracion_horas` coincide (4, 8 o 12), `num_adultos_ninos_mayores4` está en
`invitados_min..invitados_max`, y la tarifa está vigente en `fecha_evento`
(`vigente_desde ≤ fecha_evento` y (`vigente_hasta IS NULL` OR `vigente_hasta ≥ fecha_evento`)).
Los niños menores de 4 años (`num_ninos_menores4`) NO son input del motor y no cuentan para el
tramo. Si no existe `TARIFA` vigente para una combinación válida con `num_adultos_ninos_mayores4 ≤ 50`,
el motor DEBE lanzar `TARIFA_NO_CONFIGURADA` con los parámetros de búsqueda.
(Fuente: US-016 Pasos 2, 5; §Reglas de negocio; UC-16 Flujo Básico 3–4, FA-02; `er-diagram.md §3.7`; `seed.ts`.)

#### Scenario: Happy path — alta, 8h, 40 invitados
- **GIVEN** una `TARIFA` con `temporada='alta'`, `duracion_horas=8`, tramo `31–40`,
  `precio_total_eur=1076`, vigente en 2026; y `TEMPORADA_CALENDARIO` mapea septiembre → alta
- **WHEN** el motor recibe `{ fecha_evento:'2026-09-15', duracion_horas:8, num_adultos_ninos_mayores4:40, extras:[] }`
- **THEN** la `TARIFA` resuelta tiene `precio_total_eur = 1076` y temporada `'alta'`
- **AND** el output incluye su `tarifa_id`

#### Scenario: Distinción de duración 4 vs 8 vs 12 horas
- **GIVEN** `TARIFA` para `temporada='alta'`, tramo `21–25` con precios distintos por duración
  (4h=405€, 8h=785€, 12h=1142€)
- **WHEN** el motor recibe `duracion_horas=4` y `num_adultos_ninos_mayores4=22`
- **THEN** resuelve la tarifa de 4 horas (`405€`), no la de 8 ni la de 12

#### Scenario: Niños menores de 4 años no cuentan para el tramo
- **GIVEN** una reserva con `num_adultos_ninos_mayores4=30` y `num_ninos_menores4=10`
- **WHEN** el motor recibe únicamente `num_adultos_ninos_mayores4=30` (los menores de 4 no se pasan)
- **THEN** busca la `TARIFA` del tramo que incluye 30 invitados, ignorando los 10 menores de 4

#### Scenario: Vigencia — se elige la versión vigente en la fecha
- **GIVEN** `TARIFA_v1` (`vigente_desde='2025-01-01'`, `vigente_hasta='2025-12-31'`, `precio_total_eur=1000`)
  y `TARIFA_v2` (`vigente_desde='2026-01-01'`, `vigente_hasta=null`, `precio_total_eur=1076`)
  para los mismos parámetros
- **WHEN** el motor recibe `fecha_evento='2026-06-15'`
- **THEN** resuelve `precio_total_eur=1076` (la versión vigente en 2026), no la de 2025

#### Scenario: Tarifario incompleto lanza TARIFA_NO_CONFIGURADA
- **GIVEN** un tarifario incompleto al que le falta la fila `temporada='alta'`, `duracion_horas=12`, tramo `41–50`
- **WHEN** el motor busca la tarifa para `num_adultos_ninos_mayores4=45` (≤ 50)
- **THEN** lanza `TARIFA_NO_CONFIGURADA` con detalle `{ temporada:'alta', duracion_horas:12, num_invitados:45 }`

### Requirement: Más de 50 invitados devuelve tarifa a consultar sin error
El motor SHALL (DEBE) devolver `tarifa_a_consultar: true` con los importes a `null` y **sin lanzar
error** cuando `num_adultos_ninos_mayores4 > 50` (el tramo +51 no tiene fila en el tarifario), para
que el flujo invocante (UC-14/UC-15) habilite el precio manual.
(Fuente: US-016 Paso 3, FA-01; UC-16 FA-01; `seed.ts` comentario tramos.)

#### Scenario: 55 invitados devuelve tarifa_a_consultar
- **GIVEN** `num_adultos_ninos_mayores4 = 55`
- **WHEN** el motor procesa los parámetros
- **THEN** devuelve `tarifa_a_consultar: true` con `precio_tarifa_eur=null`, `extras_total_eur=null`,
  `total_eur=null` y `tarifa_id=null`
- **AND** no lanza ningún error

### Requirement: Suma de extras del catálogo del tenant
Por cada `{extra_id, cantidad}` del array de entrada, el motor SHALL (DEBE) leer `EXTRA.precio_eur`
del catálogo del tenant y calcular `subtotal = precio_eur × cantidad`; la suma de subtotales es
`extras_total_eur`. Si un `extra_id` no existe en el catálogo del tenant, está inactivo
(`activo=false`) o pertenece a otro tenant (no visible por RLS), el motor DEBE lanzar
`EXTRA_NO_ENCONTRADO`.
(Fuente: US-016 Paso 4; §Reglas de negocio; §Reglas de Validación; `er-diagram.md §3.9`; `seed.ts`.)

#### Scenario: Extras activos suman al total
- **GIVEN** la TARIFA del happy path (1076€) más `EXTRA 'barbacoa'` (`precio_eur=30`) y
  `EXTRA 'paellero'` (`precio_eur=30`), ambos activos
- **WHEN** el motor recibe `extras:[{extra_id:barbacoa,cantidad:1},{extra_id:paellero,cantidad:1}]`
- **THEN** devuelve `precio_tarifa_eur=1076`, `extras_total_eur=60` y `total_eur=1136`

#### Scenario: Extra inactivo lanza EXTRA_NO_ENCONTRADO
- **GIVEN** `EXTRA 'barbacoa'` con `activo=false`
- **WHEN** el motor recibe `extras:[{extra_id:barbacoa,cantidad:1}]`
- **THEN** lanza `EXTRA_NO_ENCONTRADO` con detalle `{ extra_id:barbacoa, motivo:'inactivo' }`

#### Scenario: Extra de otro tenant lanza EXTRA_NO_ENCONTRADO (RLS)
- **GIVEN** un `extra_id` que pertenece a otro tenant
- **WHEN** el motor busca el `EXTRA` en el catálogo del tenant actual
- **THEN** lanza `EXTRA_NO_ENCONTRADO` (Row-Level Security impide la lectura cross-tenant)

### Requirement: Esquema de salida canónico unificado
El motor SHALL (DEBE) devolver un **único esquema de salida** válido tanto para el caso normal
como para el caso `tarifa_a_consultar`:
`{ temporada, tarifa_a_consultar, precio_tarifa_eur, extras_total_eur, total_eur, tarifa_id }`,
donde `temporada` y `tarifa_a_consultar` están SIEMPRE presentes, y `precio_tarifa_eur`,
`extras_total_eur`, `total_eur` y `tarifa_id` son numéricos/UUID en el caso normal y `null` en el
caso `tarifa_a_consultar`. `total_eur = precio_tarifa_eur + extras_total_eur` (IVA 21% incluido en
`precio_tarifa_eur`). Este esquema unifica la inconsistencia de nombres de la US y será el que use
el contrato OpenAPI. (Fuente: US-016 Paso 6, Paso 3, FA-01; decisión de diseño D-1 de `design.md`.)

#### Scenario: Caso normal expone todos los campos con valores
- **WHEN** el motor calcula una tarifa existente con extras
- **THEN** devuelve `tarifa_a_consultar=false` y `temporada`, `precio_tarifa_eur`,
  `extras_total_eur`, `total_eur` y `tarifa_id` con valores no nulos

#### Scenario: Caso a consultar mantiene el mismo esquema con nulos
- **WHEN** el motor devuelve `tarifa_a_consultar=true` (>50 invitados)
- **THEN** el output conserva el mismo esquema con `precio_tarifa_eur`, `extras_total_eur`,
  `total_eur` y `tarifa_id` a `null`, pero `temporada` presente

### Requirement: Validación de inputs del motor
El motor SHALL (DEBE) validar los inputs antes de calcular: `fecha_evento` válida (no nula, no
pasada al momento de la llamada); `duracion_horas ∈ {4,8,12}`; `num_adultos_ninos_mayores4 ≥ 0`;
y, por cada extra, `extra_id` no nulo y `cantidad ≥ 1`. Cualquier input fuera de estas reglas DEBE
producir un error de validación de input (no un cálculo). (Fuente: US-016 §Reglas de Validación.)

#### Scenario: Duración no permitida es rechazada
- **WHEN** el motor recibe `duracion_horas=6` (fuera de {4,8,12})
- **THEN** lanza un error de validación de input
- **AND** no realiza ninguna búsqueda de tarifa

#### Scenario: Número de invitados negativo es rechazado
- **WHEN** el motor recibe `num_adultos_ninos_mayores4 = -1`
- **THEN** lanza un error de validación de input

#### Scenario: Cantidad de extra menor que 1 es rechazada
- **WHEN** el motor recibe `extras:[{extra_id:barbacoa,cantidad:0}]`
- **THEN** lanza un error de validación de input

#### Scenario: Fecha de evento inválida es rechazada
- **WHEN** el motor recibe `fecha_evento` nula o una fecha pasada
- **THEN** lanza un error de validación de input

### Requirement: Motor stateless, determinista y de lectura pura
El motor SHALL (DEBE) ser stateless y determinista: los mismos inputs producen el mismo output dado
el mismo estado del tarifario, y el cálculo NO PUEDE mutar ninguna entidad (solo lee `TARIFA`,
`TEMPORADA_CALENDARIO` y `EXTRA` del tenant). La congelación de la tarifa es responsabilidad del flujo
invocante (UC-14/US-014), no del motor. (Fuente: US-016 §Reglas de negocio, §Notas de alcance, §Concurrencia.)

#### Scenario: Mismos inputs producen el mismo output sin escribir en BD
- **GIVEN** un estado del tarifario fijo
- **WHEN** el motor se invoca dos veces con los mismos inputs
- **THEN** ambas invocaciones devuelven exactamente el mismo output
- **AND** ninguna fila de `TARIFA`, `TEMPORADA_CALENDARIO`, `EXTRA` ni de otra entidad es modificada
