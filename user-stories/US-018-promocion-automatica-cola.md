---
id: US-018
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Promoción Automática de la Primera Consulta en Cola

## 🆔 Metadatos
- ID: US-018
- Área funcional: Gestión de Cola de Espera
- Módulo: M3
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema  
**Cuando se cumple** que una consulta bloqueante ha transitado a sub_estado `2.x` (TTL agotado) y existen `RESERVA` en sub_estado `2.d` para la fecha liberada  
**Ejecuto** la promoción atómica de la primera consulta en cola (`posicion_cola = 1`) al sub_estado `2.b`, transfiriendo la titularidad de `FECHA_BLOQUEADA` y reordenando el resto de la cola  
**Para** garantizar que la fecha quede inmediatamente protegida por el siguiente candidato FIFO sin ventana de carrera, sin fecha huérfana y sin pérdida de posición

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-12 (flujo automático, encadenado desde UC-09)
- Entidades implicadas: `RESERVA`, `FECHA_BLOQUEADA`, `AUDIT_LOG`
- Dolor(es) que resuelve: D4 (doble bloqueo / fecha sin protección tras expiración), D13 (pérdida de lead en cola por inacción del sistema)
- Automatización relacionada: barrido periódico de TTL (mismo job cron que dispara US-012; la promoción se encadena inmediatamente tras cada expiración)
- Email relacionado: ninguno — el email de notificación al cliente promovido es `📐 Solo diseñado`, fuera del MVP (ver Notas de alcance)
- Reglas de negocio:
  - La promoción es FIFO estricta: siempre se promueve la `RESERVA` con `posicion_cola = 1`
  - La `RESERVA` promovida pasa a `sub_estado = '2.b'`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + tenant_settings.ttl_consulta_dias`
  - `FECHA_BLOQUEADA.reserva_id` se actualiza al id de la consulta promovida
  - `FECHA_BLOQUEADA.ttl_expiracion` se renueva a `now() + tenant_settings.ttl_consulta_dias`
  - `FECHA_BLOQUEADA.tipo_bloqueo` permanece `'blando'`
  - El resto de la cola decrementa `posicion_cola` en 1 y actualiza `consulta_bloqueante_id` al id de la nueva bloqueante
  - Toda la operación ocurre en una única transacción con `SELECT ... FOR UPDATE` sobre `FECHA_BLOQUEADA`
  - Se crea registro en `AUDIT_LOG` por cada `RESERVA` modificada (acción `'transicion'`)
- Supuestos: el barrido periódico es idempotente; si la fecha ya fue promovida por otra instancia del job, la segunda ejecución no produce efecto
- Dependencias: US-012 (expiración que establece el sub_estado `2.x` en la bloqueante y dispara este mecanismo)
- Notas de alcance: el email "¡La fecha está disponible!" al cliente promovido (UC-12 paso 8) es `📐 Solo diseñado` — no se implementa en MVP. Solo la mecánica de promoción y reordenación está en scope.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path
- **Dado** que R1 (sub_estado `2.b`, `ttl_expiracion` < now()) acaba de transitarse a `2.x` por el barrido de TTL (US-012), y existen R2 (`sub_estado = '2.d'`, `posicion_cola = 1`, `consulta_bloqueante_id = R1.id`) y R3 (`sub_estado = '2.d'`, `posicion_cola = 2`, `consulta_bloqueante_id = R1.id`)  
  **Cuando** el barrido encadena la ejecución de la promoción automática  
  **Entonces**:
  - R2: `sub_estado → '2.b'`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + 3 días`
  - R3: `posicion_cola → 1`, `consulta_bloqueante_id → R2.id`
  - `FECHA_BLOQUEADA`: `reserva_id → R2.id`, `ttl_expiracion → now() + 3 días`, `tipo_bloqueo = 'blando'`
  - `AUDIT_LOG`: entrada para R2 (acción `'transicion'`, datos_anteriores `{sub_estado: '2.d'}`, datos_nuevos `{sub_estado: '2.b', origen: 'promocion_automatica'}`)
  - La operación es completamente atómica: no existe ningún instante en que `FECHA_BLOQUEADA.reserva_id` apunte a R1 (ya en `2.x`) sin apuntar a la nueva bloqueante

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: Cola de un único elemento
- **Dado** que R1 expira y solo existe R2 en cola (`posicion_cola = 1`)  
  **Cuando** el barrido ejecuta la promoción  
  **Entonces** R2 → `2.b`, `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`; `FECHA_BLOQUEADA` actualizado con `reserva_id = R2.id`; la cola queda vacía; `AUDIT_LOG` registra la transición de R2

#### FA-02: Sin cola tras expiración
- **Dado** que R1 expira y no existe ninguna `RESERVA` con `consulta_bloqueante_id = R1.id`  
  **Cuando** el barrido detecta la situación  
  **Entonces** no se ejecuta ninguna promoción; `FECHA_BLOQUEADA` se elimina (la fecha queda disponible); `AUDIT_LOG` registra la liberación de la fecha; el sistema no entra en error

#### FA-03: Cola con más de dos elementos
- **Dado** que R1 expira y existen R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`), R4 (`posicion_cola = 3`)  
  **Cuando** se ejecuta la promoción  
  **Entonces** R2 → `2.b` (nueva bloqueante); R3: `posicion_cola → 1`, `consulta_bloqueante_id → R2.id`; R4: `posicion_cola → 2`, `consulta_bloqueante_id → R2.id`; `FECHA_BLOQUEADA.reserva_id → R2.id`

#### FA-04: Barrido ejecutado cuando la promoción ya fue realizada (idempotencia)
- **Dado** que una instancia del job ya promovió R2 y `FECHA_BLOQUEADA.reserva_id` ya es R2.id  
  **Cuando** una segunda instancia del job intenta procesar el mismo tenant/fecha  
  **Entonces** el sistema detecta que no hay bloqueante expirada pendiente de promotar y no realiza ningún cambio; sin error, sin duplicación

### 🔒 Concurrencia / Race Conditions

#### Race condition: dos instancias del job ejecutándose simultáneamente
- **Dado** que dos instancias del barrido se ejecutan concurrentemente sobre el mismo tenant y la misma fecha con R1 expirada  
  **Cuando** ambas intentan adquirir `SELECT ... FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`  
  **Entonces** exactamente una transacción adquiere el lock y completa la promoción de R2 a `2.b`; la segunda queda bloqueada hasta que la primera confirma (`COMMIT`) y entonces detecta que `FECHA_BLOQUEADA.reserva_id` ya no es R1 (o R1 ya está en `2.x` sin candidatos pendientes) y aborta sin realizar cambios; el resultado final es exactamente una promoción de R2; no existe doble bloqueo ni doble actualización de `posicion_cola`

#### Race condition: barrido automático vs. promoción manual simultánea (US-019)
- **Dado** que el barrido automático y el Gestor (US-019) inician simultáneamente una promoción sobre la misma fecha con R1 expirada  
  **Cuando** ambas transacciones intentan adquirir `SELECT ... FOR UPDATE` sobre `FECHA_BLOQUEADA`  
  **Entonces** la primera en adquirir el lock completa su promoción; la segunda, al obtener el lock, detecta el estado ya actualizado y aborta sin inconsistencia; si es la acción del Gestor la que falla, recibe un mensaje de error ("La cola ya fue actualizada automáticamente")

### 🚫 Reglas de Validación
- El mecanismo solo se ejecuta si la `RESERVA` que acaba de expirar tenía `sub_estado = '2.b'`, `'2.c'` o `'2.v'` antes de la expiración (es la bloqueante); no aplica a consultas en `2.d`
- El `ttl_expiracion` nuevo de R2 se calcula como `now() + tenant_settings.ttl_consulta_dias` (configurable por tenant, default 3 días)
- Si la `posicion_cola` del conjunto en cola no es contigua (anomalía de datos), el sistema registra la inconsistencia en `AUDIT_LOG` y aborta la transacción sin promover; no aplica corrección silenciosa
- La operación completa (expiración de R1 + promoción de R2 + reordenación) debe ser indivisible; no hay estado observable intermedio entre los dos estados

## 📊 Impacto de Negocio
- Impacto esperado: ningún lead en cola pierde su oportunidad por inacción del sistema; la fecha siempre queda protegida si hay candidatos FIFO en espera, sin intervención manual del Gestor
- Criterio de éxito: 0 casos en que una `FECHA_BLOQUEADA` quede con `reserva_id` apuntando a una `RESERVA` en estado terminal mientras existan candidatos en `2.d`; latencia de promoción ≤ intervalo de ejecución del job cron
