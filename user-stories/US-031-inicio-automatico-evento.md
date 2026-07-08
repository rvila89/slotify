---
id: US-031
estado: in-progress
branch: feature/us-031-inicio-automatico-evento
pr: null
---

# 🧾 Historia de Usuario: Sistema transiciona reserva a evento en curso cuando se cumplen las precondiciones

## 🆔 Metadatos
- ID: US-031
- Área funcional: Ejecución del Evento
- Módulo: M1 (Reservas — Pipeline, Histórico, Ficha y Cola), M8 (Tareas & Recordatorios — Slotify Tasks)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** el trigger horario (00:00) del día de `RESERVA.fecha_evento` y los tres sub-procesos paralelos están cerrados (`pre_evento_status = cerrado`, `liquidacion_status = cobrada`, `fianza_status = cobrada`)
**Ejecuto** la transición `reserva_confirmada → evento_en_curso` y activo la vista móvil con el checklist de documentación pendiente
**Para** garantizar que el evento comienza en Slotify solo cuando toda la preparación financiera y operativa está completada, eliminando el riesgo de iniciar un evento con deuda pendiente o ficha operativa sin cerrar

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-23 (flujo básico)
- Entidades implicadas: `RESERVA` (`estado`, `pre_evento_status`, `liquidacion_status`, `fianza_status`, `fecha_evento`, `cond_part_firmadas`), `AUDIT_LOG`
- Dolor(es) que resuelve: D9 (sin automatizaciones — transición que hoy se hace manualmente o se olvida), D10 (sin fichas organizadas — garantiza que la ficha está cerrada antes del evento), D2 (visibilidad del pipeline — el estado del evento pasa a ser visible en tiempo real)
- Automatización relacionada: mecanismo de barrido periódico (cron job sobre `RESERVA WHERE estado = 'reserva_confirmada' AND fecha_evento = today`) descrito en AGENTS.md (patrón "estado en fila + barrido periódico"); también A29 (Día del evento sin condiciones particulares firmadas → alerta al gestor) como efecto colateral
- Email relacionado: ninguno de E1–E8 en esta transición (el briefing operativo al equipo es 📐 — ver Notas de alcance)
- Reglas de negocio:
  - La transición se activa **solo** cuando las tres condiciones son ciertas simultáneamente el día de `RESERVA.fecha_evento`:
    1. `pre_evento_status = cerrado`
    2. `liquidacion_status = cobrada`
    3. `fianza_status = cobrada`
  - El cron de barrido evalúa reservas con `estado = reserva_confirmada` y `fecha_evento = TODAY` en cada ciclo
  - La transición es idempotente: si la reserva ya está en `evento_en_curso`, el cron la omite sin generar error
  - Si las tres precondiciones no se cumplen, el cron NO transiciona y genera alerta crítica al gestor (FA-01 cubierto en US-032)
  - A29 se dispara como efecto colateral si `cond_part_firmadas = false` el día del evento, independientemente del resultado de la transición
- Supuestos: el cron job se ejecuta al menos una vez al día; la zona horaria usada para comparar `fecha_evento = TODAY` es la del servidor o la del tenant
- Dependencias: US-025 / US-026 (`pre_evento_status = cerrado`), US-029 (`liquidacion_status = cobrada`), US-030 (`fianza_status = cobrada`)
- Notas de alcance:
  - **Briefing operativo al equipo** (UC-23 paso 5): el envío del briefing PDF al equipo el día del evento está **diseñado en la especificación pero no implementado en MVP TFM** (§9.3 último párrafo). No se referencia email Exx para esta acción en MVP
  - **A9 (T-3d briefing al equipo)**: también 📐 (lista negra: recordatorios automáticos extendidos). No implementado

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que `RESERVA.estado = reserva_confirmada`, `RESERVA.fecha_evento = hoy`, `pre_evento_status = cerrado`, `liquidacion_status = cobrada` y `fianza_status = cobrada`
  **Cuando** el cron de barrido se ejecuta el día del evento
  **Entonces**:
  - `RESERVA.estado = evento_en_curso`
  - La vista móvil "evento en curso" queda activa para el gestor y el equipo
  - El checklist de documentación del evento (DNI anverso, DNI reverso, cláusula de responsabilidad) se muestra como pendiente
  - Se registra en `AUDIT_LOG`: `accion = transicion`, `datos_anteriores = {estado: reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso}`

### ⚠️ Flujos Alternativos y Edge Cases

#### A29 — Condiciones particulares no firmadas el día del evento
- **Dado** que `RESERVA.fecha_evento = hoy`, las tres precondiciones están cumplidas pero `cond_part_firmadas = false`
  **Cuando** el cron ejecuta la transición
  **Entonces**:
  - `RESERVA.estado = evento_en_curso` (la transición se ejecuta igualmente)
  - El gestor recibe una alerta no bloqueante: "⚠️ Las condiciones particulares de esta reserva no están firmadas. El cliente puede firmarlas presencialmente."
- Comportamiento del sistema: alerta A29; no impide el inicio del evento

#### Precondiciones incumplidas — cron no transiciona
- **Dado** que `RESERVA.fecha_evento = hoy` pero alguna precondición no se cumple (p. ej. `liquidacion_status = facturada` en lugar de `cobrada`)
  **Cuando** el cron evalúa la reserva
  **Entonces** el cron no transiciona; el sistema genera alerta crítica al gestor: "⚠️ El evento de hoy [código reserva] tiene precondiciones incumplidas: [lista]. Puedes forzar el inicio manualmente."; `RESERVA.estado` permanece `reserva_confirmada`
- Comportamiento del sistema: el forzado manual está cubierto en US-032

#### Idempotencia — reserva ya en evento_en_curso
- **Dado** que `RESERVA.estado = evento_en_curso` (transición ya ejecutada por un ciclo anterior o por el gestor manualmente via US-032)
  **Cuando** el cron vuelve a evaluar la reserva en un ciclo posterior del mismo día
  **Entonces** el cron omite la reserva; no se genera ninguna transición adicional ni error; `AUDIT_LOG` no registra entrada duplicada
- Comportamiento del sistema: el filtro `WHERE estado = 'reserva_confirmada'` garantiza idempotencia

### 🔒 Concurrencia / Race Conditions

- **Dado** que el cron job y el gestor (US-032) intentan simultáneamente transicionar la misma `RESERVA` de `reserva_confirmada` a `evento_en_curso`
  **Cuando** ambas operaciones leen `RESERVA.estado = reserva_confirmada` en la misma ventana temporal y ejecutan la UPDATE
  **Entonces** exactamente una operación tiene éxito y actualiza `RESERVA.estado = evento_en_curso`; la segunda operación detecta que el estado ya no es `reserva_confirmada` (UPDATE afecta 0 filas) y termina como no-op sin error; el `AUDIT_LOG` contiene exactamente una entrada de transición

### 🚫 Reglas de Validación
- El cron solo evalúa reservas con `estado = reserva_confirmada` y `fecha_evento = TODAY` (no hay falsos positivos sobre otros estados)
- Las tres condiciones (`pre_evento_status`, `liquidacion_status`, `fianza_status`) se evalúan en una única lectura de la fila de `RESERVA` dentro de la transacción
- `fecha_evento` se compara usando la zona horaria configurada (servidor o tenant); no UTC implícito
- El `AUDIT_LOG` es obligatorio en toda transición de estado ejecutada por el cron

## 📊 Impacto de Negocio
- Impacto esperado: el estado del evento se actualiza automáticamente a las 00:00 del día del evento cuando todo está en orden, sin intervención manual del gestor; la vista móvil se activa para el equipo sin pasos adicionales (D9, D10); el pipeline en el calendario refleja `evento_en_curso` en tiempo real (D2)
- Criterio de éxito: 100% de eventos con las tres precondiciones cumplidas arrancan en `evento_en_curso` el día del evento; cero reservas con `fecha_evento = pasado` permanecen en `reserva_confirmada` al cierre del día
