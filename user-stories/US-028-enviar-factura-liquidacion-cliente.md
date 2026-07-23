---
id: US-028
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Gestor aprueba y envía la factura de liquidación al cliente

## 🆔 Metadatos
- ID: US-028
- Área funcional: Sub-procesos Paralelos
- Módulo: M5 (Facturación & Cobros / Slotify Pay)
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** revisar el borrador de la factura de liquidación (60% + extras), ajustarlo si es necesario, aprobarlo y enviarlo al cliente junto con el recibo de fianza en un único email
**Para** formalizar el cobro del 60% restante y de la fianza, emitir los documentos oficiales y activar el seguimiento del pago pendiente

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-21 (pasos 3–6), UC-22 (pasos 3–4)
- Entidades implicadas: `RESERVA` (`liquidacion_status`, `fianza_status`), `FACTURA` (tipo: `liquidacion`; tipo: `fianza`), `CLIENTE` (`email`), `COMUNICACION` (`codigo_email = E4`), `AUDIT_LOG`
- Dolor(es) que resuelve: D6, D9, D1
- Automatización relacionada: A7 ya ejecutó en US-027; en este paso no hay automatización adicional (E4 es el output del paso)
- Email relacionado: **E4** (Inicio sub-proceso liquidación — email con factura de liquidación 60% + extras + recibo de fianza; **automático tras aprobación de la factura de liquidación por el gestor**)
- Reglas de negocio:
  - Precondición: `FACTURA (liquidacion).estado = borrador` Y `RESERVA.liquidacion_status = pendiente`
  - Al aprobar y enviar:
    - `FACTURA (liquidacion).estado = enviada`; `FACTURA (liquidacion).numero_factura` asignado secuencialmente (ej. `F-2026-0001`)
    - `RESERVA.liquidacion_status = facturada`
    - E4 enviado automáticamente a `CLIENTE.email` con PDF de factura de liquidación Y PDF de recibo de fianza adjuntos
    - Como efecto del envío de E4: `FACTURA (fianza).estado = enviada`; `RESERVA.fianza_status = recibo_enviado`
    - Un registro `COMUNICACION` creado con `codigo_email = E4`, `estado = enviado`
  - La transición de estado y el envío de E4 son atómicos: si el email falla, los estados no se actualizan
  - El `numero_factura` es único por `tenant_id` y secuencial (nunca se reutiliza)
- Supuestos: los datos fiscales del `CLIENTE` (DNI, dirección, CP, población, provincia) están completos — son precondición de US-014
- Dependencias: US-027 (borradores de factura de liquidación y recibo de fianza generados)
- Notas de alcance:
  - El recordatorio automático T-1d sin cobro (FA-01 de UC-21: "Política Negociable, alerta crítica al gestor") es 📐 (lista negra: recordatorios de cobro automáticos). La política de cancelación por liquidación tardía está hardcoded como "Negociable" en MVP; no hay lógica automática de penalización
  - El envío del recibo de fianza por separado (UC-22 flujo alternativo "puede ser con liquidación o separado") se cubre como edge case: el gestor puede elegir enviar solo el recibo de fianza manualmente desde la ficha de reserva

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que existe una `FACTURA (liquidacion)` en `estado = borrador` y una `FACTURA (fianza)` en `estado = borrador`, la `RESERVA` tiene `liquidacion_status = pendiente` y `fianza_status = pendiente`
  **Cuando** el gestor revisa los borradores, no realiza ajustes y hace clic en "Aprobar y enviar"
  **Entonces**:
  - `FACTURA (liquidacion).estado = enviada`, `numero_factura = "F-2026-XXXX"` (número secuencial asignado)
  - `RESERVA.liquidacion_status = facturada`
  - `FACTURA (fianza).estado = enviada`
  - `RESERVA.fianza_status = recibo_enviado`
  - Email E4 enviado a `CLIENTE.email` con ambos PDFs adjuntos
  - `COMUNICACION` creada con `codigo_email = E4`, `estado = enviado`, `fecha_envio = now()`
  - Cambio registrado en `AUDIT_LOG`

### ⚠️ Flujos Alternativos y Edge Cases

#### Fallo en la generación del PDF o en el envío del email
- **Dado** que el servicio de generación de PDF no responde al intentar crear el adjunto de E4
  **Cuando** el gestor hace clic en "Aprobar y enviar"
  **Entonces** el sistema muestra un error recuperable; las facturas **no** cambian de estado (permanecen en `borrador`); `RESERVA.liquidacion_status` permanece `pendiente`; el gestor puede reintentar
- Comportamiento del sistema: atomicidad entre cambio de estado y envío del email; si el email falla, se hace rollback de los cambios de estado

#### Envío del recibo de fianza por separado (sin liquidación)
- **Dado** que el gestor decide enviar el recibo de fianza antes de enviar la factura de liquidación
  **Cuando** el gestor selecciona "Enviar recibo de fianza por separado" desde la ficha de reserva
  **Entonces** se envía un email al cliente con solo el recibo de fianza adjunto; `RESERVA.fianza_status = recibo_enviado`; `RESERVA.liquidacion_status` no cambia; no se usa el código E4 para este envío (se trata como email manual sin código E)
- Comportamiento del sistema: permite envío separado del recibo de fianza; el envío posterior de E4 (con liquidación) solo incluirá la factura de liquidación si la fianza ya fue enviada

#### Factura ya enviada (reenvío)
- **Dado** que `FACTURA (liquidacion).estado = enviada` y el cliente solicita un reenvío
  **Cuando** el gestor hace clic en "Reenviar factura de liquidación"
  **Entonces** el sistema reenvía el PDF de la factura ya emitida al email del cliente; crea un nuevo registro `COMUNICACION` con `codigo_email = E4`; no cambia el `numero_factura` ni el estado
- Comportamiento del sistema: el reenvío no reasigna ni modifica la factura emitida

### 🚫 Reglas de Validación
- Solo es posible aprobar y enviar si `FACTURA (liquidacion).estado = borrador`
- `FACTURA.numero_factura` es único por `tenant_id`; se genera en el momento de emisión, nunca en borrador
- La transición `liquidacion_status: pendiente → facturada` requiere éxito del envío de E4 (atomicidad)
- `RESERVA.liquidacion_status` no puede retroceder de `facturada` a `pendiente` sin acción explícita del gestor (no modelada en MVP)

## 📊 Impacto de Negocio
- Impacto esperado: Eliminación de facturas manuales en Drive (D6); envío automatizado de documentos de cobro desde Slotify (D9); trazabilidad completa del ciclo de cobro
- Criterio de éxito: 100% de facturas de liquidación emitidas por Slotify sin facturación manual externa; tiempo de envío < 30 segundos desde aprobación