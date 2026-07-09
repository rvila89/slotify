---
id: US-034
estado: en-revision
branch: feature/us-034-finalizar-evento
pr: https://github.com/rvila89/slotify/pull/55
---

# 🧾 Historia de Usuario: Gestor finaliza el evento y activa el proceso de post-evento

## 🆔 Metadatos
- ID: US-034
- Área funcional: Ejecución del Evento
- Módulo: M1 (Reservas — Pipeline, Histórico, Ficha y Cola), M6 (Comunicaciones — Slotify Connect)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** marcar el evento como finalizado
**Para** cerrar el ciclo de ejecución del evento, activar automáticamente la solicitud de IBAN para la devolución de fianza al cliente (E5) y hacer avanzar la reserva a `post_evento`

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-25
- Entidades implicadas: `RESERVA` (`estado`, `fianza_eur`), `CLIENTE` (`email`), `COMUNICACION` (`codigo_email = E5`, `reserva_id`, `cliente_id`, `estado`), `AUDIT_LOG`
- Dolor(es) que resuelve: D9 (automatización de la solicitud de IBAN — hoy se hace manualmente o se olvida), D6 (inicio del sub-proceso de devolución de fianza sin demora), D1 (trazabilidad centralizada del cierre del evento)
- Automatización relacionada: A11 (Evento marcado completado → Solicitud IBAN si hay fianza + programar NPS a T+3d) — implementado parcialmente en MVP (ver Notas de alcance)
- Email relacionado: E5 (Evento marcado completado → Email de agradecimiento + NPS + solicitud IBAN para devolución de fianza) — **Automático**, solo si `RESERVA.fianza_eur > 0`
- Reglas de negocio:
  - La acción solo es posible cuando `RESERVA.estado = evento_en_curso`
  - Al confirmar "Marcar evento como finalizado":
    1. `RESERVA.estado = post_evento`
    2. Si `RESERVA.fianza_eur > 0`: el sistema envía E5 automáticamente al `CLIENTE.email` (agradecimiento + solicitud IBAN + enlace NPS); se crea registro `COMUNICACION` con `codigo_email = E5`
    3. Si `RESERVA.fianza_eur = 0` (o `NULL`): no se envía E5
  - La transición `evento_en_curso → post_evento` es irreversible
  - El sistema alerta al gestor si hay documentación del evento pendiente (checklist incompleto de US-033), pero no bloquea la finalización
  - Si el envío de E5 falla (error de proveedor de email), la transición de estado se mantiene y `COMUNICACION.estado = fallido`; el gestor puede reintentar el envío desde la ficha
- Supuestos: la NPS programada significa que queda marcada para envío futuro; el envío automático real de la NPS a T+3d es 📐 en MVP (ver Notas de alcance)
- Dependencias: US-031 o US-032 (precondición: `RESERVA.estado = evento_en_curso`)
- Notas de alcance:
  - **A11 "factura complementaria si aplica"**: la factura complementaria post-evento está en la lista negra MVP (📐 — lista negra explícita). Si existen `RESERVA_EXTRA` con `factura_id IS NULL` al finalizar el evento, quedan pendientes para gestión futura; no se generan en este paso
  - **Envío real de NPS a T+3d**: el disparo automático del email de NPS a T+3d forma parte de los "Recordatorios automáticos extendidos" (📐). En MVP, la NPS queda en estado "programada" pero no se envía automáticamente
  - **A23 (T+3d recordatorio IBAN)** y **A24 (T+7d segundo recordatorio IBAN)**: ambos 📐 (lista negra: recordatorios automáticos extendidos). No implementados en MVP

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path (con fianza cobrada)

- **Dado** que `RESERVA.estado = evento_en_curso` y `RESERVA.fianza_eur = 1000.00`
  **Cuando** el gestor selecciona "Marcar evento como finalizado" y confirma
  **Entonces**:
  - `RESERVA.estado = post_evento`
  - Se crea `COMUNICACION` con `codigo_email = E5`, `cliente_id = <id cliente>`, `reserva_id = <id reserva>`, `estado = enviado` (si el envío tiene éxito)
  - El email E5 llega a `CLIENTE.email` con contenido: agradecimiento por el evento + solicitud de IBAN para devolución de fianza + enlace o formulario NPS
  - La NPS queda marcada como programada (T+3d)
  - La transición se registra en `AUDIT_LOG`: `accion = transicion`, `datos_anteriores = {estado: evento_en_curso}`, `datos_nuevos = {estado: post_evento}`

### ⚠️ Flujos Alternativos y Edge Cases

#### Finalización sin fianza (`fianza_eur = 0` o `NULL`)
- **Dado** que `RESERVA.estado = evento_en_curso` y `RESERVA.fianza_eur = 0` (tenant con `TENANT_SETTINGS.fianza_default_eur = 0` o fianza no aplicada)
  **Cuando** el gestor confirma la finalización
  **Entonces**:
  - `RESERVA.estado = post_evento`
  - **No** se envía E5 ni se crea `COMUNICACION` para E5 (no hay IBAN que solicitar)
  - La NPS queda marcada como programada (T+3d) igualmente
  - La transición se registra en `AUDIT_LOG`
- Comportamiento del sistema: E5 está condicionado a `fianza_eur > 0`; la transición de estado es incondicional

#### FA-01 — Documentación del evento incompleta al finalizar
- **Dado** que `RESERVA.estado = evento_en_curso` y el checklist de documentación tiene ítems pendientes (p. ej. cláusula de responsabilidad no subida)
  **Cuando** el gestor selecciona "Marcar evento como finalizado"
  **Entonces** el sistema muestra advertencia: "⚠️ Documentación pendiente: [lista de ítems sin subir]. Puedes continuar igualmente."; si el gestor confirma, la transición a `post_evento` se ejecuta; el checklist permanece accesible para subidas tardías en la ficha de la reserva en `post_evento`
- Comportamiento del sistema: la advertencia es informativa y no bloquea la finalización; la documentación incompleta se puede completar en `post_evento`

#### Fallo en el envío de E5
- **Dado** que `RESERVA.fianza_eur > 0` y el servicio de email no está disponible en el momento de la finalización
  **Cuando** el sistema intenta enviar E5
  **Entonces**:
  - La transición `evento_en_curso → post_evento` se ejecuta igualmente (no se revierte por el fallo de email)
  - `COMUNICACION.estado = fallido`
  - El gestor ve una alerta: "⚠️ La reserva ha pasado a post-evento, pero el email E5 no pudo enviarse. Puedes reenviarlo desde la ficha."
  - El `AUDIT_LOG` registra la transición con indicación del fallo de E5
- Comportamiento del sistema: la transición de estado y el envío del email son operaciones separadas; el fallo de email no revierte el estado de la reserva

#### `fianza_status = cobrada` pero `fianza_eur IS NULL` (dato inconsistente)
- **Dado** que `RESERVA.fianza_status = cobrada` pero `RESERVA.fianza_eur IS NULL` (edge case de integridad de datos)
  **Cuando** el gestor finaliza el evento
  **Entonces** el sistema trata la condición como "sin fianza" (`fianza_eur IS NULL` equivale a 0); no se envía E5; la inconsistencia se registra en `AUDIT_LOG` como alerta de dato anómalo
- Comportamiento del sistema: `fianza_eur IS NULL` nunca debe provocar un envío de E5 con IBAN pendiente

### 🚫 Reglas de Validación
- Solo disponible cuando `RESERVA.estado = evento_en_curso`
- La transición `evento_en_curso → post_evento` es irreversible (no hay paso atrás)
- E5 se envía a `CLIENTE.email` — nunca al gestor
- `COMUNICACION` para E5 se crea en ambos casos: envío exitoso (`estado = enviado`) y fallido (`estado = fallido`)
- El `AUDIT_LOG` es obligatorio para toda transición de estado
- `RESERVA.estado = post_evento` no depende del éxito del envío de E5

## 📊 Impacto de Negocio
- Impacto esperado: automatización de la solicitud de IBAN en el 100% de eventos con fianza cobrada (D9, D6); inicio inmediato del sub-proceso de devolución de fianza sin que el gestor deba recordarlo; trazabilidad completa del cierre del evento en Slotify (D1)
- Criterio de éxito: 100% de eventos finalizados en Slotify pasan a `post_evento`; E5 enviado correctamente al cliente en el 100% de reservas con `fianza_eur > 0` al finalizar el evento
