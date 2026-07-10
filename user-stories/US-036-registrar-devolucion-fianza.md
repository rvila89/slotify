---
id: US-036
estado: en-revision
branch: feature/us-036-registrar-devolucion-fianza
pr: 57
---

# 🧾 Historia de Usuario: Gestor registra la devolución (completa o parcial) de la fianza al cliente

## 🆔 Metadatos
- ID: US-036
- Área funcional: Post-evento
- Módulo: M5 (Facturación & Cobros), M1 (Reservas — Pipeline, Histórico, Ficha y Cola)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** registrar en Slotify la transferencia de devolución de fianza que he realizado externamente al banco, indicando el importe y adjuntando el justificante
**Para** cerrar el sub-proceso de fianza de la reserva con trazabilidad completa (estado `devuelta` o `retenida_parcial`) y disponer del justificante dentro del expediente

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-27 (pasos 4–8, FA-01 devolución parcial por desperfectos, FA-02 IBAN erróneo descubierto durante la transferencia)
- Entidades implicadas: `RESERVA` (`fianza_status`, `fianza_devuelta_fecha`, `fianza_devuelta_eur`, `fianza_eur`, `estado`), `CLIENTE` (`iban_devolucion`), `DOCUMENTO` (`tipo = justificante_pago`, `reserva_id`, `url`, `mime_type`), `AUDIT_LOG`
- Dolor(es) que resuelve: D6 (cierre trazable del sub-proceso de fianza: importe, fecha y justificante centralizados en Slotify en lugar de en Drive o email), D1 (estado final de fianza registrado en el expediente de la reserva para auditoría)
- Automatización relacionada: ninguna Axx específica para este paso (acción enteramente manual: el gestor registra tras haber realizado la transferencia bancaria externamente)
- Email relacionado: ninguno definido en §9.3 para la notificación de la devolución efectiva al cliente. El gestor puede enviar una comunicación manual desde la ficha (`COMUNICACION` con `codigo_email = manual`) si lo considera oportuno.
- Reglas de negocio:
  - Solo disponible cuando `RESERVA.estado = post_evento` Y `RESERVA.fianza_status = cobrada` Y `CLIENTE.iban_devolucion IS NOT NULL`
  - La transferencia bancaria se realiza **fuera de Slotify**; aquí se registra el hecho cumplido y el justificante
  - El gestor introduce: `importe_devuelto`, `fecha_cobro` (fecha real del abono, no del sistema) y adjunta el justificante (imagen o PDF)
  - **Devolución completa**: `importe_devuelto = fianza_eur` → `fianza_status = devuelta`
  - **Devolución parcial** (FA-01): `importe_devuelto < fianza_eur` (puede ser 0,00 € si se retiene toda la fianza por desperfectos) → `fianza_status = retenida_parcial`; el gestor debe indicar un motivo de retención (texto libre, almacenado en `RESERVA.notas` o campo auxiliar)
  - `importe_devuelto` no puede superar `fianza_eur` (validación en servidor)
  - `fecha_cobro` no puede ser anterior a `RESERVA.fianza_cobrada_fecha`
  - El justificante se sube como `DOCUMENTO` con `tipo = justificante_pago` vinculado a la `RESERVA` (`reserva_id`). En MVP es recomendado pero no bloquea el registro si no se adjunta (queda marcado como "pendiente de justificante")
  - La acción es irreversible una vez confirmada
  - Toda la acción queda registrada en `AUDIT_LOG`
- Supuestos: el gestor ya ha realizado la transferencia bancaria antes de acceder a este formulario
- Dependencias: US-035 (precondición: `CLIENTE.iban_devolucion IS NOT NULL`), US-034 (precondición: `RESERVA.estado = post_evento`)
- Notas de alcance:
  - **FA-02 de UC-27 (IBAN erróneo descubierto durante la transferencia bancaria)**: si la transferencia falla porque el IBAN era incorrecto, el gestor vuelve a US-035 para actualizar `CLIENTE.iban_devolucion` con el IBAN válido (flujo FA-02 de US-035) y repite la transferencia externa antes de registrar la devolución aquí. No hay estado de "IBAN inválido" en el modelo de datos de `RESERVA`.
  - **Notificación automática al cliente sobre la devolución efectiva**: no hay código E asignado en §9.3 para este evento. El gestor puede enviar un email manual desde la ficha.
  - **Factura de la devolución de fianza**: la FACTURA de tipo `fianza` y el recibo de fianza ya fueron generados en US-030. La devolución no genera una nueva factura; el registro es en los campos de `RESERVA` más el `DOCUMENTO` del justificante.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — Devolución completa
- **Dado** que `RESERVA.estado = post_evento`, `RESERVA.fianza_eur = 1000.00`, `RESERVA.fianza_status = cobrada`, `RESERVA.fianza_cobrada_fecha = 2026-05-15` y `CLIENTE.iban_devolucion = "ES9121000418450200051332"`, y el gestor ha realizado una transferencia de 1.000,00 € al cliente el 2026-06-05
  **Cuando** el gestor selecciona "Registrar devolución de fianza", introduce `importe_devuelto = 1000.00`, `fecha_cobro = 2026-06-05`, adjunta el justificante PDF y confirma
  **Entonces**:
  - `RESERVA.fianza_devuelta_eur = 1000.00`
  - `RESERVA.fianza_devuelta_fecha = 2026-06-05`
  - `RESERVA.fianza_status = devuelta`
  - Se crea `DOCUMENTO` con `tipo = justificante_pago`, `reserva_id = <id>`, `url = <url del PDF subido>`, `mime_type = application/pdf`
  - `AUDIT_LOG` registra `accion = actualizar`, `datos_anteriores = {fianza_status: cobrada, fianza_devuelta_eur: null, fianza_devuelta_fecha: null}`, `datos_nuevos = {fianza_status: devuelta, fianza_devuelta_eur: 1000.00, fianza_devuelta_fecha: 2026-06-05}`

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01 — Devolución parcial por desperfectos (retención parcial)
- **Dado** que `RESERVA.fianza_eur = 1500.00` y el gestor decide retener 500,00 € por desperfectos detectados durante la inspección post-evento
  **Cuando** el gestor selecciona "Registrar devolución de fianza", introduce `importe_devuelto = 1000.00`, `motivo_retencion = "Daños en vajilla valorados en 500 €"`, `fecha_cobro = 2026-06-06` y adjunta el justificante de la transferencia parcial
  **Entonces**:
  - `RESERVA.fianza_devuelta_eur = 1000.00`
  - `RESERVA.fianza_devuelta_fecha = 2026-06-06`
  - `RESERVA.fianza_status = retenida_parcial`
  - El motivo de retención queda guardado en el expediente
  - Se crea `DOCUMENTO` con `tipo = justificante_pago` del importe parcial devuelto
  - `AUDIT_LOG` registra `fianza_status: retenida_parcial`, `fianza_devuelta_eur: 1000.00`
- Comportamiento del sistema: retención total (`importe_devuelto = 0`) también resulta en `fianza_status = retenida_parcial`; `fianza_devuelta_eur = 0.00` es un valor válido en este caso

#### FA-02 — Intento de registrar importe superior a la fianza cobrada
- **Dado** que `RESERVA.fianza_eur = 1000.00`
  **Cuando** el gestor introduce `importe_devuelto = 1500.00`
  **Entonces** el sistema muestra error de validación: "El importe a devolver (1.500,00 €) no puede superar la fianza cobrada (1.000,00 €)"; la acción no se completa; ningún campo de `RESERVA` se modifica
- Comportamiento del sistema: validación en servidor (`fianza_devuelta_eur ≤ fianza_eur`); la UI puede bloquear el campo en tiempo real

#### FA-03 — Fecha de cobro anterior a la fecha de cobro de fianza
- **Dado** que `RESERVA.fianza_cobrada_fecha = 2026-05-15`
  **Cuando** el gestor introduce `fecha_cobro = 2026-05-10` (anterior al cobro de la fianza)
  **Entonces** el sistema muestra error de validación: "La fecha de devolución no puede ser anterior a la fecha de cobro de la fianza (15/05/2026)"; la acción no se completa
- Comportamiento del sistema: validación de integridad temporal

#### FA-04 — Registro sin justificante adjunto
- **Dado** que el gestor ha realizado la transferencia pero no tiene el PDF del justificante disponible en este momento
  **Cuando** el gestor completa el formulario de devolución sin adjuntar justificante y confirma
  **Entonces** el sistema permite guardar con advertencia: "⚠️ Devolución registrada sin justificante. Puedes adjuntarlo más tarde desde la ficha de documentos de la reserva."; `RESERVA.fianza_status` se actualiza igualmente; no se crea `DOCUMENTO`
- Comportamiento del sistema: el justificante es recomendado pero no es un requisito bloqueante en MVP

### 🚫 Reglas de Validación
- Solo disponible cuando `RESERVA.estado = post_evento` Y `RESERVA.fianza_status = cobrada` Y `CLIENTE.iban_devolucion IS NOT NULL`
- `fianza_devuelta_eur ≤ fianza_eur` (no se puede devolver más de lo cobrado)
- `fianza_devuelta_eur = 0.00` es válido (retención total → `fianza_status = retenida_parcial`)
- Si `fianza_devuelta_eur > 0` y `fianza_devuelta_eur = fianza_eur` → `fianza_status = devuelta`
- Si `fianza_devuelta_eur < fianza_eur` (incluido 0) → `fianza_status = retenida_parcial`
- `fianza_devuelta_fecha` es obligatorio y no puede ser anterior a `fianza_cobrada_fecha`
- La acción es irreversible una vez confirmada
- `AUDIT_LOG` obligatorio con todos los campos modificados

## 📊 Impacto de Negocio
- Impacto esperado: 100% de las devoluciones de fianza quedan trazadas en Slotify con importe, fecha y justificante (D6, D1); el gestor tiene evidencia del cierre del sub-proceso de fianza en el mismo sistema donde gestionó toda la reserva; cero expedientes con `fianza_status = cobrada` al llegar al archivado
- Criterio de éxito: `fianza_status ∈ {devuelta, retenida_parcial}` en el 100% de reservas post-evento con fianza cobrada antes de transicionar a `reserva_completada`; cero registros de devolución fuera de Slotify
