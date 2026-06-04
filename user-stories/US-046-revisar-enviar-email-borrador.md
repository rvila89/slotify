---
id: US-046
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Gestor revisa y envía email borrador generado por el sistema

## 🆔 Metadatos
- ID: US-046
- Área funcional: Comunicaciones
- Módulo: M10
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** revisar, editar opcionalmente y confirmar el envío de un email que el sistema ha generado como borrador
**Para** garantizar que las comunicaciones con comentarios contextuales o de redacción delicada se revisan antes de llegar al cliente, sin perder la trazabilidad automática del log de comunicaciones

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-36
- Entidades implicadas: `COMUNICACION`, `RESERVA`, `CLIENTE`, `AUDIT_LOG`
- Dolor(es) que resuelve: D1 (comunicación reactiva manual: el gestor puede supervisar y personalizar mensajes delicados), D3 (reducción de carga: el sistema pre-rellena el borrador, el gestor solo revisa y confirma)
- Automatización relacionada: ninguna directa (el borrador es el resultado de la automatización de UC-35 / US-045 cuando E1 se genera con comentarios; el envío final es acción manual del gestor)
- Email relacionado: E1 (trigger de borrador cuando la consulta contiene notas/comentarios); `manual` (para cualquier comunicación iniciada manualmente desde la ficha de reserva)
- Reglas de negocio:
  - Solo existe un borrador en `COMUNICACION` si fue creado explícitamente como `estado = 'borrador'` (por US-045 cuando E1 tiene comentarios, o creado manualmente por el gestor)
  - El gestor puede editar el campo `cuerpo` y `asunto` del borrador antes de enviarlo; el `destinatario_email` y el `codigo_email` no son modificables por el gestor en la interfaz estándar
  - Al confirmar el envío, el sistema actualiza `COMUNICACION.estado = 'enviado'` y registra `COMUNICACION.fecha_envio` con la marca temporal del momento del envío efectivo
  - Si el gestor descarta el borrador, `COMUNICACION.estado` pasa a `'fallido'` (no hay estado "descartado" en el enum; el descarte intencional del gestor se registra como un log de auditoría con la causa)
  - Si el proveedor de email falla al enviar, `COMUNICACION.estado` permanece en `'borrador'` o pasa a `'fallido'` según la política de reintentos (MVP: sin reintento automático; el gestor puede volver a intentarlo)
  - `COMUNICACION.codigo_email` para emails iniciados manualmente por el gestor desde la ficha de reserva es `'manual'`
- Supuestos:
  - El proveedor de email externo (Resend / Postmark) está configurado y operativo
  - El sistema muestra las comunicaciones pendientes en la ficha de la `RESERVA` (pestaña o sección "Comunicaciones")
- Dependencias:
  - US-045 (crea el borrador de E1 cuando la consulta tiene comentarios)
  - US-001 (el gestor está autenticado; `tenant_id` y `rol` en el JWT)
- Notas de alcance:
  - La edición avanzada de plantillas (cambiar variables, adjuntar documentos nuevos desde el borrador) está fuera del MVP `📐`. En MVP, el gestor puede editar el texto libre (`cuerpo` y `asunto`) pero no puede añadir adjuntos desde la interfaz de borrador.
  - El parser de emails entrantes (LLM) es `📐 Solo diseñado`. El flujo de UC-36 cubre únicamente emails salientes.
  - Los borradores de emails de cola (entrada, promoción, descarte) son `📐 Solo diseñado`: no existen en MVP, por lo que UC-36 no los cubre.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — Revisar y enviar borrador de E1
- **Dado** que existe un registro en `COMUNICACION` con `codigo_email = 'E1'`, `estado = 'borrador'`, vinculado a una `RESERVA` activa
  **Cuando** el gestor abre la ficha de la reserva, accede a la sección de comunicaciones, abre el borrador de E1, revisa el contenido y confirma el envío sin editar
  **Entonces** el sistema envía el email a `CLIENTE.email`, actualiza `COMUNICACION.estado = 'enviado'` y registra `COMUNICACION.fecha_envio` con la marca temporal del momento del envío; la acción queda registrada en `AUDIT_LOG`

### 🎯 Happy Path — Revisar, editar y enviar borrador
- **Dado** que existe un registro en `COMUNICACION` con `estado = 'borrador'` vinculado a una `RESERVA`
  **Cuando** el gestor abre el borrador, modifica el campo `cuerpo` con texto personalizado y confirma el envío
  **Entonces** el sistema envía el email con el cuerpo editado, actualiza `COMUNICACION.estado = 'enviado'`, registra `fecha_envio`, y el campo `cuerpo` almacenado en `COMUNICACION` refleja el contenido efectivamente enviado (no la versión original del borrador)

### 🎯 Happy Path — Crear y enviar email manual desde la ficha de reserva
- **Dado** que el gestor está en la ficha de una `RESERVA` activa y decide iniciar una comunicación no automatizada
  **Cuando** el gestor selecciona "Nuevo email manual", redacta `asunto` y `cuerpo`, y confirma el envío
  **Entonces** el sistema envía el email, crea una entrada en `COMUNICACION` con `codigo_email = 'manual'`, `estado = 'enviado'`, `fecha_envio` no nulo, `reserva_id` y `cliente_id` correctos, y registra en `AUDIT_LOG`

### ⚠️ Flujos Alternativos y Edge Cases

#### Gestor descarta el borrador sin enviar
- **Dado** que existe un `COMUNICACION` con `estado = 'borrador'` vinculado a una `RESERVA`
  **Cuando** el gestor abre el borrador y selecciona "Descartar"
  **Entonces** el registro en `COMUNICACION` pasa a `estado = 'fallido'`, no se envía ningún email, y se registra en `AUDIT_LOG` con causa "descartado por gestor"
- Comportamiento del sistema: el borrador desaparece de la bandeja de borradores pendientes de la ficha; la reserva puede continuar su ciclo de vida normalmente; el gestor puede crear un nuevo email manual si lo necesita

#### Fallo del proveedor de email al confirmar el envío
- **Dado** que el gestor confirma el envío de un borrador
  **Cuando** el proveedor de email externo devuelve un error (timeout, bounce permanente, credenciales inválidas)
  **Entonces** `COMUNICACION.estado` pasa a `'fallido'`, sin `fecha_envio`; se registra el error en `AUDIT_LOG`; el sistema muestra un mensaje de error al gestor indicando que el envío falló y que puede reintentarlo
- Comportamiento del sistema: el borrador se preserva (o se puede recrear) para que el gestor reintente manualmente; no hay reintento automático en MVP

#### Borrador con destinatario nulo o email inválido
- **Dado** que existe un `COMUNICACION` con `estado = 'borrador'` pero `CLIENTE.email` es nulo o tiene formato inválido
  **Cuando** el gestor intenta confirmar el envío
  **Entonces** el sistema muestra un error de validación ("El cliente no tiene email registrado"), bloquea el envío, y el borrador permanece en estado `'borrador'`; se invita al gestor a actualizar el email del cliente en la ficha del `CLIENTE` antes de reintentar
- Comportamiento del sistema: la validación del destinatario se ejecuta antes de intentar el envío, no después

#### Borrador ya enviado (intento de reenvío duplicado)
- **Dado** que un `COMUNICACION` ya tiene `estado = 'enviado'`
  **Cuando** el gestor intenta abrirlo como borrador (p. ej. por un doble clic o una petición duplicada)
  **Entonces** el sistema muestra el email como "ya enviado" en modo solo lectura y no permite un segundo envío; no se genera ninguna entrada duplicada en `COMUNICACION`
- Comportamiento del sistema: idempotencia del envío — el estado `'enviado'` es terminal y no puede revertirse a `'borrador'`

### 🚫 Reglas de Validación
- Solo se puede confirmar el envío de un registro `COMUNICACION` con `estado = 'borrador'`; los registros con `estado = 'enviado'` o `'fallido'` son de solo lectura.
- `COMUNICACION.destinatario_email` debe ser un email válido (formato RFC 5321) y no nulo antes de permitir el envío.
- `COMUNICACION.codigo_email` no puede modificarse desde la interfaz de revisión del gestor; solo `asunto` y `cuerpo` son editables.
- `COMUNICACION.tenant_id` y `COMUNICACION.cliente_id` deben coincidir con el tenant del gestor autenticado y con el cliente de la reserva asociada.
- La longitud máxima de `COMUNICACION.cuerpo` no puede superar el límite del proveedor de email configurado (negociable en `TENANT_SETTINGS`); si se supera, el sistema muestra un aviso antes del envío.

## 📊 Impacto de Negocio
- Impacto esperado: el gestor mantiene control sobre las comunicaciones que requieren contexto humano (leads con comentarios, situaciones delicadas) sin sacrificar la trazabilidad automática; se reduce el riesgo de enviar mensajes genéricos a clientes con necesidades específicas
- Criterio de éxito: 100% de los borradores confirmados quedan en `COMUNICACION.estado = 'enviado'`; tiempo medio de revisión y confirmación por el gestor < 2 minutos; 0 emails duplicados por doble acción del gestor

