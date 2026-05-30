# 🧾 Historia de Usuario: Sistema envía email automático al detectar el trigger (E1–E8)

## 🆔 Metadatos
- ID: US-045
- Área funcional: Comunicaciones
- Módulo: M10
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** el trigger de un email configurado en el ciclo de vida de la reserva (E1–E8)
**Ejecuto** la selección de la plantilla correspondiente, la sustitución de variables con datos de `RESERVA` y `CLIENTE`, la generación de adjuntos si aplica, el envío al destinatario y el registro en el log de comunicaciones
**Para** garantizar que el cliente recibe la comunicación correcta en cada hito del ciclo de vida de la reserva sin intervención manual del gestor, y que toda comunicación queda trazada en `COMUNICACION`

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-35
- Entidades implicadas: `RESERVA`, `CLIENTE`, `COMUNICACION`, `AUDIT_LOG`, `FACTURA`, `DOCUMENTO`, `PRESUPUESTO`, `TENANT_SETTINGS`
- Dolor(es) que resuelve: D1 (comunicación reactiva y manual en cada hito), D3 (carga administrativa en tareas repetitivas), D9 (ausencia de automatización en el ciclo de vida)
- Automatización relacionada: ver §9.3 SlotifyGeneralSpecs para los triggers exactos de A1–A8 correspondientes a E1–E8
- Email relacionado: E1, E2, E3, E4, E5, E6, E7, E8
- Reglas de negocio:
  - Cada email tiene un trigger único de estado/evento definido en UC-35 §3: E1 (lead creado), E2 (`pre_reserva` activada), E3 (`reserva_confirmada` + factura señal aprobada), E4 (factura de liquidación aprobada y enviada), E5 (`post_evento` con `fianza_eur > 0`), E6 (sub-estado → `2.v`), E7 (resultado de visita registrado como "interesado"), E8 (`CLIENTE.iban_devolucion` registrado)
  - E1 tiene comportamiento condicional: sin notas/comentarios en la consulta → auto-envío inmediato; con notas/comentarios → se crea un registro `COMUNICACION` con `estado = borrador` y el flujo pasa a UC-36 / US-046
  - E3 incluye dos adjuntos: la `FACTURA` de señal (`tipo = senal`) y el `DOCUMENTO` de condiciones particulares (`tipo = condiciones_particulares`)
  - E4 incluye dos adjuntos: la `FACTURA` de liquidación (`tipo = liquidacion`) y el recibo de fianza (documento o registro de fianza)
  - E2 incluye el PDF del `PRESUPUESTO` aceptado como adjunto
  - E5 solo se envía si `RESERVA.fianza_eur > 0`; si la fianza es cero, no se genera comunicación E5
  - Todos los emails enviados crean una entrada en `COMUNICACION` con `estado = enviado` y `fecha_envio` no nulo
  - Los emails fallidos crean una entrada con `estado = fallido`; no hay reintento automático en MVP
  - `COMUNICACION.codigo_email` solo admite los valores del enum: `E1`–`E8` o `manual`
  - El idioma de las plantillas se toma de `TENANT_SETTINGS.idioma`
- Supuestos:
  - El proveedor de email externo (Resend / Postmark) está configurado y operativo
  - Los PDFs de facturas, presupuestos y documentos están generados antes de que se dispare el envío del email que los adjunta
- Dependencias:
  - US-003 / US-004 (trigger E1: `RESERVA` creada en sub-estado `2.a` o `2.b`)
  - US-014 (trigger E2: `RESERVA.estado` → `pre_reserva`)
  - US-021 + US-022 + US-023 (trigger E3: `reserva_confirmada` + `FACTURA.tipo = senal` aprobada)
  - US-027 + US-028 (trigger E4: `liquidacion_status → facturada`)
  - US-034 (trigger E5: `RESERVA.estado` → `post_evento`)
  - US-008 (trigger E6: sub-estado → `2.v`)
  - US-009 (trigger E7: resultado de visita "interesado" → sub-estado `2.b`)
  - US-035 (trigger E8: `CLIENTE.iban_devolucion` registrado)
- Notas de alcance:
  - Los emails de notificación de cola (entrada en cola, promoción de cola, descarte de cola por vaciado) son `📐 Solo diseñado`. No se generan en MVP.
  - Los recordatorios automáticos extendidos (T-15d, T-3d, T-1d, recordatorios de cobro de liquidación y fianza) son `📐 Solo diseñado`. No se generan en MVP.
  - El email de briefing operativo al equipo (UC-23 paso 5) no tiene código E asignado en §9.3 y no está implementado en MVP.
  - La NPS automática a T+3d (mencionada en UC-25 paso 7) es `📐 Solo diseñado`.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — E1 sin comentarios (auto-envío)
- **Dado** que se crea una `RESERVA` (sub-estado `2.a` o `2.b`) con datos de `CLIENTE` completos y sin notas/comentarios adicionales
  **Cuando** el sistema detecta el trigger de E1
  **Entonces** se selecciona la plantilla E1, se sustituyen las variables con datos de `RESERVA` y `CLIENTE`, se envía el email a `CLIENTE.email`, y se crea una entrada en `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'enviado'`, `fecha_envio` no nulo, `reserva_id` y `cliente_id` correctos, y se registra la acción en `AUDIT_LOG`

### 🎯 Happy Path — E2 (pre_reserva activada)
- **Dado** que una `RESERVA` transiciona a `pre_reserva` y existe un `PRESUPUESTO` en estado `enviado`
  **Cuando** el sistema detecta el trigger de E2
  **Entonces** se genera el PDF del presupuesto como adjunto, se envía el email a `CLIENTE.email` con el adjunto, y se crea `COMUNICACION` con `codigo_email = 'E2'`, `estado = 'enviado'`

### 🎯 Happy Path — E3 (reserva_confirmada + factura señal aprobada)
- **Dado** que una `RESERVA` transiciona a `reserva_confirmada` y la `FACTURA` de señal tiene `estado = 'enviada'` y el `DOCUMENTO` de condiciones particulares está generado
  **Cuando** el sistema detecta el trigger de E3
  **Entonces** se envía el email con la factura de señal y el documento de condiciones particulares como adjuntos, se crea `COMUNICACION` con `codigo_email = 'E3'`, `estado = 'enviado'`, y `RESERVA.cond_part_enviadas_fecha` queda con la marca temporal del envío

### 🎯 Happy Path — E4 (factura de liquidación aprobada y enviada)
- **Dado** que el gestor aprueba la factura de liquidación y el sistema actualiza `liquidacion_status = 'facturada'`
  **Cuando** el sistema detecta el trigger de E4
  **Entonces** se envía el email con la factura de liquidación y el recibo de fianza como adjuntos, se crea `COMUNICACION` con `codigo_email = 'E4'`, `estado = 'enviado'`

### 🎯 Happy Path — E5 (post_evento con fianza)
- **Dado** que una `RESERVA` transiciona a `post_evento` con `fianza_eur > 0`
  **Cuando** el sistema detecta el trigger de E5
  **Entonces** se envía el email de agradecimiento con solicitud de IBAN, se crea `COMUNICACION` con `codigo_email = 'E5'`, `estado = 'enviado'`

### 🎯 Happy Path — E6 (visita programada)
- **Dado** que una `RESERVA` transiciona al sub-estado `2.v` con `visita_programada_fecha` y `visita_programada_hora` asignados
  **Cuando** el sistema detecta el trigger de E6
  **Entonces** se envía la confirmación de visita con fecha y hora al `CLIENTE.email`, se crea `COMUNICACION` con `codigo_email = 'E6'`, `estado = 'enviado'`

### 🎯 Happy Path — E7 (resultado de visita: interés confirmado)
- **Dado** que el gestor registra el resultado de visita como "cliente interesado" y la `RESERVA` pasa de sub-estado `2.v` a `2.b`
  **Cuando** el sistema detecta el trigger de E7
  **Entonces** se envía la confirmación del bloqueo post-visita con el nuevo TTL de 3 días, se crea `COMUNICACION` con `codigo_email = 'E7'`, `estado = 'enviado'`

### 🎯 Happy Path — E8 (IBAN registrado por el gestor)
- **Dado** que el gestor registra `CLIENTE.iban_devolucion` para una `RESERVA` en estado `post_evento`
  **Cuando** el sistema detecta el trigger de E8
  **Entonces** se envía la confirmación de recepción del IBAN más próximos pasos para la devolución, se crea `COMUNICACION` con `codigo_email = 'E8'`, `estado = 'enviado'`

### ⚠️ Flujos Alternativos y Edge Cases

#### E1 con notas/comentarios → borrador (FA de UC-03)
- **Dado** que se crea una `RESERVA` con notas o comentarios adicionales del lead
  **Cuando** el sistema detecta el trigger de E1
  **Entonces** el email **no** se envía automáticamente; se crea una entrada en `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'borrador'`, sin `fecha_envio`; el sistema notifica al gestor para revisión
- Comportamiento del sistema: el control pasa al flujo UC-36 / US-046; el gestor revisa, edita y confirma el envío manualmente

#### E5 con `fianza_eur = 0` (tenant sin fianza activa)
- **Dado** que una `RESERVA` transiciona a `post_evento` con `fianza_eur = 0`
  **Cuando** el sistema evalúa el trigger de E5
  **Entonces** el email E5 **no** se envía y no se crea entrada en `COMUNICACION` para E5; el sistema omite el sub-proceso de devolución de fianza para esta reserva
- Comportamiento del sistema: la reserva avanza hacia el archivado directamente una vez resueltos los demás sub-procesos

#### Fallo del proveedor de email (error de envío)
- **Dado** que el trigger de cualquier email E1–E8 se activa correctamente
  **Cuando** el proveedor de email externo devuelve un error (timeout, bounce permanente, credenciales inválidas)
  **Entonces** se crea una entrada en `COMUNICACION` con `estado = 'fallido'` y sin `fecha_envio`, se registra el error en `AUDIT_LOG`; el sistema **no** reintenta automáticamente en MVP
- Comportamiento del sistema: el gestor puede ver el estado `fallido` en la ficha de la reserva → pestaña Comunicaciones, y enviar manualmente el email desde la interfaz de revisión de borradores (UC-36 / US-046, con `codigo_email = 'manual'`)

#### Variable de plantilla nula (datos incompletos de RESERVA o CLIENTE)
- **Dado** que el trigger de un email se activa pero un campo necesario para la plantilla está nulo (p. ej. `CLIENTE.email` nulo, `RESERVA.fecha_evento` nula para E6)
  **Cuando** el sistema intenta sustituir las variables
  **Entonces** el email **no** se envía; se registra el error en `AUDIT_LOG` con descripción del campo faltante; el gestor es notificado para completar los datos
- Comportamiento del sistema: no se crea entrada en `COMUNICACION` con `estado = 'enviado'`; se impide el envío de un email malformado

### 🚫 Reglas de Validación
- `COMUNICACION.codigo_email` solo puede contener valores del enum: `E1`, `E2`, `E3`, `E4`, `E5`, `E6`, `E7`, `E8`, `manual`. No se crean códigos fuera de este rango.
- `COMUNICACION.tenant_id` y `COMUNICACION.cliente_id` son obligatorios (no nulos) en toda entrada.
- `COMUNICACION.fecha_envio` es no nulo **únicamente** si `estado = 'enviado'`.
- `COMUNICACION.reserva_id` es no nulo para todos los emails E1–E8 (aunque el campo es nullable por diseño para emails manuales desvinculados de reserva).
- Cada trigger solo puede generar **una** entrada en `COMUNICACION` por reserva y por código de email (idempotencia): si el trigger se dispara dos veces por error, el sistema detecta la entrada existente y no duplica el envío.
- Los adjuntos referenciados en E2 (`PRESUPUESTO`), E3 (`FACTURA`, `DOCUMENTO`) y E4 (`FACTURA`) deben existir y tener `pdf_url` no nulo antes del envío; si no están disponibles, el envío se bloquea y se registra como error.

## 📊 Impacto de Negocio
- Impacto esperado: eliminación de la comunicación reactiva y manual en los 8 hitos clave del ciclo de vida (D1); reducción de la carga administrativa asociada a redactar y enviar emails en cada transición (D3); automatización completa del canal de email saliente en MVP (D9)
- Criterio de éxito: 100% de los triggers E1–E8 generan una entrada en `COMUNICACION` trazable; tasa de `estado = 'fallido'` < 1% en operación normal estable; tiempo entre trigger y envío efectivo < 30 segundos
