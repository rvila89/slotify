# 🧾 Historia de Usuario: Gestor registra el cobro de la fianza

## 🆔 Metadatos
- ID: US-030
- Área funcional: Sub-procesos Paralelos
- Módulo: M5 (Facturación & Cobros / Slotify Pay)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** registrar la recepción del cobro de la fianza (depósito reembolsable) antes o el mismo día del evento
**Para** actualizar el estado de la fianza a "cobrada", mantener el registro financiero completo y cumplir con la precondición de inicio del evento

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-22 (pasos 5–9)
- Entidades implicadas: `RESERVA` (`fianza_status`, `fianza_eur`, `fianza_cobrada_fecha`), `FACTURA` (tipo: `fianza`), `PAGO` (`factura_id`, `importe`, `fecha_cobro`, `justificante_doc_id`), `DOCUMENTO` (`tipo = justificante_pago`), `AUDIT_LOG`
- Dolor(es) que resuelve: D6, D1, D11
- Automatización relacionada: ninguna adicional en este paso (A25 y A26 son 📐 — ver Notas de alcance)
- Email relacionado: ninguno de E1–E8 en este paso (E5 es post-evento para devolución de fianza, cubierto en área Post-evento)
- Reglas de negocio:
  - Precondición: `RESERVA.fianza_status = recibo_enviado` (el recibo fue enviado al cliente en US-028 o por separado)
  - El cobro puede registrarse en cualquier momento **antes o el mismo día del evento** (`fecha_cobro ≤ fecha_evento`)
  - Al registrar:
    - `RESERVA.fianza_eur = importe cobrado`
    - `RESERVA.fianza_cobrada_fecha = fecha_cobro`
    - Se crea `PAGO` con `factura_id = <id recibo fianza>`, `importe`, `fecha_cobro`
    - El justificante se almacena como `DOCUMENTO (tipo = justificante_pago)`, vinculado al `PAGO`
    - `FACTURA (fianza).estado = cobrada`
    - `RESERVA.fianza_status = cobrada`
  - El justificante de pago es **opcional**
  - `fianza_status = cobrada` es una de las tres precondiciones para transicionar a `evento_en_curso` (junto con `pre_evento_status = cerrado` y `liquidacion_status = cobrada`)
  - FA-01 (T-0 sin cobro): si en el día del evento `fianza_status ≠ cobrada`, la política es "Negociable" — el sistema genera alerta no bloqueante; el gestor decide manualmente si proceder
  - La devolución de la fianza (post-evento) es un flujo diferente, cubierto en UC-26/UC-27 (área Post-evento)
- Supuestos: la fianza se cobra por transferencia bancaria o efectivo; Slotify solo registra el justificante, no procesa el cobro
- Dependencias: US-028 (`fianza_status = recibo_enviado`, activado al enviar E4 o al enviar el recibo por separado)
- Notas de alcance:
  - A25 (T-3d sin pago de fianza → recordatorio al cliente) es 📐 (lista negra: recordatorios automáticos extendidos)
  - A26 (T-1d sin pago de fianza → alerta al gestor) es 📐 (lista negra: recordatorios automáticos extendidos / recordatorios de cobro)
  - La devolución de la fianza post-evento (UC-26 solicitar IBAN, UC-27 procesar devolución) pertenece al área Post-evento

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que `RESERVA.fianza_status = recibo_enviado` y existe una `FACTURA (fianza)` en `estado = enviada`, con `fecha_evento = 2026-07-12`
  **Cuando** el gestor selecciona "Registrar cobro de fianza", introduce `fecha_cobro = 2026-07-10` (dos días antes del evento), `importe = 1.000,00 €` y sube el justificante de transferencia
  **Entonces**:
  - `RESERVA.fianza_eur = 1000.00`
  - `RESERVA.fianza_cobrada_fecha = 2026-07-10`
  - Se crea `PAGO` con `factura_id = <id recibo fianza>`, `importe = 1000.00`, `fecha_cobro = 2026-07-10`
  - El justificante se almacena como `DOCUMENTO (tipo = justificante_pago)`, `PAGO.justificante_doc_id = <id documento>`
  - `FACTURA (fianza).estado = cobrada`
  - `RESERVA.fianza_status = cobrada`
  - Cambio registrado en `AUDIT_LOG`

### ⚠️ Flujos Alternativos y Edge Cases

#### Cobro el mismo día del evento (T-0)
- **Dado** que `RESERVA.fianza_status = recibo_enviado` y `fecha_evento = hoy`
  **Cuando** el gestor registra el cobro con `fecha_cobro = hoy`
  **Entonces** el sistema acepta el cobro en T-0 sin diferencia respecto al happy path; `fianza_status = cobrada`
- Comportamiento del sistema: no hay restricción de fecha mínima de cobro; cualquier `fecha_cobro ≤ fecha_evento` es válida

#### Cobro sin justificante
- **Dado** que el gestor recibe la fianza en efectivo el día del evento y no tiene justificante digital
  **Cuando** el gestor registra el cobro sin adjuntar ningún documento
  **Entonces** el sistema crea el `PAGO` con `justificante_doc_id = NULL`; el estado avanza igualmente a `cobrada`
- Comportamiento del sistema: justificante opcional; el cobro es válido sin él

#### Evento en T-0 con fianza sin cobrar (FA-01 — Política "Negociable")
- **Dado** que `fecha_evento = hoy` y `RESERVA.fianza_status = recibo_enviado` (fianza no cobrada)
  **Cuando** el sistema verifica las precondiciones para transicionar a `evento_en_curso`
  **Entonces** el sistema muestra una alerta crítica **no bloqueante** al gestor: "⚠️ Fianza pendiente de cobro. Puede registrarla ahora o proceder sin ella (política Negociable)"; el gestor decide manualmente si registrar el cobro o avanzar sin él
- Comportamiento del sistema: alerta no bloqueante; política hardcoded "Negociable" — el inicio del evento no se bloquea por fianza impagada

#### Intento de doble cobro (`fianza_status` ya `cobrada`)
- **Dado** que `RESERVA.fianza_status = cobrada` (cobro ya registrado)
  **Cuando** el gestor intenta registrar otro cobro de fianza
  **Entonces** el sistema muestra un error informativo: "La fianza ya está marcada como cobrada"; no se crea ningún `PAGO` adicional
- Comportamiento del sistema: guarda contra doble registro

#### Cobro con `fianza_status = pendiente` (recibo nunca enviado)
- **Dado** que `RESERVA.fianza_status = pendiente` (el recibo de fianza nunca fue enviado al cliente)
  **Cuando** el gestor intenta registrar el cobro de fianza
  **Entonces** el sistema muestra un aviso: "El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar el cobro igualmente?"; si el gestor confirma, el cobro se registra; si cancela, no se realiza ninguna acción
- Comportamiento del sistema: política "Negociable" — aviso pero no bloqueo duro; flujo excepcional permitido con trazabilidad en `AUDIT_LOG`

### 🚫 Reglas de Validación
- `PAGO.fecha_cobro` debe ser ≤ `RESERVA.fecha_evento` (no se puede registrar cobro de fianza después del evento)
- `PAGO.importe` debe ser > 0
- `RESERVA.fianza_eur` y `RESERVA.fianza_cobrada_fecha` se actualizan simultáneamente con el `PAGO`
- `FACTURA (fianza).estado = cobrada` solo si se crea el registro `PAGO` correspondiente

## 📊 Impacto de Negocio
- Impacto esperado: Registro centralizado del cobro de la fianza (D6); trazabilidad completa del depósito reembolsable para su posterior devolución (D1); habilitación de la tercera precondición de inicio del evento
- Criterio de éxito: 100% de fianzas cobradas registradas en Slotify antes del evento; cero gestión de fianzas en hojas de cálculo externas; `fianza_eur` siempre conciliado con el registro `PAGO` correspondiente
