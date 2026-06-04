---
id: US-035
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Gestor registra el IBAN del cliente para la devolución de fianza y el sistema confirma la recepción (E8)

## 🆔 Metadatos
- ID: US-035
- Área funcional: Post-evento
- Módulo: M5 (Facturación & Cobros), M6 (Comunicaciones — Slotify Connect)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** registrar el IBAN que el cliente ha proporcionado en respuesta a la solicitud de devolución de fianza (E5)
**Para** habilitar el procesamiento de la devolución y que el sistema confirme automáticamente al cliente la recepción del IBAN (E8)

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-26 (FA-01: cliente proporciona IBAN → este UC completa el ciclo de solicitud iniciado por E5), UC-27 (pasos 1–3: registrar IBAN, sistema alerta al gestor)
- Entidades implicadas: `RESERVA` (`estado`, `fianza_eur`, `fianza_status`), `CLIENTE` (`iban_devolucion`, `email`), `COMUNICACION` (`codigo_email = E8`, `estado`, `reserva_id`, `cliente_id`), `AUDIT_LOG`
- Dolor(es) que resuelve: D6 (gestión centralizada de fianza: el IBAN queda trazado en Slotify en lugar de perderse en hilos de email), D9 (E8 automático elimina la tarea manual de confirmar la recepción del IBAN al cliente)
- Automatización relacionada: A11 (la solicitud E5 fue disparada al entrar en `post_evento`; este paso cierra el ciclo de recepción del IBAN — no hay código Axx propio para el registro del IBAN)
- Email relacionado: E8 (Cliente proporciona IBAN en `post_evento` → Confirmación de recepción de IBAN + próximos pasos para la devolución) — **Automático**, se envía inmediatamente al guardar un IBAN con formato válido en `CLIENTE.iban_devolucion`
- Reglas de negocio:
  - Solo disponible cuando `RESERVA.estado = post_evento` Y `RESERVA.fianza_eur > 0`
  - El IBAN introducido se valida con el algoritmo de checksum IBAN (módulo 97): longitud, prefijo de país, dígitos de control
  - Al guardar un IBAN válido: `CLIENTE.iban_devolucion` se actualiza y el sistema crea un registro `COMUNICACION` con `codigo_email = E8` y envía E8 a `CLIENTE.email`
  - E8 incluye: confirmación de recepción del IBAN y descripción de los próximos pasos (inspección del espacio, plazo estimado de devolución)
  - `CLIENTE.iban_devolucion` es un atributo del cliente, no de la reserva; queda disponible en futuras reservas del mismo cliente
  - Si `CLIENTE.iban_devolucion` ya tenía un valor previo (actualización o corrección), se sobreescribe y E8 se reenvía con el IBAN actualizado
  - Si el envío de E8 falla por error del proveedor de email: `COMUNICACION.estado = fallido`; `CLIENTE.iban_devolucion` se guarda igualmente; el gestor puede reintentar desde la ficha
  - La actualización queda registrada en `AUDIT_LOG` con `datos_anteriores` (IBAN previo o null) y `datos_nuevos` (nuevo IBAN)
- Supuestos: en MVP, el cliente proporciona el IBAN por email o comunicación directa; el gestor lo introduce manualmente en Slotify
- Dependencias: US-034 (precondición: `RESERVA.estado = post_evento` y `RESERVA.fianza_eur > 0`)
- Notas de alcance:
  - **Recordatorios automáticos si el cliente no proporciona IBAN (A23 T+3d, A24 T+7d)**: `📐 Solo diseñado`. No implementados en MVP. El gestor contacta manualmente si el cliente no responde al E5.
  - **Formulario web autónomo del cliente para aportar IBAN**: `📐`. En MVP, el gestor introduce el IBAN recibido por email directamente en la ficha de la reserva.
  - **Validación bancaria en tiempo real** (verificar que la cuenta existe): `📐`. En MVP solo se aplica la validación de formato/checksum IBAN.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path
- **Dado** que `RESERVA.estado = post_evento`, `RESERVA.fianza_eur = 1000.00` y el cliente ha proporcionado al gestor el IBAN `ES9121000418450200051332` por email
  **Cuando** el gestor introduce el IBAN en el campo correspondiente de la ficha de post-evento y confirma
  **Entonces**:
  - `CLIENTE.iban_devolucion = "ES9121000418450200051332"`
  - El sistema crea `COMUNICACION` con `codigo_email = E8`, `reserva_id = <id>`, `cliente_id = <id>`, `estado = enviado`
  - El email E8 llega a `CLIENTE.email` con: confirmación de recepción del IBAN y descripción de los próximos pasos para la devolución de la fianza
  - `AUDIT_LOG` registra `accion = actualizar`, `entidad = CLIENTE`, `datos_anteriores = {iban_devolucion: null}`, `datos_nuevos = {iban_devolucion: "ES9121000418450200051332"}`

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01 — IBAN con formato inválido
- **Dado** que el gestor introduce el valor `ES12345INVALIDO` en el campo IBAN
  **Cuando** el gestor intenta guardar
  **Entonces** el sistema muestra error de validación: "El IBAN introducido no tiene un formato válido. Verifica los dígitos de control y la longitud."; `CLIENTE.iban_devolucion` no se actualiza; no se envía E8
- Comportamiento del sistema: la validación IBAN (checksum módulo 97) bloquea el guardado antes de cualquier operación de escritura

#### FA-02 — Actualización de IBAN por corrección posterior
- **Dado** que `CLIENTE.iban_devolucion = "ES0000000000000000000001"` (IBAN registrado pero erróneo) y el cliente proporciona el IBAN corregido `ES9121000418450200051332`
  **Cuando** el gestor edita el campo IBAN, introduce el nuevo valor y guarda
  **Entonces**:
  - `CLIENTE.iban_devolucion` se sobreescribe con el IBAN corregido
  - El sistema crea un nuevo registro `COMUNICACION` con `codigo_email = E8` y lo envía al cliente con el IBAN actualizado como referencia
  - `AUDIT_LOG` registra `datos_anteriores = {iban_devolucion: "ES0000..."}`, `datos_nuevos = {iban_devolucion: "ES9121..."}`
- Comportamiento del sistema: el IBAN anterior queda en `datos_anteriores` del AUDIT_LOG; el envío de E8 es la confirmación definitiva con el IBAN correcto

#### FA-03 — Fallo en el envío de E8
- **Dado** que el IBAN introducido tiene formato válido pero el proveedor de email no está disponible en el momento del guardado
  **Cuando** el sistema intenta enviar E8 tras guardar `CLIENTE.iban_devolucion`
  **Entonces**:
  - `CLIENTE.iban_devolucion` se guarda igualmente
  - `COMUNICACION.estado = fallido`
  - El gestor ve alerta: "⚠️ IBAN guardado, pero E8 no pudo enviarse. Puedes reenviarlo desde la ficha."
  - `AUDIT_LOG` registra la actualización del IBAN con indicación del fallo de email
- Comportamiento del sistema: el guardado del IBAN y el envío del email son operaciones separadas; el fallo de email no revierte la actualización del IBAN

#### FA-04 — Acceso cuando no hay fianza cobrada
- **Dado** que `RESERVA.fianza_eur = 0` (o `NULL`) y `RESERVA.estado = post_evento`
  **Cuando** el gestor accede a la ficha de post-evento
  **Entonces** el campo IBAN no es visible o está deshabilitado; no es posible registrar ningún IBAN porque no hay fianza que devolver
- Comportamiento del sistema: la UI condiciona la visibilidad del campo a `fianza_eur > 0`

### 🚫 Reglas de Validación
- Solo accesible cuando `RESERVA.estado = post_evento`
- Solo habilitado cuando `RESERVA.fianza_eur > 0`
- El IBAN debe superar la validación de formato y checksum (módulo 97) antes de persistirse
- `CLIENTE.iban_devolucion` se asocia a la entidad `CLIENTE`, no a la `RESERVA` específica
- E8 se envía únicamente a `CLIENTE.email`, nunca al gestor
- `AUDIT_LOG` obligatorio para toda actualización de `CLIENTE.iban_devolucion`

## 📊 Impacto de Negocio
- Impacto esperado: 100% de los IBANs recibidos quedan registrados en Slotify (no en Gmail), eliminando extravíos. E8 automático elimina el paso manual de confirmación (D9). Trazabilidad completa del ciclo solicitud → recepción → confirmación (D6, D1).
- Criterio de éxito: `CLIENTE.iban_devolucion` registrado y E8 enviado correctamente en el 100% de casos donde el cliente proporciona IBAN; cero IBANs perdidos en email en expedientes post-evento
