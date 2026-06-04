# 🧾 Historia de Usuario: Cumplimentar y cerrar la ficha operativa del evento

## 🆔 Metadatos
- ID: US-025
- Área funcional: Sub-procesos Paralelos
- Módulo: M7 (Ficha operativa del Evento / Slotify Brief)
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** cumplimentar progresivamente la ficha operativa del evento y marcarla como cerrada cuando esté completa
**Para** centralizar todos los datos operativos del evento en un único lugar consultable por el equipo, eliminando el briefing disperso en emails y WhatsApp (D10) y garantizando que la precondición de inicio del evento queda cubierta

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-20
- Entidades implicadas: `RESERVA` (`pre_evento_status`), `FICHA_OPERATIVA` (`ficha_cerrada`, `fecha_cierre`, `num_invitados_confirmado`, `menu_seleccionado`, `timing_detallado`, `contacto_evento_nombre`, `contacto_evento_telefono`, `notas_operativas`, `briefing_equipo`), `AUDIT_LOG`
- Dolor(es) que resuelve: D10, D9, D1
- Automatización relacionada: A8 (Inicio sub-proceso pre-evento: email al cliente confirmando nº invitados, menú, timing — **📐 Solo diseñado, no implementado en MVP**)
- Email relacionado: ninguno de E1–E8 en la acción manual del gestor de este paso
- Reglas de negocio:
  - La `FICHA_OPERATIVA` existe y es editable solo cuando `RESERVA.estado = reserva_confirmada` (o fases posteriores); se crea vacía al transicionar a `reserva_confirmada` (UC-17)
  - `pre_evento_status` transiciona `pendiente → en_curso` al persistir los primeros datos en la ficha
  - `pre_evento_status` transiciona `en_curso → cerrado` cuando el gestor activa "Cerrar ficha"
  - `FICHA_OPERATIVA.ficha_cerrada = true` y `fecha_cierre = now()` al cerrar
  - Relación 1:1 con `RESERVA`: `FICHA_OPERATIVA.reserva_id UNIQUE`
  - `pre_evento_status = cerrado` es una de las tres precondiciones para transicionar a `evento_en_curso` (junto con `liquidacion_status = cobrada` y `fianza_status = cobrada`)
  - Ningún campo de la ficha es bloqueante obligatorio al cerrar (el cierre no requiere ficha completa)
- Supuestos: el gestor cumplimenta la ficha antes de T-1d; si no lo hace, el sistema la cierra automáticamente (ver US-026)
- Dependencias: US-021 (la `FICHA_OPERATIVA` vacía se crea al activar `reserva_confirmada`)
- Notas de alcance:
  - A8 (email al cliente confirmando datos de pre-evento) es 📐 (lista negra: recordatorios automáticos extendidos)
  - A9 (T-3d, briefing PDF al equipo) es 📐
  - El cierre automático a T-1d es **US-026** (actor Sistema)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que existe una `RESERVA` en `estado = reserva_confirmada` con `pre_evento_status = pendiente` y su `FICHA_OPERATIVA` vacía asociada
  **Cuando** el gestor abre la ficha operativa, introduce datos (`num_invitados_confirmado = 85`, `timing_detallado = "18h llegada, 19h cena, 00h fin"`, `contacto_evento_nombre = "María López"`, `notas_operativas = "Alergia a los frutos secos"`) y guarda
  **Entonces** el sistema persiste los campos en `FICHA_OPERATIVA`, `RESERVA.pre_evento_status` pasa a `en_curso`, y el cambio queda registrado en `AUDIT_LOG`

- **Dado** que `FICHA_OPERATIVA` tiene datos y `pre_evento_status = en_curso`
  **Cuando** el gestor hace clic en "Cerrar ficha" y confirma
  **Entonces** el sistema actualiza `FICHA_OPERATIVA.ficha_cerrada = true`, `FICHA_OPERATIVA.fecha_cierre = now()`, `RESERVA.pre_evento_status = cerrado`, y registra la transición en `AUDIT_LOG`

### ⚠️ Flujos Alternativos y Edge Cases

#### Cierre con campos opcionales vacíos
- **Dado** que la `FICHA_OPERATIVA` tiene `num_invitados_confirmado` relleno pero `menu_seleccionado` y `briefing_equipo` vacíos
  **Cuando** el gestor hace clic en "Cerrar ficha"
  **Entonces** el sistema permite el cierre sin bloqueo; muestra un aviso informativo sobre los campos vacíos (no es error); `pre_evento_status` pasa a `cerrado`
- Comportamiento del sistema: cierre no bloqueado por campos vacíos; el aviso es puramente informativo

#### Edición de la ficha tras cerrarla
- **Dado** que `FICHA_OPERATIVA.ficha_cerrada = true` y `RESERVA.pre_evento_status = cerrado`
  **Cuando** el gestor modifica un campo (ej. actualiza el número de invitados confirmados)
  **Entonces** el sistema permite la edición, persiste el cambio, actualiza `fecha_cierre = now()`, y registra el cambio en `AUDIT_LOG`; `pre_evento_status` permanece `cerrado` (la edición no reabre el estado salvo acción explícita)
- Comportamiento del sistema: la ficha es editable incluso cerrada; la modificación no regresa el estado a `en_curso` automáticamente

#### Acceso a la ficha operativa antes de `reserva_confirmada`
- **Dado** que la `RESERVA` está en `estado = pre_reserva`
  **Cuando** el gestor intenta acceder a la ficha operativa
  **Entonces** el sistema muestra un mensaje contextual: "La ficha operativa estará disponible una vez confirmada la reserva"; no existe `FICHA_OPERATIVA` aún
- Comportamiento del sistema: acceso restringido por estado; ninguna entidad creada prematuramente

### 🚫 Reglas de Validación
- `FICHA_OPERATIVA` solo existe y es editable cuando `RESERVA.estado ∈ {reserva_confirmada, evento_en_curso, post_evento}`
- `FICHA_OPERATIVA.reserva_id` es `UNIQUE` (relación 1:1)
- La transición `pre_evento_status: pendiente → en_curso` ocurre al primer guardado con datos; no requiere confirmación explícita del gestor

## 📊 Impacto de Negocio
- Impacto esperado: Eliminación del briefing disperso en hilos de email y WhatsApp (D10); el equipo accede a todos los datos del evento desde un único documento en Slotify
- Criterio de éxito: 100% de reservas confirmadas con `FICHA_OPERATIVA` cumplimentada antes del evento; reducción de incidencias operativas el día del evento por información incompleta