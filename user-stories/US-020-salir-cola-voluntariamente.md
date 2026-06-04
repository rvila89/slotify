# 🧾 Historia de Usuario: Salir Voluntariamente de la Cola de Espera

## 🆔 Metadatos
- ID: US-020
- Área funcional: Gestión de Cola de Espera
- Módulo: M3
- Prioridad: Media
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor  
**Quiero** poder registrar la salida voluntaria de un cliente de la cola de espera de una fecha  
**Para** reflejar en el sistema su decisión explícita de no continuar esperando y mantener la cola limpia con solo candidatos activos

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-13
- Entidades implicadas: `RESERVA`, `AUDIT_LOG`
- Dolor(es) que resuelve: D2 (leads sin seguimiento unificado), D3 (información desactualizada del pipeline), D4 (cola con entradas obsoletas que distorsionan la visión de disponibilidad)
- Automatización relacionada: ninguna (acción manual deliberada del Gestor)
- Email relacionado: ninguno — la notificación al cliente de la salida de cola es `📐 Solo diseñado`, fuera del MVP (ver Notas de alcance)
- Reglas de negocio:
  - Solo puede ejecutarse sobre una `RESERVA` con `sub_estado = '2.d'`
  - La `RESERVA` pasa a `sub_estado = '2.z'` (terminal e inmutable)
  - `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`
  - Las `RESERVA` restantes en cola con `posicion_cola` mayor a la eliminada decrementan su `posicion_cola` en 1 (reordenación de FIFO)
  - La `FECHA_BLOQUEADA` no se modifica: pertenece a la consulta bloqueante, no a las consultas en cola
  - El motivo de salida (opcional, texto libre) se registra en `AUDIT_LOG.datos_nuevos`
  - Se crea un registro en `AUDIT_LOG` con el `usuario_id` del Gestor (acción `'transicion'`, entidad `RESERVA`)
  - La reordenación de `posicion_cola` del resto de la cola ocurre en la misma transacción que el cambio de sub_estado de la `RESERVA` saliente
- Supuestos: el Gestor registra la salida tras comunicación directa con el cliente (por cualquier canal); no existe mecanismo de notificación automática al cliente en MVP
- Dependencias: US-017 (vista de cola que habilita la acción); US-004 (para que exista cola es necesario que haya un bloqueo previo que haya generado consultas en `2.d`)
- Notas de alcance: la notificación al cliente de su salida de cola (UC-13 paso 6: "El sistema muestra confirmación al cliente") es `📐 Solo diseñado` — no se implementa en MVP. Solo la mecánica de la transición a `2.z` y la reordenación están en scope.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path
- **Dado** que R1 es la consulta bloqueante (sub_estado `2.b`), R2 tiene `sub_estado = '2.d'`, `posicion_cola = 1`, `consulta_bloqueante_id = R1.id`, y R3 tiene `sub_estado = '2.d'`, `posicion_cola = 2`, `consulta_bloqueante_id = R1.id`  
  **Cuando** el Gestor selecciona R2, elige "Forzar salida de cola", introduce el motivo opcional "Cliente no puede cubrir esa fecha" y confirma la acción  
  **Entonces**:
  - R2: `sub_estado → '2.z'`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`
  - R3: `posicion_cola → 1` (decrementa de 2 a 1); `consulta_bloqueante_id` permanece `R1.id` (sin cambio)
  - `FECHA_BLOQUEADA` no se modifica (sigue apuntando a R1)
  - `AUDIT_LOG`: entrada con `usuario_id` del Gestor, acción `'transicion'`, `entidad = 'RESERVA'`, `entidad_id = R2.id`, `datos_nuevos = {sub_estado: '2.z', motivo: 'Cliente no puede cubrir esa fecha'}`
  - La vista de cola se actualiza: R3 aparece ahora en posición 1; R2 no aparece en la cola

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: Salida del único elemento de la cola
- **Dado** que R1 es bloqueante y solo existe R2 en cola (`posicion_cola = 1`)  
  **Cuando** el Gestor saca a R2 de la cola  
  **Entonces** R2 → `2.z`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`; la cola queda vacía; `FECHA_BLOQUEADA` permanece inalterada apuntando a R1; `AUDIT_LOG` registra la salida de R2

#### FA-02: Salida sin motivo indicado
- **Dado** que el Gestor elige "Forzar salida de cola" y deja el campo de motivo vacío  
  **Cuando** el Gestor confirma la acción  
  **Entonces** la salida se ejecuta igualmente; `AUDIT_LOG.datos_nuevos` contiene el campo motivo como `null` o ausente; no se produce ningún error de validación

#### FA-03: Salida de posición intermedia (múltiples en cola)
- **Dado** que R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`), R4 (`posicion_cola = 3`) están en cola de R1  
  **Cuando** el Gestor saca a R3 (`posicion_cola = 2`)  
  **Entonces** R3 → `2.z`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`; R4: `posicion_cola → 2` (decrementa de 3 a 2); R2 no cambia (`posicion_cola = 1`); `AUDIT_LOG` registra la transición de R3 y la reordenación

#### FA-04: El Gestor cancela el diálogo de confirmación
- **Dado** que el Gestor ha seleccionado "Forzar salida de cola"  
  **Cuando** el Gestor hace clic en "Cancelar" en el diálogo  
  **Entonces** no se realiza ningún cambio de estado; R2 permanece en `2.d` con su `posicion_cola` intacta; la vista de cola no cambia

#### FA-05: Intento de salida sobre una RESERVA en estado terminal
- **Dado** que se intenta ejecutar esta acción sobre una `RESERVA` ya en sub_estado `2.z` (o cualquier otro terminal: `2.x`, `2.y`, `reserva_cancelada`)  
  **Cuando** el sistema recibe la petición  
  **Entonces** el sistema rechaza la operación con un error ("La consulta ya está en estado terminal y no puede modificarse"); no se realiza ningún cambio de datos

#### FA-06: Salida del último de la cola mientras la bloqueante también está procesándose (expiración concurrente)
- **Dado** que el barrido de TTL está procesando la expiración de R1 (bloqueante) al mismo tiempo que el Gestor saca a R2 (único elemento en `2.d`)  
  **Cuando** ambas operaciones se ejecutan concurrentemente  
  **Entonces** la transacción que primero complete su operación sobre `FECHA_BLOQUEADA` (en el caso de la expiración) o sobre `RESERVA` R2 (en el caso de la salida) determina el estado final; en ningún caso R2 queda en sub_estado `2.d` con `consulta_bloqueante_id` apuntando a una `RESERVA` en estado terminal; `AUDIT_LOG` registra ambas acciones con sus timestamps

### 🚫 Reglas de Validación
- La acción solo es válida para `RESERVA` con `sub_estado = '2.d'`; cualquier otro sub_estado produce rechazo con mensaje de error descriptivo
- El Gestor debe confirmar explícitamente la acción (el sub_estado `2.z` es terminal e irreversible en MVP)
- La reordenación de `posicion_cola` del resto de la cola y el cambio de sub_estado de R2 a `2.z` deben ocurrir en la misma transacción; no existe estado observable donde R2 esté en `2.z` y la `posicion_cola` del resto no haya sido actualizada

## 📊 Impacto de Negocio
- Impacto esperado: la cola de espera refleja en todo momento solo candidatos activos y reales, evitando que entradas obsoletas distorsionen la visión del pipeline de fechas disponibles
- Criterio de éxito: 0 `RESERVA` en sub_estado `2.d` que correspondan a clientes que ya comunicaron su no-interés sin que el Gestor haya podido registrarlo; `posicion_cola` siempre contigua tras cada operación de salida