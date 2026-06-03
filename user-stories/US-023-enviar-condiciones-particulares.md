# 🧾 Historia de Usuario: Generar y Enviar Condiciones Particulares al Cliente

## 🆔 Metadatos
- ID: US-023
- Área funcional: Confirmación de Reserva
- Módulo: M5 — Confirmación & Facturación
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** la aprobación de la factura de señal en borrador por parte del gestor (último paso previo al envío de E3)
**Ejecuto** la generación automática del documento de condiciones particulares de la reserva y su envío al cliente en el email E3, junto con la factura de señal
**Para** que el cliente reciba en un único email el contrato de condiciones del evento y la factura de la señal pagada, iniciando el proceso de firma y cumplimiento del contrato

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-19 (primer flujo: generación y envío), UC-17 (contexto orquestador — cubierto en US-021)
- Entidades implicadas: `DOCUMENTO`, `RESERVA`, `CLIENTE`, `COMUNICACION`, `AUDIT_LOG`
- Dolor(es) que resuelve: D1 (generación y envío automático del contrato elimina el paso manual), D3 (el estado de las condiciones queda trazado en la reserva)
- Automatización relacionada: disparada automáticamente como parte del flujo de confirmación (UC-17 paso 9), inmediatamente después de la aprobación de la factura de señal; no requiere acción adicional del gestor
- Email relacionado: E3 — email de confirmación de reserva enviado al cliente con: (1) factura de señal adjunta (generada en US-022), (2) documento de condiciones particulares adjunto, (3) cuerpo con próximos hitos del proceso. Disparado en este momento.
- Reglas de negocio:
  - `RESERVA.estado` debe ser `reserva_confirmada` y la factura de señal en `estado = 'enviada'` (aprobada por el gestor, US-022) para que se genere el documento y se envíe E3
  - Se crea `DOCUMENTO` con `tipo = 'condiciones_particulares'`, `reserva_id`, `tenant_id` y `url` del fichero generado
  - `RESERVA.cond_part_enviadas_fecha` = timestamp del envío de E3
  - `RESERVA.cond_part_firmadas = false` (valor inicial; la firma se registra en US-024)
  - `RESERVA.cond_part_firmadas_fecha = null` (hasta que se registre la firma en US-024)
  - Se crea `COMUNICACION` con `codigo_email = 'E3'`, `cliente_id`, `reserva_id`, `estado = 'enviado'` y `fecha_envio` registrada
  - El documento de condiciones particulares es generado con los datos de la reserva y del tenant (cláusulas estándar del espacio); su contenido está fijado por la configuración del tenant, no es editable por el gestor en este flujo
  - Si el envío del email falla (proveedor no disponible), `COMUNICACION.estado = 'fallido'`; `RESERVA.cond_part_enviadas_fecha` no se actualiza hasta reenvío exitoso
- Supuestos: el tenant tiene configuradas las condiciones particulares estándar en su configuración (`TENANT_SETTINGS`); si no, el sistema no puede generar el documento y alerta al gestor
- Dependencias:
  - US-021 — `RESERVA` en `reserva_confirmada`
  - US-022 — factura de señal aprobada (`estado = 'enviada'`), necesaria para adjuntarla en E3
- Notas de alcance:
  - Este US cubre únicamente el primer flujo de UC-19 (generación + envío en E3). El registro de la firma por parte del cliente es US-024
  - El documento de condiciones particulares de firma digital (p. ej. integración con plataforma de firma) es 📐 Solo diseñado; en MVP el cliente recibe el documento y lo devuelve firmado (papel o email)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que `RESERVA` está en `reserva_confirmada`, `FACTURA` de tipo `senal` tiene `estado = 'enviada'` (aprobada por el gestor), `CLIENTE.email` informado y las condiciones particulares del tenant están configuradas
  **Cuando** el sistema completa el flujo de confirmación y genera el email E3
  **Entonces**:
  - Se crea `DOCUMENTO` con `tipo = 'condiciones_particulares'`, `reserva_id`, `tenant_id`, `url` del fichero PDF generado, `mime_type = 'application/pdf'`
  - `RESERVA.cond_part_enviadas_fecha` queda registrado con el timestamp del envío
  - `RESERVA.cond_part_firmadas = false`
  - `RESERVA.cond_part_firmadas_fecha = null`
  - Se crea `COMUNICACION` con `codigo_email = 'E3'`, `cliente_id`, `reserva_id`, `estado = 'enviado'`, `destinatario_email = CLIENTE.email`, `fecha_envio` registrada
  - El email E3 lleva adjuntos: (1) PDF de factura de señal y (2) PDF de condiciones particulares
  - `AUDIT_LOG` registra `accion = 'crear'` para el `DOCUMENTO` de condiciones particulares y `accion = 'actualizar'` para `RESERVA` (campos `cond_part_enviadas_fecha`)

### ⚠️ Flujos Alternativos y Edge Cases

#### Fallo en el envío del email E3 (proveedor no disponible)
- **Dado** que el documento de condiciones particulares se ha generado correctamente pero el proveedor de email devuelve error en el momento del envío
  **Cuando** el sistema intenta enviar E3
  **Entonces** `COMUNICACION.estado = 'fallido'`; `RESERVA.cond_part_enviadas_fecha` permanece nulo; se crea `DOCUMENTO` con el fichero de condiciones particulares correctamente almacenado (el documento no se pierde); el gestor recibe alerta "Email E3 no enviado — reintentar desde la ficha de la reserva"; el gestor puede reenviar manualmente E3 desde la ficha sin regenerar el documento
- Comportamiento del sistema: el reenvío manual crea una nueva `COMUNICACION` con `codigo_email = 'E3'`; si tiene éxito, actualiza `RESERVA.cond_part_enviadas_fecha`

#### Condiciones particulares del tenant no configuradas
- **Dado** que el tenant no tiene configurada ninguna plantilla de condiciones particulares
  **Cuando** el sistema intenta generar el documento de condiciones particulares
  **Entonces** el sistema no genera el `DOCUMENTO`; E3 no se envía; el gestor recibe alerta "Configura las condiciones particulares del espacio para poder enviar E3"; la reserva permanece en `reserva_confirmada` con `cond_part_enviadas_fecha = null`
- Comportamiento del sistema: el gestor debe ir a la configuración del tenant, cargar la plantilla y entonces reiniciar el envío de E3 manualmente

#### E3 ya enviado previamente (idempotencia — reenvío)
- **Dado** que `COMUNICACION` con `codigo_email = 'E3'` y `reserva_id` ya existe con `estado = 'enviado'` (E3 fue enviado correctamente antes)
  **Cuando** el gestor solicita reenviar E3 desde la ficha de la reserva
  **Entonces** el sistema crea una nueva `COMUNICACION` con `codigo_email = 'E3'` y `estado = 'enviado'`; se adjuntan los mismos documentos ya existentes (factura y condiciones); `RESERVA.cond_part_enviadas_fecha` se actualiza al timestamp del nuevo envío; no se generan documentos duplicados (se reutilizan los existentes)

### 🚫 Reglas de Validación
- `RESERVA.estado = 'reserva_confirmada'` obligatorio
- `FACTURA.tipo = 'senal'` y `estado = 'enviada'` (aprobada) debe existir para la reserva antes de enviar E3
- `CLIENTE.email` no nulo
- Solo se genera un `DOCUMENTO` de `tipo = 'condiciones_particulares'` por reserva (si ya existe, se reutiliza en reenvíos)

## 📊 Impacto de Negocio
- Impacto esperado: el cliente recibe en un único email toda la documentación contractual y financiera de la confirmación (D1); el estado de las condiciones queda trazado en la reserva, eliminando el riesgo de perder el seguimiento de si el cliente ha recibido el contrato (D3)
- Criterio de éxito: 100 % de reservas confirmadas con E3 enviado en < 30 segundos tras la aprobación de la factura de señal; 0 reservas en `reserva_confirmada` sin `cond_part_enviadas_fecha` pasadas 24 horas desde la confirmación