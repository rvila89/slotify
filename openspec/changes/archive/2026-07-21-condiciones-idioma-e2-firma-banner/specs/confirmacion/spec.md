# Spec-delta: condiciones-idioma-e2-firma-banner (capability `confirmacion`)

## MODIFIED Requirements

### Requirement: Precondiciones y validación del fichero antes de registrar la firma

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que: (1)
`RESERVA.cond_part_enviadas_fecha` **no es nulo** (las condiciones se enviaron al cliente en E2,
al confirmar el presupuesto — change `condiciones-idioma-e2-firma-banner`); (2) `RESERVA.estado ∈
{reserva_confirmada, evento_en_curso, post_evento}` (nunca un estado
terminal `reserva_completada` / `reserva_cancelada` ni ningún otro); y (3) el Gestor ha adjuntado
**exactamente un** fichero con `mime_type ∈ {image/jpeg, image/png, application/pdf}` y tamaño ≤ 10 MB.
Si `cond_part_enviadas_fecha` es nulo, el sistema DEBE rechazar la operación con el mensaje **"Las
condiciones particulares no han sido enviadas al cliente aún"**. Si el estado es terminal (u otro no
permitido), el sistema DEBE rechazar con **"No se puede registrar la firma en una reserva en estado
terminal"**. Si el fichero está ausente, tiene formato no permitido o excede 10 MB, el sistema DEBE
rechazarlo con un mensaje específico. En cualquiera de estos rechazos **no** se crea `DOCUMENTO`,
**no** se modifica `RESERVA.cond_part_firmadas` ni `cond_part_firmadas_fecha`, y **no** se registra
`AUDIT_LOG`. La validación es **autoritativa en servidor**, independiente del frontend. (Fuente:
`US-024 §Reglas de negocio`, `§Reglas de Validación`, `§Condiciones no enviadas`, `§Reserva en estado
no esperado`, `§Formato de fichero no válido`; UC-19; patrón `US-021 confirmar-senal`.)

#### Scenario: Condiciones no enviadas se rechaza sin efectos

- **GIVEN** una RESERVA con `cond_part_enviadas_fecha = null`
- **WHEN** el Gestor intenta registrar la firma subiendo un fichero válido
- **THEN** el sistema muestra "Las condiciones particulares no han sido enviadas al cliente aún"
- **AND** no se crea `DOCUMENTO`, no se modifica `RESERVA.cond_part_firmadas` ni
  `cond_part_firmadas_fecha`, y no se registra `AUDIT_LOG`

#### Scenario: Reserva en estado terminal se rechaza sin efectos

- **GIVEN** una RESERVA en `reserva_completada` o `reserva_cancelada` con `cond_part_enviadas_fecha`
  informado
- **WHEN** se intenta registrar la firma de condiciones particulares
- **THEN** el sistema rechaza con "No se puede registrar la firma en una reserva en estado terminal"
- **AND** no se crea `DOCUMENTO` y no se modifica la RESERVA
