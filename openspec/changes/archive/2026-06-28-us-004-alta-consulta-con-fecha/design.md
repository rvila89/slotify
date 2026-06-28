# Design — us-004-alta-consulta-con-fecha

> Decisiones técnicas para el alta de consulta **con fecha** (US-004 / UC-03).
> Todo se apoya en código real ya en `master`; se prioriza **DRY + hexagonal** y la
> garantía D4 (anti-doble-reserva) en el motor PostgreSQL. Este documento es el
> corazón del **Gate de revisión humana SDD**: las 8 decisiones quedan abiertas a tu
> OK antes de tocar contrato/TDD/código.

Rutas reales citadas (todas en `apps/api/src/`):
- `reservas/application/alta-consulta.use-case.ts` (use-case US-003)
- `reservas/infrastructure/unidad-de-trabajo.prisma.adapter.ts` (UoW + retry)
- `reservas/domain/bloquear-fecha.service.ts` (plan + servicio US-040)
- `reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts` (tx FOR UPDATE)
- `reservas/domain/maquina-estados.ts` (máquina declarativa)
- `reservas/infrastructure/tenant-settings.prisma.adapter.ts`
- `reservas/infrastructure/sub-estado-consulta.mapper.ts` (`2a`↔`s2a`)
- `tarifas/domain/calculadora-tarifa.service.ts` (motor US-016)
- `prisma/schema.prisma`, `prisma/seed.ts`

---

## D-1. Reutilización del alta de US-003 — MISMO endpoint, ramificación en el use-case

**Decisión (recomendada): un solo `POST /reservas`, con ramificación interna en
`AltaConsultaUseCase`.** No se crea endpoint ni use-case nuevo.

El DTO ya está preparado: `CreateReservaRequestDto.fechaEvento?` existe y está
documentado como *"Si se envía, se crea en sub-estado 2.b con bloqueo blando
(US-004/005)"*. El controller (`alta-consulta.controller.ts`) ya lo ignora hoy
porque el comando no lo propaga.

Plan:
1. Añadir `fechaEvento?: Date` al `AltaConsultaComando` y propagarlo en el controller.
2. En `AltaConsultaUseCase.ejecutar()`, tras la validación de forma:
   - **Sin `fechaEvento`** → ruta US-003 **sin cambios** (entrada `2.a`, ttl NULL,
     sin `FECHA_BLOQUEADA`). Regresión cero.
   - **Con `fechaEvento`** → nueva ruta "alta con fecha" que (a) valida
     `fecha_evento > hoy` (estrictamente futura; rechaza hoy y pasado), (b)
     **determina el sub-estado** (D-3) leyendo el estado de
     la fecha, (c) crea la RESERVA en el sub-estado resuelto, (d) inserta
     `FECHA_BLOQUEADA` solo en `2.b` (D-2), (e) asigna cola solo en `2.d` (D-5).
3. **Extraer** los pasos comunes (find-or-create CLIENTE, crear COMUNICACION E1,
   AUDIT_LOG) a helpers privados reutilizados por ambas ramas (DRY). La E1 gana la
   tarifa estimada (D-4).

Por qué el mismo endpoint: el contrato y la UX son "dar de alta un lead"; la fecha
es un campo opcional del mismo recurso. Un endpoint aparte duplicaría DTO, controller,
validación y wiring sin beneficio. Hexagonal intacto: el use-case sigue dependiendo
solo de puertos.

> **DIVERGENCIA INTENCIONAL APROBADA (Gate 1 — decisión A)**: la ficha US-004 decía
> `fecha_evento ≥ hoy` (permitía **hoy**). **Se implementa `fecha_evento > hoy`
> (estrictamente futura): se rechazan tanto las fechas pasadas como la fecha = hoy**
> con error de validación **400**, sin crear RESERVA ni `FECHA_BLOQUEADA`.
> **Motivo**: alinear la rama de alta-con-fecha con la primitiva de US-040, que debe
> enrutar por la validación de fecha futura existente `validarFechaFutura`, de modo
> que haya **una sola regla de "fecha válida"** en todo el código, consistente con el
> bloqueo (US-040) y la tarifa (US-016), que ya rechazan el mismo día. Por tanto el
> alta SÍ enruta el bloqueo por `BloquearFechaService.validarFechaFutura` (ver D-2,
> que se actualiza en consecuencia). Esta divergencia respecto a la letra de la ficha
> US-004 quedó **aprobada por el humano en el Gate 1**.

---

## D-2. Integración con la primitiva de bloqueo de US-040 — reutilizar el plan puro + ejecutar dentro de la UoW del alta

**Problema de atomicidad**: la US exige que *"exactamente una transacción tiene éxito
(RESERVA en 2.b + FECHA_BLOQUEADA insertada)"*. Hoy hay **dos** transacciones
separadas: el alta abre la suya (`UnidadDeTrabajoPrismaAdapter`) y
`FechaBloqueadaPrismaAdapter.bloquear()` abre **otra** `$transaction` propia. Crear
la RESERVA `2.b` en una y el bloqueo en otra rompería la atomicidad (estado
intermedio: RESERVA en 2.b sin bloqueo, o doble commit).

**Firma real del puerto (US-040)**:
```ts
// reservas/domain/bloquear-fecha.service.ts
interface FechaBloqueadaRepositoryPort {
  bloquear(params: { tenantId: string; fecha: Date; reservaId: string; plan: PlanBloqueo })
    : Promise<FechaBloqueadaResultado>;
}
// Función pura del mapa fase→plan:
resolverPlanBloqueo({ fase: '2.b', ahora, settings, visitaProgramadaFecha? }): PlanBloqueo
//   → { modo: 'insert', tipo: 'blando', ttl: now()+settings.ttlConsultaDias }
```

**Decisión (recomendada): reutilización real sin duplicar SQL.**
1. **Reutilizar la función pura** `resolverPlanBloqueo({ fase: '2.b', ahora, settings })`
   (dominio, ya existe) para obtener `{ insert, blando, ttl }`. Los `settings` salen
   del `TenantSettingsPort` existente (D-7).
2. **Ejecutar el INSERT dentro de la transacción del alta** (no en otra). Para no
   duplicar el `SELECT … FOR UPDATE` + INSERT + traducción `P2002`, se **refactoriza
   `FechaBloqueadaPrismaAdapter`** extrayendo su núcleo a un método que acepte el
   `tx` (cliente transaccional): p. ej. `bloquearEnTx(tx, { tenantId, fecha,
   reservaId, plan })`. El `bloquear()` público de US-040 pasa a ser un wrapper que
   abre su `$transaction` y delega en `bloquearEnTx` → **el comportamiento y el
   contrato de US-040 quedan idénticos** (cero regresión), y el alta llama a
   `bloquearEnTx(tx, …)` con su propio `tx`.
3. La UoW del alta expone un nuevo repo tx-bound (junto a `clientes`/`reservas`/…)
   que envuelve `bloquearEnTx`. Así RESERVA `2.b` + `FECHA_BLOQUEADA` viven en **una
   única transacción** con el mismo `fijarTenant` (RLS).

La validación de fecha **se unifica con `validarFechaFutura`** (estrictamente futura,
`> hoy`), coherente con la decisión A del Gate 1 (D-1): el alta enruta por esa misma
regla, rechazando hoy y pasado con 400 antes de tocar la transacción. No se reutiliza
`BloquearFechaService.ejecutar()` completo porque abre su propia transacción vía el
adapter (rompería la atomicidad RESERVA `2.b` + `FECHA_BLOQUEADA`). Se reutiliza lo
que importa: **la validación `validarFechaFutura`, el mapa de plan puro y el SQL
atómico del adapter**, sin copiar ni una línea de la lógica FOR UPDATE/P2002.

---

## D-3. Función de determinación de sub-estado — en la máquina de estados declarativa

**Decisión**: extender `maquina-estados.ts` (que hoy solo modela la entrada inicial
`2.a`) con (a) las nuevas entradas iniciales `2.b` y `2.d`, y (b) una **tabla
declarativa** estado-de-la-fecha → resultado del alta. Nada de `if/else` disperso
(skill `state-machine`).

Estructura propuesta (dominio puro, sin infra):
```ts
type AccionAlta = 'bloquear' | 'encolar' | 'exploratoria';

interface ResultadoAlta {
  subEstado: '2b' | '2d' | '2a';
  accion: AccionAlta; // bloquear→INSERT FECHA_BLOQUEADA; encolar→posicion_cola; exploratoria→nada
}

// Estado de la fecha visto por el alta:
type EstadoFecha =
  | { tipo: 'libre' }
  | { tipo: 'bloqueada'; subEstadoBloqueante: SubEstadoConsulta | null; estadoBloqueante: EstadoReserva };

// Tabla declarativa (datos, no código):
const REGLAS_ALTA_CON_FECHA = [
  { cuando: 'libre',                         resultado: { subEstado: '2b', accion: 'bloquear' } },
  { cuando: 'bloqueada-por-2b',              resultado: { subEstado: '2d', accion: 'encolar' } },
  { cuando: 'bloqueada-por-2c|2v|pre|conf+', resultado: { subEstado: '2a', accion: 'exploratoria' } },
] as const;

const determinarAltaConFecha = (estado: EstadoFecha): ResultadoAlta => /* lookup en la tabla */;
```

- "libre" = no hay fila activa en `FECHA_BLOQUEADA` para `(tenant, fecha)`.
- "bloqueada-por-2b" = la fila apunta a una RESERVA cuyo `sub_estado = '2b'`.
- el resto de estados bloqueantes (`2c`, `2v`, `pre_reserva`, `reserva_confirmada` y
  posteriores) → `2.a`.

Además se añade a `ENTRADAS_INICIALES` las entradas `{consulta, 2b}` y
`{consulta, 2d}` para que `esEntradaInicialValida` las acepte. El mapeo `2b/2d ↔
s2b/s2d` ya lo cubre `sub-estado-consulta.mapper.ts` (prefijo `s`), sin migración.

La **re-derivación en el reintento** (D-6) usa esta misma función: tras un `P2002`
en el INSERT de `2.b`, al reabrir la transacción la fecha ya está "bloqueada-por-2b"
→ la tabla devuelve `2.d`. Una sola fuente de verdad.

---

## D-4. Integración con el motor de tarifa US-016 — puerto desde reservas, tolerante a faltas

**Firma real (US-016)**:
```ts
// tarifas/domain/calculadora-tarifa.service.ts (exportado por TarifasModule)
calcular(
  input: { fechaEvento: Date; duracionHoras: number; numAdultosNinosMayores4: number; extras: {extraId,cantidad}[] },
  tenantId: string,
): Promise<CalculoTarifaResultado> // { temporada, tarifaAConsultar, precioTarifaEur, extrasTotalEur, totalEur, tarifaId }
```

**Decisión**: `ReservasModule` importa `TarifasModule` (ya `exports:
[CalculadoraTarifaService]`). El alta depende de un nuevo puerto de dominio
`TarifaEstimadaPort` (token Symbol) cuyo adaptador envuelve
`CalculadoraTarifaService.calcular(...)`. Hexagonal intacto: el use-case no conoce
`tarifas`, solo el puerto.

Reglas de invocación (E1):
- Se llama **solo si** hay `fecha_evento` **y** `num_adultos_ninos_mayores4` **y**
  `duracion_horas` (los tres presentes). `extras` = `[]` en el alta (aún no hay
  catálogo elegido).
- **Si faltan invitados u horas** → **no se llama**; E1 sale con el *dossier general
  sin precio* (`§FA solo fecha sin datos de tarifa`).
- **Tolerancia a errores**: el motor puede lanzar `TEMPORADA_NO_CONFIGURADA`,
  `TARIFA_NO_CONFIGURADA` o, si `>50` invitados, devolver `tarifa_a_consultar=true`.
  En el contexto de E1 estos casos **no rompen el alta**: se capturan/degradan a
  "E1 sin precio". El alta (RESERVA + bloqueo + cola) ya está comprometida; la
  tarifa es **decorativa** de E1, nunca un bloqueante.
- **Día natural**: el motor exige fecha estrictamente futura (rechaza el mismo día).
  Coherente con D-1 (decisión A del Gate 1): el alta ya rechaza `fecha = hoy` y el
  pasado con 400 **antes** de llegar al cálculo, por lo que el motor nunca recibe el
  mismo día. La tolerancia a faltas/errores de tarifa se mantiene para los casos en
  que el cálculo no sea posible por otros motivos (temporada/tarifa no configurada).

La tarifa estimada **no** se persiste como importe congelado de la RESERVA (eso es
UC-14); solo enriquece el cuerpo de la COMUNICACION E1.

---

## D-5. `posicion_cola` atómica — serialización por la fila bloqueante + UNIQUE parcial (defensa)

**Riesgo**: `MAX(posicion_cola)+1` tiene la misma carrera que el `codigo` de US-003
(dos altas `2.d` concurrentes leen el mismo MAX → misma posición). Hoy **no hay
UNIQUE** sobre la cola: solo `@@index([tenantId, consultaBloqueanteId,
posicionCola])` (no único). Sin distributed locks (regla dura del proyecto).

**Decisión (recomendada): serializar por la fila de `FECHA_BLOQUEADA` bloqueante.**
Toda alta `2.d` para `(tenant, fecha)` ocurre cuando esa fecha **ya está bloqueada**
por la consulta `2.b` bloqueante. Dentro de la transacción del alta:
1. `SELECT … FOR UPDATE` sobre la fila `fecha_bloqueada` de `(tenant, fecha)` →
   adquiere el lock de **una sola fila** que todos los `2.d` de esa fecha comparten →
   se serializan (no distribuido; puro PostgreSQL, igual que US-040/US-041).
2. Con el lock tomado, `MAX(posicion_cola)+1` de las RESERVA `2.d` con
   `consulta_bloqueante_id` = bloqueante → INSERT de la RESERVA `2.d`.
3. Liberación del lock al COMMIT. Dos `2.d` concurrentes obtienen `1` y `2`, nunca dos
   `1`.

**Defensa en profundidad (migración aditiva recomendada, D-8)**: índice **UNIQUE
parcial** `(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS
NOT NULL`. Si por cualquier vía dos posiciones colisionaran, el motor lo rechaza con
`P2002` y se reaprovecha el **retry-on-conflict** ya existente en
`UnidadDeTrabajoPrismaAdapter.ejecutar()` (hoy solo reintenta el `codigo`; se
**generaliza** `esColisionCodigo` para reconocer también la colisión de
`posicion_cola`). Es el mismo patrón del proyecto: unicidad en BD + reintento.

---

## D-6. Concurrencia D4 (lo más crítico) — catch `UNIQUE` → recrear como `2.d`

**Confirmado**: la estrategia es **catch de la violación `UNIQUE(tenant_id, fecha)`
→ reintento ramificando a `2.d`**, apoyada en `UNIQUE(tenant_id, fecha)` (US-040) +
`SELECT … FOR UPDATE`.

Secuencia ante dos altas simultáneas sobre `(tenant, fecha)` **libre**:
1. Ambas determinan `libre` → ambas intentan rama `2.b` (RESERVA `2b` + INSERT
   `FECHA_BLOQUEADA`).
2. El motor serializa el INSERT de `FECHA_BLOQUEADA`: **una** hace COMMIT (RESERVA
   `2b` + bloqueo). La otra recibe `P2002` → `FechaYaBloqueadaError`; PostgreSQL
   aborta su transacción.
3. La perdedora **reabre la transacción** (mecánica de reintento ya existente en la
   UoW; el `P2002` aborta la tx en curso, hay que reabrir). Al reabrir, **re-determina
   el sub-estado** (D-3): la fecha ya está "bloqueada-por-2b" → resultado `2.d`. Crea
   la RESERVA `2.d` con `posicion_cola=1` y `consulta_bloqueante_id` = la **ganadora**
   (leída de la fila `FECHA_BLOQUEADA` ya commit). Sin doble bloqueo (D4 eliminado).

La garantía es **determinista y vive en el motor de BD**, no en lógica aplicativa.
Implicación de implementación: el reintento debe **re-evaluar** la rama (no repetir
ciegamente `2.b`); por eso la determinación del sub-estado (D-3) y la lectura del
estado de la fecha ocurren **dentro** del cuerpo transaccional reintentado, no antes.

**Cobertura en TDD-RED (skill `concurrency-locking`, tests REALES, no mocks)**:
- 2 workers concurrentes, misma `(tenant, fecha)` libre → exactamente **1** RESERVA
  `2b` + 1 `FECHA_BLOQUEADA`, **1** RESERVA `2d` con `posicion_cola=1` y
  `consulta_bloqueante_id` = la `2b`. 0 dobles bloqueos.
- N workers (p. ej. 5) → 1×`2b` + (N-1)×`2d` con posiciones `1..N-1` **únicas y
  contiguas** (valida D-5).
- Estos tests usan conexiones/transacciones reales contra PostgreSQL (mismo enfoque
  que los de US-040/US-041).

---

## D-7. `TENANT_SETTINGS.ttl_consulta_dias` — existe; "default 3" vive en el seed

**Estado real**:
- `schema.prisma:199` → `ttlConsultaDias Int @map("ttl_consulta_dias")`: columna
  **NOT NULL sin `@default`** en BD (confirmado en
  `migrations/20260619190625_init/migration.sql:81` → `"ttl_consulta_dias" INTEGER
  NOT NULL`).
- El **valor 3 por defecto** se aplica en `prisma/seed.ts:98` (`ttlConsultaDias: 3`),
  **no** es un default de columna. Es decir: cada tenant **siempre** tiene un valor
  (NOT NULL), sembrado a 3 por convención de negocio.
- Ya se lee vía `TenantSettingsPrismaAdapter.obtener()` →
  `{ ttlConsultaDias, ttlPrereservaDias }`, reutilizado tal cual por el alta.

**Conclusión**: existe y es usable; **no requiere migración**. El "default 3" de la
US se honra por el seed, no por el schema (se reporta para evitar el supuesto erróneo
de un `@default(3)` a nivel de columna).

---

## D-8. Migración Prisma — columnas presentes; migración aditiva de cola APROBADA (Gate 1 — decisión B)

**Estado real del schema** (`schema.prisma`, modelo `Reserva` líneas 262-315 y
`FechaBloqueada` 321-335):
- `posicion_cola` → `Reserva.posicionCola Int? @map("posicion_cola")` ✅
- `consulta_bloqueante_id` → `Reserva.consultaBloqueanteId String?
  @map("consulta_bloqueante_id")` ✅ + self-relation `ColaEspera`
  (`consultaBloqueante`/`enCola`) ✅ + `@@index([tenantId, consultaBloqueanteId,
  posicionCola])` ✅
- `tipo_bloqueo` → `FechaBloqueada.tipoBloqueo TipoBloqueo @map("tipo_bloqueo")` ✅
- `ttl_expiracion` → presente en `Reserva.ttlExpiracion` y
  `FechaBloqueada.ttlExpiracion` ✅
- `UNIQUE(tenant_id, fecha)` en `FechaBloqueada` ✅ (garantía D4, ya en US-040)
- sub-estados `s2b`/`s2d` ya en el enum `SubEstadoConsulta` ✅

**Conclusión**: **NO hace falta migración para columnas ni enums** — todo el modelo
de cola/bloqueo está ya creado por US-000/US-040.

**Única migración (aditiva, APROBADA en el Gate 1 — decisión B)**: índice
**UNIQUE parcial** para la unicidad de la cola del sub-estado `2.d` (D-5):
```sql
CREATE UNIQUE INDEX reserva_cola_posicion_key
  ON reserva (tenant_id, consulta_bloqueante_id, posicion_cola)
  WHERE posicion_cola IS NOT NULL;
```
Es aditiva y de bajo riesgo (solo afecta filas `2.d`). **El humano la aprobó como
defensa en profundidad**: la atomicidad principal la da la serialización del
`SELECT … FOR UPDATE` sobre la fila bloqueante (D-5); el índice es la red de
seguridad/defensa-en-profundidad ante cualquier colisión de `posicion_cola`.
**Estado: APROBADA/aplicable.**

---

## Resumen de decisiones para el Gate

| # | Decisión | Resolución (Gate 1) | ¿Migración? |
|---|----------|---------------------|-------------|
| D-1 | Endpoint/ramificación + validación de fecha | Mismo `POST /reservas`, branch en use-case; **validación `> hoy` (estrictamente futura), rechaza hoy y pasado con 400** (divergencia intencional de la ficha, APROBADA) | No |
| D-2 | Bloqueo US-040 | Reusar `validarFechaFutura` + `resolverPlanBloqueo` + `bloquearEnTx(tx,…)` en la UoW del alta | No |
| D-3 | Sub-estado | Tabla declarativa en `maquina-estados.ts` + nuevas entradas iniciales | No |
| D-4 | Tarifa US-016 | Puerto a `CalculadoraTarifaService`, tolerante a faltas/errores | No |
| D-5 | `posicion_cola` | `SELECT FOR UPDATE` sobre fila bloqueante + UNIQUE parcial + retry | Aditiva (APROBADA) |
| D-6 | Concurrencia D4 | catch `UNIQUE(tenant,fecha)` → re-derivar a `2.d`; tests reales | No |
| D-7 | `ttl_consulta_dias` | Existe (NOT NULL); default 3 en seed, no en columna | No |
| D-8 | Migración | Columnas presentes; índice UNIQUE parcial de cola **APROBADO** | Aditiva (APROBADA) |
