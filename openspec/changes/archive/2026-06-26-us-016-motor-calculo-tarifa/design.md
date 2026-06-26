# Design — us-016-motor-calculo-tarifa

## Context

El motor de tarifa (UC-16) es una función de soporte invocada por UC-14/US-014 y
UC-15/US-015. La US-016 es la fuente de verdad y sus criterios BDD acaban de alinearse
con las tarifas reales del dossier de Masia l'Encís ya provisionadas en
`apps/api/prisma/seed.ts` (45 tarifas = 3 temporadas × 3 duraciones × 5 tramos;
extras Barbacoa 30€ y Paellero 30€). Este documento fija las decisiones técnicas no
triviales y, sobre todo, **resuelve la inconsistencia de nombres del output** de la US.

## D-1. Esquema de salida canónico (DECISIÓN CLAVE)

La US-016 describe el output con **nombres de campo inconsistentes** entre secciones:

| Origen en la US | Esquema descrito |
|-----------------|------------------|
| Paso 6 (caso normal) | `{ temporada, precio_tarifa_eur, extras_total_eur, total_eur, tarifa_id }` |
| Paso 3 (caso >50) | `{ tarifa_a_consultar: true, precio_total_eur: null, extras_total: null }` |
| FA-01 (caso >50) | `{ tarifa_a_consultar: true, precio_total_eur: null, extras_total_eur: null, total_eur: null }` |

Discrepancias: `precio_tarifa_eur` vs `precio_total_eur`; `extras_total` vs `extras_total_eur`;
el caso normal omite `tarifa_a_consultar`; el caso >50 omite `tarifa_id`.

**Decisión**: se UNIFICA a un **único esquema canónico** válido para ambos casos:

```jsonc
{
  "temporada":          "alta" | "media" | "baja",   // SIEMPRE presente
  "tarifa_a_consultar": boolean,                       // SIEMPRE presente
  "precio_tarifa_eur":  number | null,                 // null si a_consultar
  "extras_total_eur":   number | null,                 // null si a_consultar
  "total_eur":          number | null,                 // null si a_consultar
  "tarifa_id":          string(uuid) | null            // null si a_consultar
}
```

Reglas del esquema:
- `temporada` y `tarifa_a_consultar` están **siempre** presentes (la temporada se determina
  antes del chequeo de >50, así que es conocida incluso en el caso a consultar).
- En el **caso normal**: `tarifa_a_consultar=false` y los cuatro campos restantes con valor.
  `total_eur = precio_tarifa_eur + extras_total_eur`, con IVA 21% ya incluido en `precio_tarifa_eur`.
- En el **caso `tarifa_a_consultar`** (>50 invitados): `tarifa_a_consultar=true` y
  `precio_tarifa_eur`, `extras_total_eur`, `total_eur`, `tarifa_id` a `null`.

**Justificación**:
1. **Un solo tipo de retorno** facilita el tipado en TypeScript (un único `interface`/DTO),
   el contrato OpenAPI (un único schema con campos nullables) y el SDK generado, evitando
   uniones discriminadas innecesarias y ramas frágiles en el frontend.
2. Se conserva `precio_tarifa_eur` (no `precio_total_eur`) porque es el nombre usado por el
   **Paso 6 y los tres escenarios del happy path/extras** de la US (mayoría), y porque
   `precio_total_eur` es el nombre de la **columna de la entidad `TARIFA`** (`er-diagram.md §3.7`):
   reutilizarlo en el output crearía ambigüedad entre "precio de la fila TARIFA" y "salida del motor".
   Mantenerlos distintos (`precio_total_eur` = columna BD; `precio_tarifa_eur` = output del motor) es
   más claro.
3. `extras_total_eur` (sufijo `_eur` consistente con el resto de campos monetarios) frente a
   `extras_total`, que aparece una sola vez y rompe la convención.
4. `tarifa_a_consultar` siempre presente como booleano explícito evita que el invocante tenga
   que inferir el caso por ausencia de campos.
5. `tarifa_id` siempre presente (null en a_consultar) permite al presupuesto registrar qué fila
   de `TARIFA` se usó cuando aplica, sin cambiar la forma del objeto.

**Alcance de la decisión**: NO se modifica el `.md` de la US (queda como fuente de la intención de
negocio); esta decisión queda registrada aquí. **El contrato OpenAPI (fase siguiente, dueño
`contract-engineer`) DEBE usar este esquema canónico**, y los tests TDD se escriben contra él.

## D-2. Motor de dominio puro, hexagonal

- El motor vive en `domain/` y es **lectura pura, stateless y determinista**: no importa
  `@nestjs`, Prisma ni infraestructura (hook `no-infra-in-domain`). No muta ninguna entidad.
- La lectura de datos se hace por **puertos (interfaces) en dominio**, implementados por adaptadores
  Prisma en infraestructura:
  - `TarifaRepositoryPort` — buscar `TARIFA` vigente por `(tenantId, temporada, duracion_horas, num_invitados, fecha_evento)`.
  - `TemporadaCalendarioPort` — resolver temporada por `(tenantId, mes)`.
  - `ExtraRepositoryPort` — leer `EXTRA` activo por `(tenantId, extra_id)`.
- El motor recibe el `tenant_id` del contexto (no de inputs de usuario) — ver D-4.

## D-3. Tres errores de dominio explícitos

Errores tipados del dominio (no genéricos), en español, con payload de diagnóstico:
- `TARIFA_NO_CONFIGURADA` → `{ temporada, duracion_horas, num_invitados }` (tarifario incompleto, ≤50).
- `EXTRA_NO_ENCONTRADO` → `{ extra_id, motivo }` (`inexistente` | `inactivo` | cross-tenant por RLS).
- `TEMPORADA_NO_CONFIGURADA` → `{ mes }` (mes sin mapear en `TEMPORADA_CALENDARIO`).

El caso >50 invitados **NO es error**: es un resultado normal (`tarifa_a_consultar=true`).
La capa de aplicación/HTTP traducirá estos errores a códigos OpenAPI en la fase de contrato.

## D-4. Multi-tenancy y RLS

- Todas las lecturas filtran por `tenant_id` (del JWT / contexto de petición), nunca por input.
- El aislamiento cross-tenant de `EXTRA` se apoya en **Row-Level Security**: un `extra_id` de otro
  tenant simplemente no es visible y se traduce en `EXTRA_NO_ENCONTRADO`, sin fuga de existencia.
- Importes en `Decimal` (convención del proyecto); el output expone números en EUR ya redondeados a
  céntimos según la tarifa (IVA incluido).

## D-5. Orden de evaluación del motor

1. Validar inputs (D-1 reglas de validación) → error de validación si falla.
2. Determinar temporada (`TEMPORADA_CALENDARIO`) → `TEMPORADA_NO_CONFIGURADA` si falta el mes.
3. Si `num_adultos_ninos_mayores4 > 50` → retorno `tarifa_a_consultar=true` (temporada ya conocida),
   sin buscar tarifa ni sumar extras.
4. Buscar `TARIFA` vigente → `TARIFA_NO_CONFIGURADA` si no existe (≤50).
5. Sumar extras (`EXTRA`) → `EXTRA_NO_ENCONTRADO` si alguno no es válido.
6. Componer el output canónico (D-1).

> Decisión de orden: la temporada se determina **antes** del corte por >50 para que el output a
> consultar pueda incluir `temporada`. Los extras solo se evalúan en el caso normal (en el caso a
> consultar el precio lo fija el gestor manualmente, junto con sus extras).

## Riesgos / Trade-offs

- **Determinismo vs estado del catálogo**: el motor devuelve precios *actuales*; si la tarifa cambia
  después, el presupuesto ya congelado no se recalcula. La congelación es de UC-14/US-014, no del motor.
- **Tramo +51 sin fila**: se modela como ausencia intencional de TARIFA, no como error; el chequeo
  `>50` debe ir antes de la búsqueda para no confundirlo con `TARIFA_NO_CONFIGURADA`.

## Pendiente / fuera de alcance

- Endpoint/DTO HTTP y su esquema OpenAPI (fase de contrato, `contract-engineer`, usando D-1).
- Persistencia de `RESERVA_EXTRA` y marca `PRESUPUESTO.tarifa_congelada` (US-014).
- Cálculo de "tarifa estimada" pre-presupuesto (UC-03/US-004): comparte este mismo motor.
