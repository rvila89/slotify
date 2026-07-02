---
id: US-017
estado: done
branch: feature/us-017-visualizar-cola-espera
pr: https://github.com/rvila89/slotify/pull/33
---

# 🧾 Historia de Usuario: Visualizar Cola de Espera de una Fecha

## 🆔 Metadatos
- ID: US-017
- Área funcional: Gestión de Cola de Espera
- Módulo: M3
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor  
**Quiero** visualizar la cola de espera de una fecha concreta (consulta bloqueante + consultas en espera ordenadas por posición FIFO)  
**Para** conocer en todo momento el estado de competencia sobre esa fecha y tomar decisiones informadas sobre gestión o promoción de la cola

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-11
- Entidades implicadas: `RESERVA`, `FECHA_BLOQUEADA`, `CLIENTE`
- Dolor(es) que resuelve: D2 (leads sin seguimiento unificado), D4 (conflicto de fechas sin visibilidad)
- Automatización relacionada: ninguna (consulta de solo lectura)
- Email relacionado: ninguno
- Reglas de negocio:
  - La cola existe únicamente cuando hay una `FECHA_BLOQUEADA` activa y al menos una `RESERVA` con `sub_estado = '2.d'` y `consulta_bloqueante_id` apuntando a la reserva bloqueante
  - Las consultas en cola se muestran ordenadas ascendentemente por `posicion_cola`
  - El TTL restante de la consulta bloqueante se calcula como `ttl_expiracion − now()`
  - La consulta bloqueante puede estar en sub_estado `2.b`, `2.c` o `2.v`
- Supuestos: el calendario identifica visualmente las fechas con cola mediante un indicador distintivo que el Gestor puede seleccionar
- Dependencias: US-004 (bloqueo de fecha que origina la cola), US-007 (sub_estado `2.c` como posible estado de la bloqueante), US-008 (sub_estado `2.v` como posible estado de la bloqueante)
- Notas de alcance: ninguna zona `📐` afectada en esta historia; es lectura pura

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path
- **Dado** que existe una `FECHA_BLOQUEADA` para `2026-09-12` con `reserva_id = R1` (R1 en sub_estado `2.b`, `ttl_expiracion` = mañana a las 10:00), y dos `RESERVA` en sub_estado `2.d`: R2 con `posicion_cola = 1, consulta_bloqueante_id = R1.id`, creada hace 2 horas; y R3 con `posicion_cola = 2, consulta_bloqueante_id = R1.id`, creada hace 30 minutos  
  **Cuando** el Gestor selecciona la fecha `2026-09-12` en el calendario  
  **Entonces** el sistema muestra:
  - Sección "Consulta bloqueante": nombre y apellidos del cliente de R1, sub_estado `2.b`, TTL restante (≈ 22 h), código de R1
  - Sección "Cola de espera": R2 en posición 1 (tiempo en cola ≈ 2 h) y R3 en posición 2 (tiempo en cola ≈ 30 min), con nombre de cliente y código de cada RESERVA
  - Acceso a la ficha de cualquier RESERVA de la lista

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: Fecha sin cola (solo consulta bloqueante)
- **Dado** que existe una `FECHA_BLOQUEADA` con `reserva_id = R1` y ninguna `RESERVA` con `consulta_bloqueante_id = R1`  
  **Cuando** el Gestor selecciona esa fecha  
  **Entonces** el sistema muestra la sección de consulta bloqueante con los datos de R1 y la sección de cola vacía (mensaje: "Sin consultas en espera para esta fecha")

#### FA-02: Consulta bloqueante en sub_estado 2.c
- **Dado** que R1 está en sub_estado `2.c` (pendiente de invitados) con una consulta en cola  
  **Cuando** el Gestor visualiza la cola  
  **Entonces** el sistema muestra R1 con sub_estado `2.c` y el TTL correcto; las consultas en cola se muestran con el mismo formato

#### FA-03: Consulta bloqueante en sub_estado 2.v
- **Dado** que R1 está en sub_estado `2.v` (visita programada) con `visita_programada_fecha` definida  
  **Cuando** el Gestor visualiza la cola  
  **Entonces** el sistema muestra R1 con sub_estado `2.v`, la fecha de visita programada y el TTL vigente; las consultas en cola se muestran ordenadas igualmente

#### FA-04: Fecha sin FECHA_BLOQUEADA
- **Dado** que la fecha seleccionada no tiene ningún registro en `FECHA_BLOQUEADA`  
  **Cuando** el Gestor selecciona esa fecha  
  **Entonces** el sistema muestra "Fecha disponible" sin sección de cola ni de consulta bloqueante

#### FA-05: Cola con un único elemento
- **Dado** que solo existe R2 en cola (posicion_cola = 1) para una fecha bloqueada por R1  
  **Cuando** el Gestor visualiza la cola  
  **Entonces** el sistema muestra R1 como bloqueante y R2 como único elemento de la cola en posición 1

### 🚫 Reglas de Validación
- Solo se muestran `RESERVA` con `sub_estado = '2.d'` y `consulta_bloqueante_id` apuntando a la bloqueante activa de esa fecha; cualquier otro sub_estado queda excluido de la lista de cola
- El tiempo en cola de cada RESERVA en `2.d` se calcula desde su `fecha_creacion`
- El indicador de cola en el calendario solo es visible cuando hay al menos una `RESERVA` en `2.d` apuntando a la bloqueante de esa fecha

## 📊 Impacto de Negocio
- Impacto esperado: el Gestor dispone de visibilidad completa sobre la competencia de leads para cada fecha, eliminando la gestión "de memoria" o en herramientas externas
- Criterio de éxito: el Gestor puede conocer el estado completo de la cola de cualquier fecha en menos de 10 segundos desde el calendario, sin necesidad de abrir fichas individuales