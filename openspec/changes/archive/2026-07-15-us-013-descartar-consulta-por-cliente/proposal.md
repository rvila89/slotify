# Change: us-013-descartar-consulta-por-cliente

## Why

Trazabilidad: **US-013** ("Marcar consulta como descartada por cliente (→ 2.z)"),
**UC-10**, automatización **A17** ("Cliente pulsa 'Salir de la cola' → consulta pasa a
2.z + reordenación de cola"). En el MVP no hay portal de cliente, por lo que A17 se
mapea a una **acción manual del Gestor** ejecutada en nombre del cliente cuando este
comunica su desistimiento.

El pipeline acumula leads en sub-estados de consulta (`2a/2b/2c/2d/2v`) que el cliente
abandona. Hoy no existe una transición explícita que los cierre limpiamente: quedan
fechas bloqueadas innecesariamente (dolor **D4**), posiciones de cola huérfanas (**D13**)
y leads fantasma que distorsionan la visibilidad del pipeline (**D2**). Falta un estado
terminal que signifique **"descartada por el cliente"** distinto de la expiración por TTL
(`2.x`, US-012) y del vaciado de cola al activar pre-reserva (`2.y`, US-014).

US-013 introduce la transición **cualquier sub_estado no terminal (`2a/2b/2c/2d/2v`) →
`2z`** (terminal, inmutable), atómica en una única transacción, con efectos condicionados
por el origen: liberación de la fecha bloqueada cuando aplica, promoción FIFO de la cola
cuando la consulta era bloqueante, o reordenación de la cola cuando la consulta estaba en
ella. Preserva el historial completo (`sub_estado = '2z'`) para análisis de conversión.

## What Changes

- **Capability afectada:** `consultas` (spec-delta con `ADDED Requirements`). Es donde
  ya viven las transiciones `2a/2b/2c/2v`, la mecánica de cola y los seams reutilizados.
- **Nueva transición declarativa** en la máquina de estados: `{consulta, 2a|2b|2c|2d|2v}
  → {consulta, 2z}` (terminal). Se modela como estructura de datos, no `if` dispersos.
- **Efectos por origen** (declarativos, tabla origen→efectos en `design.md`):
  - `2a`: solo marca `2z` (sin FECHA_BLOQUEADA, sin cola).
  - `2b` sin cola: `2z` + `liberarFecha()` (no-op sobre cola).
  - `2b` con cola activa: `2z` + `liberarFecha()` que **dispara la promoción A15**
    (`PromocionColaPort.promoverPrimeroEnCola`, seam existente US-018/US-041).
  - `2c`: `2z` + `liberarFecha()`; NO hay cola posible (se vació al entrar en `2c`).
  - `2d` (en cola): `2z` + salir de la cola (`posicion_cola = NULL`,
    `consulta_bloqueante_id = NULL`) + decremento del resto de la cola; sin liberar fecha.
  - `2v`: `2z` + `liberarFecha()`; si heredó cola desde `2b` → **dispara la promoción A15**.
- **Motivo de descarte opcional** en `RESERVA.notas`; su ausencia no bloquea.
- **AUDIT_LOG**: registro `accion='transicion'`, `entidad='RESERVA'`,
  `datos_anteriores.sub_estado`, `datos_nuevos.sub_estado='2z'`. La liberación de
  FECHA_BLOQUEADA la audita `liberarFecha()` (causa `descarte`); no se duplica.
- **NO** genera email automático (no hay E1-E8 mapeado a esta acción).
- **API (toca, pero se difiere al contract-engineer tras el gate):** hay un endpoint de
  escritura para la transición a `2z` con motivo opcional `{ motivo? }`. La forma REST
  exacta queda como **decisión abierta** en `design.md §Forma del endpoint`; NO se
  evoluciona `docs/api-spec.yml` en esta fase SDD.
- **Frontend (toca):** acción "Marcar como descartada por cliente" en la ficha de la
  RESERVA (botón deshabilitado en estados terminales, motivo opcional). Se implementa
  tras el gate; QA E2E con Playwright aplica.

## Reuso explícito (NO reinventar)

- `liberarFecha()` (US-040/US-041) — primitiva atómica de liberación de FECHA_BLOQUEADA.
  Prohibido Redis/Redlock/locks distribuidos (hook `no-distributed-lock`).
- `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })` (US-018/US-041) — seam de
  promoción FIFO A15; se dispara **exactamente una vez** desde `2b`/`2v` con cola. Se
  **referencia**, no se redefine.
- `bloquearFecha()` (US-040) — re-bloqueo de la promovida; se ejecuta **dentro** de la
  promoción; no se duplica.
- Patrón de **reordenación de cola** (decremento de `posicion_cola`) ya existente para la
  promoción manual (US-019, `consultas/spec.md`).
- Patrón de **guarda de estado terminal** ya existente (US-005 §"Guarda de origen").

## Frontera de diseño (no cruzar)

- **US-014** vacía la cola a `2.y` (A16); US-013 pasa a `2.z`. Distintos terminales.
- **US-011** es descarte específico desde `2v`; US-013 cubre cualquier origen no terminal.
- **US-019** es promoción manual con confirmación destructiva; US-013 desde `2b/2v` con
  cola reutiliza el **mismo seam de promoción automática** al liberar fecha.
- `2.z` = descartada por cliente (distinto de `2.y` descartada por cola y `2.x` expirada).

## Impact

- **Specs:** `openspec/specs/consultas/spec.md` (ADD requirements).
- **Código (tras el gate, fuera de esta fase):** `apps/api` (dominio: transición
  declarativa + servicio de descarte; infraestructura: endpoint + adaptadores existentes
  reutilizados), `apps/web` (acción en la ficha de RESERVA). Contrato OpenAPI + SDK
  generado (dueño: contract-engineer).
- **Entidades:** RESERVA (mutación de `sub_estado`, `posicion_cola`,
  `consulta_bloqueante_id`, `notas`), FECHA_BLOQUEADA (eliminación / re-creación vía
  promoción), AUDIT_LOG (registro de transición).
- **Migraciones de BD:** ninguna nueva (reutiliza modelo y restricciones existentes:
  `UNIQUE(tenant_id, fecha)`, `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola)
  WHERE posicion_cola IS NOT NULL`).
