# Spec Delta — Capability `presupuestos`

> **reserva-viva-edicion-recalculo-ficha** — Al recalcular el precio dentro de la ventana viva
> (ver delta `reserva-viva`), el sistema genera una NUEVA versión de PRESUPUESTO "de
> modificación" y la reenvía al cliente. A diferencia del presupuesto normal de `pre_reserva`
> (que reparte el total en 40 % señal / 60 % liquidación), el presupuesto de modificación NO
> vuelve a aplicar el 40 %: la señal ya está cobrada y es un importe FIJO. Muestra "Pago inicial
> ya realizado" (= `RESERVA.importe_senal` congelado) y "Liquidación restante"
> (= `nuevo_total − importe_senal`). Reutiliza el patrón de versionado inmutable + reenvío E2 de
> `EditarPresupuestoUseCase` (`version = MAX+1`, reintento acotado ante `P2002`), y el motor de
> tarifa de US-016 con el fallback `tarifa_a_consultar` (>50 o sin tarifa configurada).
>
> Fuente: petición de usuario; `US-015` edición/reenvío de presupuesto (versionado, E2);
> `US-016` motor de tarifa y `tarifa_a_consultar`; `editar-presupuesto.use-case.ts`;
> `calculadora-tarifa.service.ts`; `er-diagram.md §3.6 RESERVA` importes, `§PRESUPUESTO`.

## ADDED Requirements

### Requirement: Presupuesto de modificación tras confirmar (pago inicial fijo + liquidación restante)

El sistema SHALL (DEBE), cuando se recalcula el precio de una RESERVA dentro de la ventana viva
por un cambio de aforo o duración, crear una **nueva versión de PRESUPUESTO** (`version =
MAX(version) + 1`, fila inmutable; las versiones anteriores persisten como historial) marcada
como presupuesto **de modificación** y **reenviarla** al cliente (registro de la COMUNICACION de
reenvío + PDF), en la misma transacción del recálculo. El nuevo TOTAL se calcula con
`CalculadoraTarifaService` (temporada × duración × tramo por `numAdultosNinosMayores4` + extras
VIGENTES de RESERVA_EXTRA con `factura_id IS NULL`). A diferencia del presupuesto de
`pre_reserva`, el presupuesto de modificación **NO** reparte el nuevo total en 40 %/60 %: expone
dos importes: **"Pago inicial ya realizado"** = `RESERVA.importe_senal` congelado (importe FIJO,
NO recalculado sobre el nuevo total) y **"Liquidación restante"** = `nuevo_total −
importe_senal`. El caso `> 50` invitados o sin TARIFA configurada resuelve a
**`tarifa_a_consultar`** con TOTAL manual (mismo fallback del flujo de presupuesto), en cuyo caso
el restante se deriva del total manual introducido. El versionado usa el reintento acotado ante
`P2002` sobre `@@unique([reservaId, version])` (sin locks distribuidos). (Fuente: petición de
usuario; `US-015` versionado + reenvío; `US-016` `tarifa_a_consultar`; `editar-presupuesto.
use-case.ts`; `er-diagram.md §PRESUPUESTO`.)

#### Scenario: Aumentar invitados genera un presupuesto de modificación con restante actualizado

- **GIVEN** una RESERVA en la ventana viva con `importe_total = 3000,00`, `importe_senal =
  1200,00` (fijo) e `importe_liquidacion = 1800,00`, y una tarifa configurada
- **WHEN** el Gestor sube el aforo y el nuevo total calculado es `3600,00`
- **THEN** el sistema crea una nueva versión de PRESUPUESTO de modificación con total `3600,00`
- **AND** el presupuesto muestra "Pago inicial ya realizado" = `1200,00` (sin recalcular el
  40 %) y "Liquidación restante" = `2400,00` (= `3600,00 − 1200,00`)
- **AND** reenvía el presupuesto de modificación al cliente

#### Scenario: Reducir la duración baja el total y el restante

- **GIVEN** una RESERVA en la ventana viva con `importe_total = 3600,00` e `importe_senal =
  1200,00`
- **WHEN** el Gestor reduce `duracionHoras` y el nuevo total calculado es `3000,00`
- **THEN** la nueva versión de PRESUPUESTO muestra "Pago inicial ya realizado" = `1200,00` y
  "Liquidación restante" = `1800,00`

#### Scenario: Más de 50 invitados resuelve a tarifa a consultar con total manual

- **GIVEN** una RESERVA en la ventana viva
- **WHEN** el Gestor sube `numAdultosNinosMayores4` a `60` (> 50)
- **THEN** el motor de tarifa devuelve `tarifa_a_consultar` y el sistema exige un TOTAL manual
- **AND** con el total manual introducido, el restante = `total_manual − importe_senal` y se
  genera el presupuesto de modificación

#### Scenario: La señal NO se recalcula sobre el nuevo total

- **GIVEN** una RESERVA con `importe_senal = 1200,00` (40 % de un total original de `3000,00`)
- **WHEN** el nuevo total pasa a `3600,00`
- **THEN** "Pago inicial ya realizado" sigue siendo `1200,00` (NO se recalcula como 40 % de
  `3600,00`)
