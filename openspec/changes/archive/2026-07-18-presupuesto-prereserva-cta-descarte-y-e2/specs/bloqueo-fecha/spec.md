# Spec Delta — Capability `bloqueo-fecha`

> **Workstream B (feature)** — El descarte manual de una pre-reserva (capability `consultas`,
> `R-DESCARTE-PRERESERVA`) es un **invocante más** de la función canónica `liberarFecha()`.
> Este delta AÑADE un requisito que declara explícitamente ese invocante y su comportamiento
> (liberación por la única vía canónica + disparo de la promoción de cola en la misma
> transacción), SIN reescribir los requisitos vivos de liberación de US-041 (que definen el
> DELETE serializado, la idempotencia, el seam de promoción US-018 y el exactamente-una-vez).
>
> Fuente: workstream B del change; spec viva `bloqueo-fecha` ("Liberación atómica vía DELETE
> serializado en transacción", "Disparo de la promoción de cola tras liberar (seam US-018)",
> "Exactamente-una-vez en la promoción ante liberaciones concurrentes"); `CLAUDE.md §Regla
> crítica`; `descartar-consulta-uow.prisma.adapter.ts`.

## ADDED Requirements

### Requirement: El descarte manual de una pre-reserva libera su fecha por la única función canónica

El sistema SHALL (DEBE), cuando el Gestor descarta manualmente una RESERVA en `pre_reserva`
(capability `consultas`), liberar su `FECHA_BLOQUEADA` invocando **exclusivamente** la función
canónica `liberarFecha()` —la **única** vía de mutación de liberación (regla dura: nunca inline
ni por otra vía)— **dentro de la misma transacción atómica** del descarte, que serializa el
acceso con `SELECT … FOR UPDATE` y NO usa Redis/Redlock ni ningún lock distribuido. Esa
liberación DEBE reutilizar el comportamiento vivo de US-041: el DELETE serializado idempotente y
el **disparo del seam de promoción de cola** (`PromocionColaPort`, US-018) **exactamente una
vez** cuando existe cola activa para la fecha. El descarte NO introduce una segunda forma de
liberar ni de promover: reutiliza el mismo seam que el descarte de consulta (US-013) y el
barrido de TTL. (Fuente: workstream B; `descartar-consulta-uow.prisma.adapter.ts`; spec viva
`bloqueo-fecha` "Liberación atómica…", "Disparo de la promoción de cola tras liberar";
`CLAUDE.md §Regla crítica`.)

#### Scenario: El descarte de pre-reserva libera vía liberarFecha() en la misma transacción

- **GIVEN** una RESERVA en `pre_reserva` con su `FECHA_BLOQUEADA` firme para `(T, D)`
- **WHEN** el Gestor descarta la pre-reserva
- **THEN** la fila de `FECHA_BLOQUEADA` de `(T, D)` se elimina invocando `liberarFecha()` dentro
  de la misma transacción del descarte
- **AND** la liberación no usa ningún lock distribuido (solo `SELECT … FOR UPDATE` de PostgreSQL)

#### Scenario: El descarte con cola dispara la promoción exactamente una vez

- **GIVEN** una RESERVA en `pre_reserva` cuya fecha tiene cola activa (`RESERVA` en `2.d`)
- **WHEN** el Gestor descarta la pre-reserva y `liberarFecha()` elimina la fila
- **THEN** el `PromocionColaPort` (seam US-018) se invoca exactamente una vez para esa fecha
- **AND** la reordenación y la notificación quedan delegadas a la mecánica de US-018 (no se
  reimplementan aquí)
