# Spec-delta: condiciones-idioma-e2-firma-banner (capability `presupuestos`)

## MODIFIED Requirements

### Requirement: Confirmar presupuesto requiere condicions particulars configuradas

El sistema SHALL (DEBE) verificar que el tenant tiene condicions particulars configuradas
**antes** de iniciar la transacción de BD al confirmar el presupuesto (`confirmar()` en
`GenerarPresupuestoUseCase`). Si `generarCondicionesPort.generar({ tenantId, idioma })`
devuelve `null` (tenant sin config o sin secciones), el sistema SHALL (DEBE) rechazar la
operación con error `CondicionesNoConfiguradasError` (HTTP 409 `CONDICIONES_NO_CONFIGURADAS`)
sin crear PRESUPUESTO ni transicionar la RESERVA.

La guarda pre-tx MUST (DEBE) ser solo un check de existencia (presencia de config y
secciones), no una generación definitiva del PDF: la generación real (render + subida)
ocurre post-commit en `DispararE2Adapter`.

#### Scenario: Confirmar presupuesto sin condicions configuradas falla con 409

- **GIVEN** un tenant sin condicions particulars configuradas (o con secciones vacías) y
  una RESERVA en estado origen válido
- **WHEN** el gestor intenta confirmar el presupuesto
- **THEN** el sistema responde 409 `CONDICIONES_NO_CONFIGURADAS`
- **AND** no se crea ningún PRESUPUESTO
- **AND** la RESERVA permanece en su estado original
- **AND** `cond_part_enviadas_fecha` sigue siendo NULL

#### Scenario: La guarda pre-tx no genera el PDF en el almacén

- **GIVEN** un tenant con condicions configuradas
- **WHEN** el sistema ejecuta la guarda pre-tx
- **THEN** solo verifica la existencia de config y secciones sin subir ningún PDF al almacén

---

### Requirement: Confirmar presupuesto fija cond_part_enviadas_fecha en la transacción

El sistema SHALL (DEBE) fijar `RESERVA.cond_part_enviadas_fecha = now()` y
`RESERVA.cond_part_firmadas = false` dentro de la transacción de `confirmar()` (misma
unidad de trabajo que crea el PRESUPUESTO y transiciona la RESERVA a `pre_reserva`). La
respuesta de `confirmar` MUST (DEBE) incluir `condPartFechaEnvio` (timestamp del envío
de condiciones) para que el frontend refleje inmediatamente que las condicions fueron
enviadas.

#### Scenario: Confirmar presupuesto con condicions configuradas fija cond_part_enviadas_fecha

- **GIVEN** un tenant con condicions configuradas y una RESERVA en estado origen válido
- **WHEN** el gestor confirma el presupuesto
- **THEN** el sistema crea el PRESUPUESTO, transiciona la RESERVA a `pre_reserva`
- **AND** `RESERVA.cond_part_enviadas_fecha` queda fijado con el timestamp de la operación
- **AND** `RESERVA.cond_part_firmadas = false`
- **AND** el E2 se dispara post-commit con el PDF de condicions en el idioma de la reserva

#### Scenario: cond_part_enviadas_fecha ya está fijado cuando llega E3

- **GIVEN** una RESERVA cuyo presupuesto ya fue confirmado (cond_part_enviadas_fecha fijado)
- **WHEN** el gestor envía la factura de señal (E3)
- **THEN** E3 no modifica `cond_part_enviadas_fecha`
- **AND** la tarjeta de firma de condicions en la ficha muestra estado "pendiente de firma"
