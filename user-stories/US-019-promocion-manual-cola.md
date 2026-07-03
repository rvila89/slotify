---
id: US-019
estado: en_progreso
branch: feature/us-019-promocion-manual-cola
pr: null
---

# 🧾 Historia de Usuario: Promoción Manual de Consulta en Cola por el Gestor

## 🆔 Metadatos
- ID: US-019
- Área funcional: Gestión de Cola de Espera
- Módulo: M3
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor  
**Quiero** poder promover manualmente cualquier consulta de la cola (no necesariamente la primera) al bloqueo activo de una fecha  
**Para** gestionar excepciones de negocio —como un cliente con mayor madurez o urgencia— sin esperar a que el FIFO automático actúe

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-12 (flujo alternativo manual — FA del UC)
- Entidades implicadas: `RESERVA`, `FECHA_BLOQUEADA`, `AUDIT_LOG`
- Dolor(es) que resuelve: D2 (control del Gestor sobre leads activos), D4 (gestión de conflicto de fechas)
- Automatización relacionada: ninguna (acción deliberada del Gestor)
- Email relacionado: ninguno — el email de notificación al cliente promovido es `📐 Solo diseñado`, fuera del MVP (ver Notas de alcance)
- Reglas de negocio:
  - El Gestor puede seleccionar cualquier `RESERVA` de la cola (cualquier `posicion_cola`), no solo la primera
  - Si la consulta bloqueante actual sigue activa (sub_estado `2.b`, `2.c` o `2.v` con TTL vigente), el sistema la expira forzosamente (`sub_estado → '2.x'`, `ttl_expiracion → NULL`) antes de ejecutar la promoción
  - La `RESERVA` promovida pasa a `sub_estado = '2.b'`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + tenant_settings.ttl_consulta_dias`
  - `FECHA_BLOQUEADA.reserva_id` → id de la `RESERVA` promovida; `ttl_expiracion → now() + tenant_settings.ttl_consulta_dias`; `tipo_bloqueo = 'blando'`
  - El resto de la cola se reordena eliminando el hueco de la posición promovida (las posiciones superiores decrementan en 1) y actualizando `consulta_bloqueante_id` a la nueva bloqueante
  - Toda la operación ocurre en una única transacción con `SELECT ... FOR UPDATE` sobre `FECHA_BLOQUEADA`
  - El Gestor debe confirmar la acción explícitamente antes de ejecutarla (acción destructiva: expira la bloqueante activa)
  - Se crea registro en `AUDIT_LOG` por cada `RESERVA` modificada, incluyendo el `usuario_id` del Gestor (acción `'transicion'`)
- Supuestos: el Gestor accede a esta acción desde la vista de cola de US-017
- Dependencias: US-017 (vista de cola que expone la acción de promoción manual), US-012 (mecanismo de expiración que también aplica forzosamente aquí)
- Notas de alcance: el email "¡La fecha está disponible!" al cliente promovido (UC-12 paso 8) es `📐 Solo diseñado` — no se implementa en MVP. Solo la mecánica de promoción, expiración forzosa de la bloqueante y reordenación están en scope.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path
- **Dado** que la fecha `2026-09-12` tiene R1 como bloqueante (sub_estado `2.b`, TTL vigente), con R2 (`posicion_cola = 1`) y R3 (`posicion_cola = 2`) en cola; el Gestor visualiza la cola (US-017)  
  **Cuando** el Gestor selecciona R3 en la lista, hace clic en "Promover a bloqueante" y confirma la acción en el diálogo de confirmación  
  **Entonces**:
  - R1: `sub_estado → '2.x'`, `ttl_expiracion → NULL` (expirada forzosamente)
  - R3: `sub_estado → '2.b'`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + 3 días`
  - R2: `posicion_cola → 1` (ocupa el hueco dejado por R3), `consulta_bloqueante_id → R3.id`
  - `FECHA_BLOQUEADA`: `reserva_id → R3.id`, `ttl_expiracion → now() + 3 días`
  - `AUDIT_LOG`: entrada con `usuario_id` del Gestor, acción `'transicion'`, entradas para R1 (expiración forzosa), R2 (reordenación) y R3 (promoción manual)
  - La vista de cola se actualiza mostrando R3 como nueva bloqueante y R2 como único elemento de cola en posición 1

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: Promover la primera de la cola (posicion_cola = 1)
- **Dado** R1 como bloqueante, R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`)  
  **Cuando** el Gestor selecciona R2 y confirma la promoción  
  **Entonces** R1 → `2.x`; R2 → `2.b` (nueva bloqueante, posicion_cola = NULL); R3: `posicion_cola → 1`, `consulta_bloqueante_id → R2.id`; `FECHA_BLOQUEADA.reserva_id → R2.id`

#### FA-02: Consulta bloqueante ya expirada (TTL agotado antes de la acción manual)
- **Dado** que R1 tiene `ttl_expiracion < now()` pero el barrido automático aún no la ha procesado  
  **Cuando** el Gestor promueve cualquier consulta de la cola manualmente  
  **Entonces** el sistema detecta que R1 ya expiró, la marca como `2.x`, ejecuta la promoción elegida por el Gestor y reordena la cola; el `SELECT ... FOR UPDATE` sobre `FECHA_BLOQUEADA` garantiza que el barrido automático (si llega concurrentemente) no duplique la operación

#### FA-03: Cola de un único elemento
- **Dado** R1 como bloqueante y solo R2 en cola (`posicion_cola = 1`)  
  **Cuando** el Gestor promueve R2  
  **Entonces** R1 → `2.x`; R2 → `2.b`; `FECHA_BLOQUEADA.reserva_id → R2.id`; la cola queda vacía; `AUDIT_LOG` registra ambas transiciones

#### FA-04: El Gestor cancela el diálogo de confirmación
- **Dado** que el Gestor ha seleccionado una consulta y el sistema muestra el diálogo de confirmación  
  **Cuando** el Gestor hace clic en "Cancelar"  
  **Entonces** no se realiza ningún cambio de estado; R1 sigue activa como bloqueante; la cola permanece inalterada; la vista vuelve a su estado anterior

#### FA-05: La consulta seleccionada ya no está en `2.d` (expiró o fue actualizada entre la vista y la acción)
- **Dado** que el Gestor abrió la vista de cola y la consulta que intenta promover transitó a estado terminal (2.x, 2.y, 2.z) antes de que confirmara  
  **Cuando** el Gestor confirma la promoción  
  **Entonces** el sistema detecta que `sub_estado ≠ '2.d'` en la consulta seleccionada, rechaza la operación con un mensaje de error ("La consulta seleccionada ya no está en cola") y no realiza ningún cambio

### 🔒 Concurrencia / Race Conditions

#### Race condition: promoción manual vs. barrido automático simultáneos
- **Dado** que el Gestor inicia una promoción manual y, simultáneamente, el barrido de TTL (US-018) intenta promover la primera de la cola para la misma fecha  
  **Cuando** ambas transacciones intentan adquirir `SELECT ... FOR UPDATE` sobre la misma fila de `FECHA_BLOQUEADA`  
  **Entonces** la primera en adquirir el lock completa su operación (puede ser la manual o la automática); la segunda, al obtener el lock, detecta que el estado ya cambió (p. ej., `FECHA_BLOQUEADA.reserva_id` ya no apunta a R1 o R1 ya está en `2.x`) y aborta sin inconsistencia; si la acción del Gestor es la que falla, recibe el mensaje "La cola ya fue actualizada automáticamente, por favor recarga la vista"

#### Race condition: dos Gestores promueven simultáneamente en la misma cola
- **Dado** que dos Gestores (sesiones distintas) inician simultáneamente una promoción de consultas distintas de la misma cola  
  **Cuando** ambas transacciones intentan adquirir `SELECT ... FOR UPDATE` sobre `FECHA_BLOQUEADA`  
  **Entonces** exactamente una transacción completa; la otra recibe el lock, detecta el estado inconsistente (la consulta que quería promover ya no tiene `posicion_cola` válida o la bloqueante ya fue expirada) y aborta mostrando el error al Gestor correspondiente

### 🚫 Reglas de Validación
- Solo puede promoverse una `RESERVA` con `sub_estado = '2.d'`; cualquier otro sub_estado produce rechazo inmediato
- El Gestor debe confirmar explícitamente la acción antes de ejecutarla (la expiración forzosa de la bloqueante es irreversible)
- El nuevo `ttl_expiracion` de la `RESERVA` promovida es `now() + tenant_settings.ttl_consulta_dias` (configurable por tenant)
- No se puede promover una consulta si no existe `FECHA_BLOQUEADA` para esa fecha (error de inconsistencia de datos)

## 📊 Impacto de Negocio
- Impacto esperado: el Gestor puede intervenir de forma informada y segura en excepciones de negocio, sin romper la integridad del modelo de cola ni exponer ventanas de doble bloqueo
- Criterio de éxito: 0 inconsistencias de estado (fecha sin bloqueo activo, `posicion_cola` no contigua, `RESERVA` en `2.d` con `consulta_bloqueante_id` apuntando a una bloqueante en estado terminal) tras cualquier promoción manual
