---
id: US-032
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Gestor fuerza el inicio del evento cuando alguna precondición está incumplida

## 🆔 Metadatos
- ID: US-032
- Área funcional: Ejecución del Evento
- Módulo: M1 (Reservas — Pipeline, Histórico, Ficha y Cola)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** poder forzar manualmente el inicio del evento cuando el sistema detecta que alguna precondición está incumplida y me muestra la alerta crítica
**Para** mantener la operación del día del evento aunque haya un sub-proceso financiero u operativo pendiente, con trazabilidad completa de la decisión de sobrescritura en el audit log

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-23 (FA-01)
- Entidades implicadas: `RESERVA` (`estado`, `pre_evento_status`, `liquidacion_status`, `fianza_status`, `fecha_evento`), `AUDIT_LOG`
- Dolor(es) que resuelve: D2 (visibilidad y control del pipeline — el gestor necesita capacidad de override documentado para gestionar incidencias operativas el día del evento)
- Automatización relacionada: ninguna (acción manual explícita del gestor)
- Email relacionado: ninguno de E1–E8
- Reglas de negocio:
  - El forzado solo es posible cuando `RESERVA.estado = reserva_confirmada` y `RESERVA.fecha_evento = hoy`
  - El sistema muestra **exactamente qué precondiciones no se cumplen** (lista de sub-procesos incumplidos) antes de ofrecer el botón "Forzar inicio del evento"
  - La confirmación del forzado requiere **doble confirmación** en la UI (guardarraíl contra activación accidental)
  - El `AUDIT_LOG` registra la transición con `datos_nuevos` conteniendo `forzado_por_gestor = true` y la lista de sub-procesos incumplidos en el momento del forzado
  - Tras el forzado, `RESERVA.estado = evento_en_curso` — igual que en el happy path automático (US-031)
  - Los sub-procesos incumplidos en el momento del forzado (p. ej. `liquidacion_status = facturada`) **no se resuelven automáticamente** — siguen pendientes para gestión posterior
- Supuestos: el forzado es una decisión de negocio excepcional con riesgo asumido por el gestor; Slotify la permite pero la registra con plena trazabilidad
- Dependencias: US-031 (flujo alternativo del mismo trigger — la reserva sigue en `reserva_confirmada` porque el cron no la transicionó al fallar alguna precondición)
- Notas de alcance: ninguna; el override está explícitamente documentado en UC-23 FA-01

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que `RESERVA.estado = reserva_confirmada`, `RESERVA.fecha_evento = hoy` y al menos una precondición no se cumple (p. ej. `liquidacion_status = facturada` en lugar de `cobrada`)
  **Cuando** el sistema muestra la alerta crítica listando las precondiciones incumplidas y el gestor selecciona "Forzar inicio del evento" y confirma en el diálogo de doble confirmación
  **Entonces**:
  - `RESERVA.estado = evento_en_curso`
  - La vista móvil "evento en curso" queda activa para el gestor y el equipo
  - El checklist de documentación del evento se muestra como pendiente
  - `AUDIT_LOG` registra la transición: `accion = transicion`, `datos_anteriores = {estado: reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso, forzado_por_gestor: true, precondiciones_incumplidas: [lista]}`

### ⚠️ Flujos Alternativos y Edge Cases

#### Gestor cancela en el diálogo de doble confirmación
- **Dado** que el gestor ve la alerta de precondiciones incumplidas y pulsa "Forzar inicio del evento"
  **Cuando** el gestor cancela en el segundo paso del diálogo de confirmación
  **Entonces** `RESERVA.estado` permanece `reserva_confirmada`; no se registra ninguna transición en `AUDIT_LOG`; el gestor puede reintentar el forzado o resolver las precondiciones pendientes
- Comportamiento del sistema: el doble paso de confirmación es un guardarraíl UX; la cancelación no tiene efectos secundarios

#### Múltiples precondiciones incumplidas simultáneamente
- **Dado** que `pre_evento_status ≠ cerrado`, `liquidacion_status ≠ cobrada` y `fianza_status ≠ cobrada` al mismo tiempo
  **Cuando** el gestor activa el forzado y confirma la doble confirmación
  **Entonces** la alerta muestra las tres precondiciones incumplidas de forma explícita antes de que el gestor confirme; el `AUDIT_LOG` registra las tres en `datos_nuevos.precondiciones_incumplidas`; la transición se ejecuta igualmente
- Comportamiento del sistema: el forzado es válido independientemente del número de precondiciones incumplidas

#### Intento de forzar fuera del día del evento
- **Dado** que `RESERVA.fecha_evento ≠ hoy` (el evento no es hoy — p. ej. el gestor abre la ficha el día anterior)
  **Cuando** el gestor navega a la ficha de la reserva
  **Entonces** el botón "Forzar inicio del evento" no aparece en la UI; no es posible ejecutar el forzado anticipado
- Comportamiento del sistema: el override solo está disponible el día del evento (`fecha_evento = TODAY`)

#### Cron llegó primero — reserva ya en evento_en_curso
- **Dado** que el cron job (US-031) transicionó la reserva a `evento_en_curso` mientras el gestor tenía la pantalla de alerta abierta
  **Cuando** el gestor pulsa "Forzar inicio del evento"
  **Entonces** el sistema detecta que `RESERVA.estado ≠ reserva_confirmada` (ya es `evento_en_curso`); informa: "El evento ya está en curso (iniciado automáticamente o por otro usuario). No es necesaria ninguna acción."; no se ejecuta ninguna transición adicional
- Comportamiento del sistema: idempotencia — la UI refresca el estado actual al detectar el conflicto

### 🔒 Concurrencia / Race Conditions

- **Dado** que dos sesiones del gestor (o el cron y el gestor) intentan simultáneamente ejecutar el forzado sobre la misma reserva en `reserva_confirmada`
  **Cuando** ambas operaciones leen `RESERVA.estado = reserva_confirmada` y ejecutan la UPDATE
  **Entonces** exactamente una operación actualiza el estado a `evento_en_curso` y registra en `AUDIT_LOG`; la segunda operación obtiene UPDATE-0-rows, detecta el conflicto y termina como no-op informando al gestor del estado actual

### 🚫 Reglas de Validación
- El botón "Forzar inicio del evento" solo es visible y activo cuando `RESERVA.estado = reserva_confirmada` y `RESERVA.fecha_evento = TODAY`
- El `AUDIT_LOG` de una transición forzada **debe** incluir `forzado_por_gestor = true` en `datos_nuevos` — es evidencia de auditoría obligatoria
- El forzado no modifica ni resuelve los sub-procesos paralelos incumplidos (`pre_evento_status`, `liquidacion_status`, `fianza_status` conservan su estado)
- La doble confirmación en UI es obligatoria; no puede eliminarse mediante parámetros de URL ni shortcuts

## 📊 Impacto de Negocio
- Impacto esperado: el gestor tiene capacidad de control operativo el día del evento ante impagos de última hora o incidencias en la ficha (D2); la trazabilidad en `AUDIT_LOG` con `forzado_por_gestor = true` proporciona evidencia ante disputas o auditorías posteriores
- Criterio de éxito: 100% de forzados de inicio registrados en `AUDIT_LOG` con `forzado_por_gestor = true` y lista de precondiciones incumplidas; cero transiciones forzadas sin doble confirmación explícita del gestor
