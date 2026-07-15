---
id: US-024
estado: en_revision
branch: feature/firma-condiciones-particulares-us024
pr: 72
---

# 🧾 Historia de Usuario: Registrar Firma de Condiciones Particulares

## 🆔 Metadatos
- ID: US-024
- Área funcional: Confirmación de Reserva
- Módulo: M5 — Confirmación & Facturación
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** registrar que el cliente ha firmado el documento de condiciones particulares adjuntando la copia firmada en el sistema
**Para** dejar constancia legal de la aceptación del contrato por parte del cliente y actualizar el estado de cumplimiento de condiciones en la reserva

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-19 (segundo flujo: registro de firma)
- Entidades implicadas: `RESERVA`, `DOCUMENTO`, `AUDIT_LOG`
- Dolor(es) que resuelve: D1 (registro digital centralizado elimina gestión manual de documentos físicos firmados), D3 (estado de firma trazado en la reserva, visible en el pipeline)
- Automatización relacionada: UC-19 FA-01 — si el día del evento (`fecha_evento`) llega con `cond_part_firmadas = false`, el sistema emite una alerta al gestor (no bloquea la reserva ni la transición a `evento_en_curso`)
- Email relacionado: ninguno directo en este flujo (E3 ya fue enviado en US-023)
- Reglas de negocio:
  - `RESERVA.estado` debe ser `reserva_confirmada` (puede extenderse hasta `evento_en_curso` si no se ha firmado antes del evento)
  - `RESERVA.cond_part_enviadas_fecha` debe estar informado: las condiciones deben haber sido enviadas al cliente (US-023) antes de poder registrar la firma
  - El gestor sube el documento firmado (imagen o PDF); se crea un nuevo `DOCUMENTO` con `tipo = 'condiciones_particulares'` que es la copia firmada; el documento original (no firmado, generado en US-023) permanece en BD
  - `RESERVA.cond_part_firmadas = true`
  - `RESERVA.cond_part_firmadas_fecha` = timestamp del registro
  - La firma puede registrarse en cualquier momento entre el envío de E3 y el final del evento; no hay un deadline que bloquee la reserva, solo una alerta si no está firmado el día del evento (FA-01)
  - La firma presencial el día del evento (paper sign) es un flujo válido: el gestor sube la foto del documento firmado físicamente
- Supuestos: el cliente devuelve el documento firmado por email, físicamente o mediante otro canal; el gestor tiene acceso al fichero firmado para subirlo
- Dependencias:
  - US-023 — condiciones particulares enviadas (`cond_part_enviadas_fecha` no nulo)
- Notas de alcance:
  - La firma digital con plataforma de e-signature (DocuSign, etc.) es 📐 Solo diseñado; en MVP el flujo es: envío del PDF → firma en papel o por email → gestor sube la copia firmada
  - FA-01 (alerta el día del evento sin firma) está cubierto como criterio de aceptación, pero el disparo de la alerta automática por cron es parte de la lógica de UC-23 (Iniciar Evento, no cubierto en este lote)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que `RESERVA` está en `reserva_confirmada`, `cond_part_enviadas_fecha` está informado (condiciones enviadas en US-023) y `cond_part_firmadas = false`
  **Cuando** el gestor selecciona "Registrar condiciones firmadas", sube la copia firmada del documento (PDF o imagen) y confirma
  **Entonces**:
  - Se crea `DOCUMENTO` con `tipo = 'condiciones_particulares'`, `reserva_id`, `tenant_id`, `url` del fichero firmado almacenado, `mime_type` correspondiente al fichero subido
  - `RESERVA.cond_part_firmadas = true`
  - `RESERVA.cond_part_firmadas_fecha` queda registrado con el timestamp del registro
  - `AUDIT_LOG` registra `accion = 'actualizar'` con `entidad = 'RESERVA'`, `datos_anteriores.cond_part_firmadas = false`, `datos_nuevos.cond_part_firmadas = true`, y `datos_nuevos.cond_part_firmadas_fecha`

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: Día del evento sin firma registrada — alerta sin bloqueo
- **Dado** que es el día del evento (`fecha_evento = hoy`) y `RESERVA.cond_part_firmadas = false`
  **Cuando** el gestor accede a la ficha de la reserva o el sistema verifica las condiciones para iniciar el evento (UC-23)
  **Entonces** el sistema muestra una alerta visible "⚠️ Condiciones particulares pendientes de firma"; la reserva no queda bloqueada y puede progresar a `evento_en_curso`; el gestor puede registrar la firma presencial durante el mismo día del evento
- Comportamiento del sistema: la alerta es informativa, no bloqueante; se muestra en la ficha de la reserva y en el checklist de documentación del evento

#### Condiciones no enviadas — operación no permitida
- **Dado** que `RESERVA.cond_part_enviadas_fecha = null` (las condiciones particulares no han sido enviadas al cliente)
  **Cuando** el gestor intenta acceder a "Registrar condiciones firmadas"
  **Entonces** el sistema muestra el mensaje "Las condiciones particulares no han sido enviadas al cliente aún"; la opción de registro de firma no está disponible; el gestor debe completar primero el envío de E3 (US-023)

#### Formato de fichero no válido
- **Dado** que el gestor adjunta un fichero con extensión no permitida (p. ej. `.docx`) o tamaño > 10 MB
  **Cuando** intenta confirmar el registro
  **Entonces** el sistema muestra error de validación específico (formato no permitido / tamaño excedido); no se modifica `RESERVA`; no se crea `DOCUMENTO`

#### Firma ya registrada — intento de doble registro
- **Dado** que `RESERVA.cond_part_firmadas = true` (la firma ya fue registrada previamente)
  **Cuando** el gestor intenta registrar la firma de nuevo (p. ej. para subir una versión más legible del documento)
  **Entonces** el sistema permite subir el nuevo documento (crea un nuevo `DOCUMENTO` con `tipo = 'condiciones_particulares'`); actualiza `RESERVA.cond_part_firmadas_fecha` con el nuevo timestamp; mantiene `cond_part_firmadas = true`; el documento anterior permanece en BD (no se elimina)
- Comportamiento del sistema: el histórico de documentos de condiciones particulares queda preservado; el más reciente es el documento de referencia

#### Reserva en estado no esperado
- **Dado** que `RESERVA.estado` es `reserva_completada` (terminal) o `reserva_cancelada` (terminal)
  **Cuando** se intenta registrar la firma de condiciones particulares
  **Entonces** el sistema rechaza la operación; no se modifica ninguna entidad; mensaje: "No se puede registrar la firma en una reserva en estado terminal"

### 🚫 Reglas de Validación
- `RESERVA.cond_part_enviadas_fecha` no nulo obligatorio (precondición: E3 enviado)
- `RESERVA.estado` ∈ {`reserva_confirmada`, `evento_en_curso`, `post_evento`} — la firma puede registrarse hasta el cierre del post-evento
- Fichero obligatorio: presente, formato `image/jpeg`, `image/png` o `application/pdf`, tamaño ≤ 10 MB
- `RESERVA.estado` no puede ser terminal (`reserva_completada`, `reserva_cancelada`)

## 📊 Impacto de Negocio
- Impacto esperado: centraliza el seguimiento de la firma del contrato en el sistema, eliminando el riesgo de perder documentos firmados o de no saber si el cliente ha firmado (D3, D1); proporciona trazabilidad legal completa del ciclo de vida del contrato
- Criterio de éxito: 100 % de reservas confirmadas con `cond_part_firmadas = true` antes del inicio del evento (salvo firma presencial el día del evento); 0 reservas archivadas sin documento firmado almacenado en BD
