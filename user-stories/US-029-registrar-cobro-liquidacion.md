# 🧾 Historia de Usuario: Gestor registra el cobro de la liquidación

## 🆔 Metadatos
- ID: US-029
- Área funcional: Sub-procesos Paralelos
- Módulo: M5 (Facturación & Cobros / Slotify Pay)
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** registrar la recepción del justificante de pago de la liquidación y confirmar el cobro del 60% restante del evento
**Para** actualizar el estado de la liquidación a "cobrada", mantener el registro financiero centralizado con trazabilidad completa y habilitar la apertura de la precondición de inicio del evento

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-21 (pasos 7–10)
- Entidades implicadas: `RESERVA` (`liquidacion_status`), `FACTURA` (tipo: `liquidacion`), `PAGO` (`factura_id`, `importe`, `fecha_cobro`, `justificante_doc_id`), `DOCUMENTO` (`tipo = justificante_pago`), `AUDIT_LOG`
- Dolor(es) que resuelve: D6, D1, D11
- Automatización relacionada: ninguna adicional en este paso
- Email relacionado: ninguno de E1–E8 en este paso
- Reglas de negocio:
  - Precondición: `RESERVA.liquidacion_status = facturada` (la factura de liquidación fue enviada en US-028)
  - Al registrar el cobro:
    - Se crea un registro `PAGO` con `factura_id`, `importe`, `fecha_cobro`
    - El justificante se almacena como `DOCUMENTO` (`tipo = justificante_pago`), vinculado al `PAGO` mediante `PAGO.justificante_doc_id`
    - `FACTURA (liquidacion).estado = cobrada`
    - `RESERVA.liquidacion_status = cobrada`
  - El justificante de pago es **opcional**: el cobro puede registrarse sin subir documento
  - `liquidacion_status = cobrada` es una de las tres precondiciones para transicionar a `evento_en_curso` (junto con `pre_evento_status = cerrado` y `fianza_status = cobrada`)
  - El pago se realiza por transferencia bancaria externa; Slotify registra el justificante pero **no procesa el pago** (no hay integración Stripe en MVP)
- Supuestos: el gestor tiene constancia del pago (extracto bancario, transferencia recibida) antes de registrarlo en Slotify
- Dependencias: US-028 (`liquidacion_status = facturada`)
- Notas de alcance:
  - La integración con Stripe o pasarela de pago es 📐 (lista negra)
  - El recordatorio automático T-1d sin cobro (FA-01 de UC-21: "alerta crítica al gestor") es 📐 (lista negra: recordatorios de cobro automáticos); la política de liquidación tardía está hardcoded como "Negociable"

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que `RESERVA.liquidacion_status = facturada` y existe una `FACTURA (liquidacion)` en `estado = enviada`
  **Cuando** el gestor selecciona "Registrar cobro de liquidación", introduce `fecha_cobro = 2026-06-15`, `importe = 4.100,00 €` y sube el justificante de transferencia (PDF)
  **Entonces**:
  - Se crea `PAGO` con `factura_id = <id factura liquidacion>`, `importe = 4100.00`, `fecha_cobro = 2026-06-15`
  - El justificante se almacena como `DOCUMENTO (tipo = justificante_pago)`, `PAGO.justificante_doc_id = <id documento>`
  - `FACTURA (liquidacion).estado = cobrada`
  - `RESERVA.liquidacion_status = cobrada`
  - Cambio registrado en `AUDIT_LOG`

### ⚠️ Flujos Alternativos y Edge Cases

#### Cobro registrado sin justificante
- **Dado** que el gestor tiene constancia verbal del cobro pero no dispone del justificante en este momento
  **Cuando** el gestor registra el cobro sin adjuntar ningún documento
  **Entonces** el sistema crea el `PAGO` con `justificante_doc_id = NULL`; el estado avanza igualmente a `cobrada`; el gestor puede adjuntar el justificante en cualquier momento posterior
- Comportamiento del sistema: el justificante es opcional; el cobro es válido sin él

#### Importe cobrado diferente al facturado (discrepancia)
- **Dado** que la factura de liquidación es por `4.100,00 €` pero el gestor introduce `importe = 4.000,00 €`
  **Cuando** el gestor confirma el registro
  **Entonces** el sistema muestra una alerta de discrepancia de importe pero **no bloquea** el registro; el `PAGO` se crea con el importe real introducido; la discrepancia queda registrada en `AUDIT_LOG`
- Comportamiento del sistema: el sistema alerta pero delega la conciliación al gestor; no bloquea por diferencias de importe

#### Intento de doble cobro (`liquidacion_status` ya `cobrada`)
- **Dado** que `RESERVA.liquidacion_status = cobrada` (el cobro ya fue registrado)
  **Cuando** el gestor intenta registrar otro cobro de liquidación
  **Entonces** el sistema muestra un error informativo: "La liquidación ya está marcada como cobrada"; no se crea ningún registro `PAGO` adicional
- Comportamiento del sistema: guarda contra doble registro de cobro

#### `liquidacion_status = pendiente` (borrador no enviado aún)
- **Dado** que `RESERVA.liquidacion_status = pendiente` (la factura aún no fue enviada)
  **Cuando** el gestor intenta registrar el cobro de liquidación
  **Entonces** el sistema bloquea la acción con el mensaje: "La factura de liquidación debe estar enviada antes de registrar su cobro"
- Comportamiento del sistema: validación de precondición de estado

### 🚫 Reglas de Validación
- Solo es posible registrar cobro si `RESERVA.liquidacion_status = facturada`
- `PAGO.fecha_cobro` debe ser una fecha válida ≤ hoy (no futura)
- `PAGO.importe` debe ser > 0
- `FACTURA.estado` solo puede pasar a `cobrada` cuando se crea el registro `PAGO` correspondiente

## 📊 Impacto de Negocio
- Impacto esperado: Registro centralizado de cobros con trazabilidad completa (D6, D1); habilitación de la precondición de inicio del evento; eliminación de hojas de Excel para seguimiento de cobros
- Criterio de éxito: 100% de cobros de liquidación registrados en Slotify antes del evento; cero cobros no trazados gestionados fuera del sistema
