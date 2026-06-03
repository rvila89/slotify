# 🧾 Historia de Usuario: Sistema genera factura de liquidación y recibo de fianza en borrador al activar la reserva confirmada

## 🆔 Metadatos
- ID: US-027
- Área funcional: Sub-procesos Paralelos
- Módulo: M5 (Facturación & Cobros / Slotify Pay)
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** `RESERVA.estado` transiciona a `reserva_confirmada` y se activan los sub-procesos paralelos (`liquidacion_status = pendiente`, `fianza_status = pendiente`)
**Ejecuto** la generación automática de la factura de liquidación (60% + extras pendientes) y el recibo de fianza como documentos en borrador, y alerto al gestor para su revisión
**Para** garantizar que el gestor dispone de los documentos de cobro listos para revisar y enviar sin trabajo manual de cálculo, centralizando la facturación y eliminando hojas de cálculo externas (D6, D8)

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-21 (pasos 1–2), UC-22 (pasos 1–2)
- Entidades implicadas: `RESERVA` (`liquidacion_status`, `fianza_status`, `importe_liquidacion`), `FACTURA` (tipo: `liquidacion`; tipo: `fianza`), `RESERVA_EXTRA` (`factura_id IS NULL`), `TENANT_SETTINGS` (`fianza_default_eur`, `iva_porcentaje`), `AUDIT_LOG`
- Dolor(es) que resuelve: D6, D8, D9
- Automatización relacionada: A7 (Inicio sub-proceso liquidación: generar factura de liquidación en borrador + alerta al gestor)
- Email relacionado: ninguno en este paso — E4 se dispara en US-028, tras aprobación del gestor
- Reglas de negocio:
  - Trigger: `RESERVA.liquidacion_status = pendiente` Y `RESERVA.fianza_status = pendiente` (activados sincrónicamente por US-021 al transicionar a `reserva_confirmada`)
  - **Factura de liquidación** (`tipo = liquidacion`): `total = RESERVA.importe_liquidacion + Σ(RESERVA_EXTRA.subtotal WHERE factura_id IS NULL)`; IVA al 21%; estado = `borrador`
  - **Recibo de fianza** (`tipo = fianza`): `total = TENANT_SETTINGS.fianza_default_eur`; estado = `borrador`
  - `FACTURA.numero_factura` NO se asigna en borrador; se asigna solo al emitir/enviar (US-028)
  - Ambos borradores se crean en la misma transacción atómica con la activación de sub-procesos
  - Operación idempotente: si los borradores ya existen para la reserva, no se crean duplicados
  - Si `TENANT_SETTINGS.fianza_default_eur = 0`, se omite la generación del recibo de fianza
- Supuestos: `RESERVA.importe_liquidacion` ya está calculado (60% del presupuesto aceptado, derivado de US-021/UC-17)
- Dependencias: US-021 (`reserva_confirmada` activada, `importe_liquidacion` y `importe_total` calculados y congelados, sub-procesos activados); US-022 (factura de señal ya emitida — no duplicar el 40%)
- Notas de alcance:
  - La factura complementaria post-evento (extras pedidos después de emitida la liquidación) es 📐 (lista negra)
  - Los `RESERVA_EXTRA` con `origen = anadido_post_confirmacion` pedidos después de emitida la liquidación también quedan fuera del MVP (📐)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que una `RESERVA` acaba de transicionar a `reserva_confirmada` con `importe_liquidacion = 3.600,00 €`, existen 2 `RESERVA_EXTRA` con `factura_id IS NULL` (subtotales: 300 € + 200 €), y `TENANT_SETTINGS.fianza_default_eur = 1.000,00 €`
  **Cuando** el sistema activa los sub-procesos paralelos (`liquidacion_status = pendiente`, `fianza_status = pendiente`)
  **Entonces**:
  - Se crea una `FACTURA` con `tipo = liquidacion`, `base_imponible = (3.600 + 500) / 1,21 ≈ 3.388,43 €`, `iva_porcentaje = 21`, `iva_importe ≈ 711,57 €`, `total = 4.100,00 €`, `estado = borrador`, `numero_factura = NULL`
  - Se crea una `FACTURA` con `tipo = fianza`, `total = 1.000,00 €`, `estado = borrador`, `numero_factura = NULL`
  - El gestor recibe una alerta en la UI: "Documentos de liquidación y fianza pendientes de revisión"
  - Ambas acciones quedan registradas en `AUDIT_LOG` con `accion = crear`

### ⚠️ Flujos Alternativos y Edge Cases

#### Reserva sin `RESERVA_EXTRA` pendientes
- **Dado** que la `RESERVA` tiene `importe_liquidacion = 3.600,00 €` y no existen `RESERVA_EXTRA` con `factura_id IS NULL`
  **Cuando** el sistema genera la factura de liquidación
  **Entonces** la `FACTURA` de liquidación tiene `total = 3.600,00 €` (solo el 60% sin extras adicionales); el recibo de fianza se genera igualmente

#### `TENANT_SETTINGS.fianza_default_eur = 0`
- **Dado** que `TENANT_SETTINGS.fianza_default_eur = 0`
  **Cuando** el sistema activa los sub-procesos
  **Entonces** la `FACTURA` de tipo `fianza` no se genera; `RESERVA.fianza_status` permanece `pendiente`; la alerta al gestor menciona solo la factura de liquidación
- Comportamiento del sistema: si no hay importe de fianza configurado, el recibo se omite; el gestor puede generarlo manualmente con importe negociado

#### Idempotencia — trigger duplicado
- **Dado** que los borradores ya fueron creados para la `RESERVA` (ej. segundo intento tras fallo transitorio)
  **Cuando** el trigger de activación de sub-procesos se ejecuta de nuevo
  **Entonces** el sistema detecta la existencia de borradores para esa reserva y no crea facturas duplicadas; operación idempotente sin efecto secundario
- Comportamiento del sistema: verificación previa a la inserción; no se generan duplicados

### 🚫 Reglas de Validación
- Solo se generan los borradores cuando `RESERVA.estado = reserva_confirmada` Y `liquidacion_status = pendiente`
- Máximo una `FACTURA` de tipo `liquidacion` y una de tipo `fianza` por `reserva_id` en estado `borrador` o `enviada`
- `FACTURA.numero_factura` es `NULL` en borrador; se asigna solo al emitir
- IVA siempre al 21% (valor en `TENANT_SETTINGS`)
- Los `RESERVA_EXTRA` incluidos son aquellos con `factura_id IS NULL` en el momento de generación

## 📊 Impacto de Negocio
- Impacto esperado: Eliminación del cálculo manual de la liquidación (D8); facturación centralizada y trazable desde el primer momento (D6); el gestor no necesita salir de Slotify para calcular el 60%
- Criterio de éxito: 100% de reservas confirmadas con factura de liquidación en borrador generada automáticamente; tiempo de generación < 5 segundos