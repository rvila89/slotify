---
id: US-011
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Registrar resultado de visita — cliente descarta (2.v → 2.z)

## 🆔 Metadatos
- ID: US-011
- Área funcional: Gestión de Leads y Consultas
- Módulo: M1 — Reserva (entidad central), M2 — Calendario & Disponibilidad
- Prioridad: Alta
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** registrar que el cliente ha descartado el espacio tras la visita, marcando la consulta como terminada y liberando la fecha bloqueada
**Para** limpiar el pipeline, liberar la disponibilidad del espacio y, si había cola de espera, promover automáticamente el primer lead sin intervención adicional

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-08 (FA-02 — cliente descarta tras visita)
- Entidades implicadas: RESERVA, FECHA_BLOQUEADA, AUDIT_LOG
- Dolor(es) que resuelve: D2 (pipeline limpio sin leads fantasma), D4 (fecha liberada para nuevas consultas), D13 (cola promovida automáticamente si existía)
- Automatización relacionada: A15 (si había cola: promoción del primer elemento — primera en cola pasa a 2.b + reordenación). Esta mecánica es idéntica a la de UC-09/UC-12; aquí se ejecuta como consecuencia de la liberación de la fecha
- Email relacionado: ninguno en MVP. Los emails de cola (promoción) son 📐 Solo diseñado; la mecánica de promoción sí es ✅
- Reglas de negocio:
  - La RESERVA debe estar en sub_estado = '2v'
  - Al registrar resultado "cliente descarta": `visita_realizada` = true, sub_estado = '2z'
  - 2.z es un estado terminal: la RESERVA es inmutable a partir de este punto
  - La fila de FECHA_BLOQUEADA con reserva_id = esta reserva se elimina (la fecha queda disponible)
  - Si había cola (RESERVA en sub_estado '2d' con consulta_bloqueante_id = id de esta reserva): en la misma transacción, la primera en cola (posicion_cola = 1) pasa a sub_estado = '2b' con ttl_expiracion = now + TENANT_SETTINGS.ttl_consulta_dias; se crea nueva fila en FECHA_BLOQUEADA para la reserva promovida; el resto de la cola decrementa posicion_cola en 1 y actualiza consulta_bloqueante_id al id de la reserva promovida (nueva bloqueante)
  - Toda la operación (RESERVA → 2.z + eliminación FECHA_BLOQUEADA + promoción y reordenación de cola) es atómica
- Supuestos: el cliente ha comunicado explícitamente al gestor que no desea reservar el espacio
- Dependencias: US-008 (RESERVA en '2v'). US-001 (sesión activa)
- Notas de alcance:
  - Los emails de promoción de cola (A15) al cliente promovido son 📐 Solo diseñado en MVP. La mecánica de promoción (cambio de sub_estado, FECHA_BLOQUEADA, reordenación) sí está ✅. El cliente promovido será notificado manualmente por el gestor
  - La mecánica de promoción de cola es idéntica a la de UC-12 (área Cola de Espera, que se especificará en el lote siguiente)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — sin cola activa
- **Dado** que el Gestor abre la ficha de una RESERVA en sub_estado = '2v' sin consultas en '2d' apuntando a ella como bloqueante
  **Cuando** el gestor selecciona "Registrar resultado de visita" → "Cliente descarta"
  **Entonces** la RESERVA actualiza: visita_realizada = true, sub_estado = '2z'

- **Dado** que la RESERVA ha pasado a '2z'
  **Cuando** el sistema completa la transición
  **Entonces** la fila de FECHA_BLOQUEADA con reserva_id = esta reserva se elimina; la fecha queda disponible para nuevas consultas

- **Dado** que la transición ha completado
  **Cuando** el sistema registra la operación
  **Entonces** se registra en AUDIT_LOG con accion = 'transicion', entidad = 'RESERVA', datos_anteriores.sub_estado = '2v', datos_nuevos.sub_estado = '2z', datos_nuevos.visita_realizada = true

### 🎯 Happy Path — con cola activa (mecánica A15)
- **Dado** que la RESERVA en '2v' es consulta_bloqueante de N consultas en sub_estado '2d'
  **Cuando** el gestor registra "cliente descarta"
  **Entonces** en la misma transacción atómica:
  - RESERVA transitada → sub_estado = '2z', visita_realizada = true
  - FECHA_BLOQUEADA de la reserva transitada eliminada
  - La consulta con posicion_cola = 1 pasa a sub_estado = '2b', posicion_cola = NULL, consulta_bloqueante_id = NULL, ttl_expiracion = now + TENANT_SETTINGS.ttl_consulta_dias
  - Se crea nueva fila en FECHA_BLOQUEADA para la reserva promovida con tipo_bloqueo = 'blando', ttl_expiracion = ttl_expiracion de la reserva promovida
  - El resto de las RESERVA en '2d' de la misma cola decrementan posicion_cola en 1 y actualizan consulta_bloqueante_id = id de la reserva promovida

- **Dado** que la cola ha sido reordenada
  **Cuando** el sistema finaliza la transacción
  **Entonces** ninguna RESERVA en '2d' conserva consulta_bloqueante_id apuntando a la RESERVA transitada; la nueva bloqueante es la promovida; AUDIT_LOG registra la transición de la RESERVA promovida (sub_estado '2d' → '2b')

### ⚠️ Flujos Alternativos y Edge Cases

#### FA: RESERVA no en 2.v — transición inválida
- **Dado** que la RESERVA no está en sub_estado = '2v'
  **Cuando** el gestor intenta registrar "cliente descarta"
  **Entonces** el sistema rechaza la acción con error de validación; la RESERVA no se modifica

#### FA: Intento de modificar desde 2.z
- **Dado** que la RESERVA está en sub_estado = '2z'
  **Cuando** cualquier actor intenta modificar el estado de la reserva
  **Entonces** el sistema rechaza la acción; 2.z es un estado terminal inmutable

#### FA: Cola con un único elemento
- **Dado** que había exactamente 1 consulta en '2d' apuntando a la reserva en '2v'
  **Cuando** el gestor registra el descarte
  **Entonces** esa única consulta se promueve a '2b'; no hay más elementos de cola que reordenar

### 🔒 Concurrencia / Race Conditions
- **Dado** que la eliminación de FECHA_BLOQUEADA y la creación de la nueva fila para la reserva promovida son parte de la misma transacción
  **Cuando** una nueva solicitud de bloqueo para la misma fecha/tenant llega concurrentemente (nuevo lead)
  **Entonces** la restricción UNIQUE(tenant_id, fecha) en FECHA_BLOQUEADA garantiza que no puede haber dos bloqueos simultáneos para la misma fecha; la nueva inserción solo puede tener éxito después de que la eliminación de la fila original haya hecho commit — nunca hay doble bloqueo (D4)

- **Dado** que el barrido periódico de TTLs (US-012/A21) puede intentar expirar la misma RESERVA en '2v' justo en el mismo instante que el gestor registra el descarte
  **Cuando** ambas transacciones compiten sobre la misma RESERVA
  **Entonces** la primera en commitear tiene éxito; la segunda no encuentra la RESERVA en '2v' (ya está en '2z' o '2x') y no actúa; el resultado es coherente y determinista

### 🚫 Reglas de Validación
- sub_estado debe ser '2v' para iniciar la transición
- 2.z es inmutable tras la transición; no puede reabrise
- La eliminación de FECHA_BLOQUEADA, la transición de RESERVA y (si aplica) la promoción y reordenación de cola son atómicas
- Si la cola tiene 0 elementos en '2d', la operación completa correctamente (sin acción de cola)
- visita_realizada = true se establece incluso en el caso de descarte

## 📊 Impacto de Negocio
- Impacto esperado: Cierra el ciclo de la visita para descartes de forma inmediata y atómica, liberando la fecha para nuevas oportunidades (D4) y promoviendo la cola sin intervención adicional del gestor (D13). El pipeline permanece limpio sin leads en estados zombi (D2)
- Criterio de éxito: 100 % de descartes post-visita eliminan la fila de FECHA_BLOQUEADA y promueven la cola atómicamente; 0 RESERVA en '2z' con fila activa en FECHA_BLOQUEADA; 0 RESERVA en '2d' con consulta_bloqueante_id apuntando a una RESERVA en '2z'