---
name: slotify-domain
description: Usar cuando necesites el lenguaje ubicuo, las entidades o la máquina de estados de Slotify para nombrar o modelar correctamente.
---
# Slotify — Lenguaje ubicuo (DDD)

## Cuándo usar
Antes de nombrar entidades, campos o estados, o al diseñar lógica de negocio. Garantiza vocabulario consistente.

## Reglas / Pasos
- Slotify es un **SaaS multi-tenant B2B de gestión de espacios para eventos privados** (cliente piloto: Masia l'Encís). **NO es un ATS ni un sistema de contratación.**
- **Agregado raíz: `Reserva`** — recorre toda la máquina de estados; toda la lógica orbita a su alrededor.
- Identificadores de dominio **en español**. Importes en **Decimal** (nunca float).
- `tenant_id` en toda tabla de negocio; RLS activo.

### Entidades clave (17)
- **Tenant** — organización.
- **Usuario** — en MVP, 1 gestor por tenant.
- **Cliente** — quien contrata.
- **Reserva** — agregado raíz.
- **FechaBloqueada** — `UNIQUE(tenant_id, fecha)`; base del bloqueo atómico.
- **Tarifa** — 45 entradas (3 temporadas × 3 duraciones × 5 bandas de invitados).
- **Presupuesto** — versionado, genera PDF, congela la tarifa.
- **Factura** — señal 40%, liquidación 60%, fianza, complementaria.
- **Pago**.
- **ReservaExtra** — precio congelado.
- **FichaOperativa** — relación 1:1 con Reserva.
- **Documento** — polimórfico.
- **Comunicacion** — plantillas E1–E8 + manual.
- **AuditLog**.

### Máquina de estados
`consulta → pre_reserva → reserva_confirmada → evento_en_curso → post_evento → reserva_completada`

Sub-estados de `consulta`:
- `2a` exploratoria · `2b` con fecha · `2c` pendiente invitados · `2d` cola · `2v` visita · `2x`/`2y`/`2z` terminales.

## Patrón de referencia
Para "reservar provisionalmente": transición `consulta → pre_reserva`, que bloquea fecha vía `FechaBloqueada` (ver skill `slotify-context` §bloqueo atómico).

## Errores comunes
- Tratar Slotify como ATS o sistema de contratación.
- Nombres en inglés para identificadores de dominio.
- Usar float para importes en vez de Decimal.
- Modelar transiciones como código disperso en vez de estructura de datos.

## Fuentes
`docs/er-diagram.md`, `docs/data-model.md`, `docs/architecture.md`, `CLAUDE.md`.
