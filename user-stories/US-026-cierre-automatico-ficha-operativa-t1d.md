# 🧾 Historia de Usuario: Sistema cierra la ficha operativa automáticamente en T-1d

## 🆔 Metadatos
- ID: US-026
- Área funcional: Sub-procesos Paralelos
- Módulo: M7 (Ficha operativa del Evento / Slotify Brief), M8 (Tareas & Recordatorios / Slotify Tasks)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** el día T-1d anterior al `fecha_evento` para una `RESERVA` en `reserva_confirmada` con `pre_evento_status ≠ cerrado`
**Ejecuto** el cierre automático de la `FICHA_OPERATIVA` con los datos disponibles en ese momento
**Para** garantizar que ningún evento llega al día T-0 sin la ficha operativa cerrada, preservando la disponibilidad de información para el equipo y bloqueando la apertura de un sub-estado incoherente

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-20 (FA-01)
- Entidades implicadas: `RESERVA` (`pre_evento_status`, `fecha_evento`), `FICHA_OPERATIVA` (`ficha_cerrada`, `fecha_cierre`), `AUDIT_LOG`
- Dolor(es) que resuelve: D10, D11
- Automatización relacionada: A10 (T-1d del evento | Resumen al cliente + cierre automático de ficha pre-evento)
- Email relacionado: ninguno de E1–E8 activo en esta acción (el "resumen al cliente" de A10 es 📐 — ver Notas de alcance)
- Reglas de negocio:
  - Trigger: cron job diario que evalúa `RESERVA.fecha_evento - 1 día = fecha_hoy`
  - Condición de activación: `RESERVA.estado = reserva_confirmada` AND `pre_evento_status ≠ cerrado` AND `fecha_evento = mañana`
  - Acción: `FICHA_OPERATIVA.ficha_cerrada = true`, `FICHA_OPERATIVA.fecha_cierre = now()`, `RESERVA.pre_evento_status = cerrado`
  - El cierre automático es con los datos disponibles; no requiere campos completos
  - La operación es **idempotente**: si `ficha_cerrada = true` ya, no ejecuta ninguna acción
  - El cron solo actúa sobre reservas en `estado = reserva_confirmada`
- Supuestos: el cron job se ejecuta una vez al día (p. ej. a las 23:59 de T-1d o a las 00:01 de T-0)
- Dependencias: US-025 (la `FICHA_OPERATIVA` existe, creada vacía en US-021); US-021 (`reserva_confirmada` establecida)
- Notas de alcance:
  - El "resumen al cliente" mencionado en A10 es 📐 (lista negra: recordatorios automáticos extendidos)
  - El gestor puede cerrar manualmente la ficha antes de T-1d (US-025); en ese caso este mecanismo no actúa

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que existe una `RESERVA` en `estado = reserva_confirmada` con `fecha_evento = mañana` y `pre_evento_status = en_curso` (ficha parcialmente rellenada)
  **Cuando** el cron job de T-1d se ejecuta
  **Entonces** el sistema actualiza `FICHA_OPERATIVA.ficha_cerrada = true`, `FICHA_OPERATIVA.fecha_cierre = now()`, `RESERVA.pre_evento_status = cerrado`, y registra la acción en `AUDIT_LOG` con `usuario_id = Sistema` y `accion = transicion`

### ⚠️ Flujos Alternativos y Edge Cases

#### Ficha ya cerrada manualmente por el gestor (idempotencia)
- **Dado** que `RESERVA.pre_evento_status = cerrado` (gestor cerró la ficha antes de T-1d via US-025) y `fecha_evento = mañana`
  **Cuando** el cron job de T-1d se ejecuta
  **Entonces** el sistema no ejecuta ninguna acción sobre esta reserva; no modifica ningún campo; no genera entrada duplicada en `AUDIT_LOG`
- Comportamiento del sistema: no-op idempotente; el filtro de la query excluye reservas con `pre_evento_status = cerrado`

#### Ficha vacía (`pre_evento_status = pendiente`)
- **Dado** que `RESERVA.pre_evento_status = pendiente` (el gestor nunca actualizó la ficha) y `fecha_evento = mañana`
  **Cuando** el cron job de T-1d se ejecuta
  **Entonces** el sistema cierra la ficha igualmente con los campos en su estado actual (vacíos), `ficha_cerrada = true`, `fecha_cierre = now()`, `pre_evento_status = cerrado`; se registra en `AUDIT_LOG`
- Comportamiento del sistema: el cierre forzado no depende del contenido de la ficha; garantiza el avance del estado

#### Reserva en estado distinto de `reserva_confirmada`
- **Dado** que la `RESERVA` tiene `estado = reserva_cancelada` (o `pre_reserva`, `reserva_completada`) y `fecha_evento = mañana`
  **Cuando** el cron job de T-1d se ejecuta
  **Entonces** el sistema no aplica el cierre automático a esta reserva; el filtro de la query incluye solo `estado = reserva_confirmada`
- Comportamiento del sistema: filtro estricto por estado; cero efectos secundarios sobre reservas no confirmadas

#### Múltiples reservas con `fecha_evento = mañana`
- **Dado** que existen tres `RESERVA` diferentes con `fecha_evento = mañana`, dos con `pre_evento_status = en_curso` y una con `pre_evento_status = cerrado`
  **Cuando** el cron job de T-1d se ejecuta
  **Entonces** el sistema cierra las dos fichas con `pre_evento_status = en_curso` y omite la que ya estaba `cerrado`; tres entradas independientes en `AUDIT_LOG` (dos cierres + cero acción en la tercera)
- Comportamiento del sistema: el cron procesa todas las reservas elegibles en el mismo pase

### 🚫 Reglas de Validación
- El trigger se evalúa únicamente contra `RESERVA.fecha_evento - 1 día = hoy`
- Solo aplica a `RESERVA.estado = reserva_confirmada`
- La operación es idempotente: si `FICHA_OPERATIVA.ficha_cerrada = true` ya, no hay efecto
- El `AUDIT_LOG` registra el origen de la acción como Sistema (no como un `USUARIO`)

## 📊 Impacto de Negocio
- Impacto esperado: 0% de reservas con `pre_evento_status ≠ cerrado` en el día del evento; el equipo siempre accede a los datos disponibles de la ficha, aunque estén parcialmente completados
- Criterio de éxito: 0 eventos iniciados con `pre_evento_status ≠ cerrado`; el cron job es idempotente y auditable