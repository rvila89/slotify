---
id: US-037
estado: en-revision
branch: feature/us-037-archivado-automatico-reserva-completada
pr: 58
---

# 🧾 Historia de Usuario: Sistema archiva automáticamente la reserva a `reserva_completada` a T+7d de post_evento

## 🆔 Metadatos
- ID: US-037
- Área funcional: Post-evento
- Módulo: M1 (Reservas — Pipeline, Histórico, Ficha y Cola)
- Prioridad: Media
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** que han transcurrido 7 días naturales desde que `RESERVA.estado` pasó a `post_evento` y no quedan acciones pendientes (fianza resuelta o sin fianza)
**Ejecuto** la transición `post_evento → reserva_completada` e indexo la reserva para búsqueda en el módulo Histórico
**Para** garantizar que las reservas finalizadas llegan automáticamente al archivo sin depender de la intervención manual del gestor, manteniendo el histórico consultable siempre actualizado

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-28 (flujo básico automático, pasos 1–5)
- Entidades implicadas: `RESERVA` (`estado`, `fianza_status`, `fianza_eur`, `fecha_actualizacion`), `AUDIT_LOG`
- Dolor(es) que resuelve: D5 (histórico centralizado y consultable: las reservas completadas se archivan automáticamente sin acción manual del gestor), D9 (automatización del cierre administrativo elimina tarea repetitiva), D1 (estado terminal registrado con trazabilidad en sistema)
- Automatización relacionada: A12 (T+7d post-evento → Archivo automático en histórico consultable + indexación)
- Email relacionado: ninguno (el archivado automático no genera notificación al cliente)
- Reglas de negocio:
  - El trigger es el barrido periódico (cron job) que evalúa: `RESERVA.estado = post_evento` Y tiempo desde la transición a `post_evento` ≥ 7 días naturales
  - **Condición de fianza resuelta** (guarda obligatoria): la transición solo se ejecuta si `RESERVA.fianza_status ∈ {devuelta, retenida_parcial}` O `RESERVA.fianza_eur = 0` O `RESERVA.fianza_eur IS NULL`
  - Si la fianza **no** está resuelta en T+7d: el sistema **no** archiva y emite una alerta interna al gestor: "⚠️ La reserva [código] lleva más de 7 días en post_evento con fianza pendiente de resolución. Registra la devolución o retención para poder archivarla."
  - Si las condiciones se cumplen: `RESERVA.estado = reserva_completada` (estado terminal, inmutable)
  - La reserva queda indexada y accesible en el módulo Histórico (UC-32)
  - La operación es **idempotente**: si el cron evalúa una reserva ya archivada (`estado = reserva_completada`), no produce ningún efecto ni registro en `AUDIT_LOG`
  - El patrón de implementación es "estado en fila + barrido periódico" (cron que invoca endpoint protegido), conforme a la arquitectura definida en `AGENTS.md`
  - `AUDIT_LOG` registra la transición automática indicando que el actor es el sistema/cron (sin `usuario_id` de gestor, o con `usuario_id` de sistema reservado)
- Supuestos: el campo que marca la entrada en `post_evento` es `RESERVA.fecha_actualizacion` (timestamp de la última transición) o un campo `fecha_post_evento` específico; el cron usa ese valor para calcular T+7d
- Dependencias: US-034 (precondición: `RESERVA.estado = post_evento`), US-036 (si `fianza_eur > 0`: precondición fianza resuelta antes de T+7d para que el archivado no quede bloqueado)
- Notas de alcance:
  - **T+5d propuesta automática de cierre al gestor**: mencionada en spec (§8 dentro de post_evento). Esta alerta proactiva previa al archivado es `📐 Solo diseñado`. El archivado automático a T+7d sí está `✅`.
  - **Indexación full-text técnica**: la "indexación" implica que la reserva queda visible y filtrable en el módulo Histórico. El mecanismo técnico interno (índice Postgres full-text, TSVECTOR, etc.) es una decisión de implementación, no un requisito de esta historia.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — Archivado con fianza devuelta
- **Dado** que `RESERVA.estado = post_evento`, `RESERVA.fianza_status = devuelta` y han transcurrido 7 días naturales desde la transición a `post_evento`
  **Cuando** el cron job de barrido ejecuta la evaluación periódica
  **Entonces**:
  - `RESERVA.estado = reserva_completada`
  - La reserva aparece y es filtrable en el módulo Histórico
  - `AUDIT_LOG` registra `accion = transicion`, `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado: reserva_completada}` con indicación de actor sistema
  - No se envía ningún email al cliente ni al gestor

### ⚠️ Flujos Alternativos y Edge Cases

#### Happy Path — Sin fianza (fianza_eur = 0 o NULL)
- **Dado** que `RESERVA.estado = post_evento`, `RESERVA.fianza_eur = 0` (tenant sin fianza) y han transcurrido ≥ 7 días
  **Cuando** el cron ejecuta el barrido
  **Entonces** `RESERVA.estado = reserva_completada`; la condición de `fianza_status` no se evalúa (no hay fianza que resolver); la reserva queda indexada en Histórico
- Comportamiento del sistema: `fianza_eur = 0 OR NULL` equivale a ausencia de fianza → guarda de fianza satisfecha sin necesidad de `fianza_status ∈ {devuelta, retenida_parcial}`

#### Happy Path — Con fianza totalmente retenida (retención total)
- **Dado** que `RESERVA.fianza_status = retenida_parcial` y `RESERVA.fianza_devuelta_eur = 0.00` (retención del 100% por desperfectos) y han transcurrido ≥ 7 días en `post_evento`
  **Cuando** el cron ejecuta el barrido
  **Entonces** `RESERVA.estado = reserva_completada`; `retenida_parcial` con importe devuelto 0 es un estado resuelto válido para el archivado
- Comportamiento del sistema: el sistema no distingue entre `retenida_parcial` con importe > 0 y con importe = 0; ambos satisfacen la condición de fianza resuelta

#### FA-01 — Fianza no resuelta en T+7d
- **Dado** que `RESERVA.estado = post_evento`, `RESERVA.fianza_status = cobrada` (fianza cobrada pero sin devolución ni retención registradas) y han transcurrido ≥ 7 días desde `post_evento`
  **Cuando** el cron ejecuta el barrido
  **Entonces** el sistema **no** archiva la reserva; emite alerta interna al gestor: "⚠️ La reserva [código] lleva más de 7 días en post_evento. La fianza está pendiente de resolución. Registra la devolución o retención (US-036) para poder archivarla."; `RESERVA.estado` permanece `post_evento`
- Comportamiento del sistema: el barrido es idempotente; la alerta no se duplica en cada ejecución del cron si el estado no ha cambiado

#### FA-02 — Idempotencia (reserva ya archivada)
- **Dado** que `RESERVA.estado = reserva_completada` (archivada en ejecución anterior del cron o manualmente por US-038)
  **Cuando** el cron ejecuta el barrido y evalúa esta reserva
  **Entonces** el sistema no realiza ninguna acción ni genera ningún registro en `AUDIT_LOG`
- Comportamiento del sistema: la operación es idempotente por diseño; leer `estado = reserva_completada` es suficiente para saltar la reserva

### 🔒 Concurrencia / Race Conditions
- **Dado** que el cron de archivado automático (US-037) y el gestor mediante archivado manual (US-038) intentan transicionar la misma `RESERVA` de `post_evento → reserva_completada` de forma concurrente
  **Cuando** ambas operaciones se ejecutan simultáneamente
  **Entonces** exactamente una de las dos transiciones tiene éxito (la que llega primero); la segunda detecta `RESERVA.estado = reserva_completada` en su lectura transaccional y no produce error, no duplica el registro en `AUDIT_LOG` ni genera estado inconsistente
- Comportamiento del sistema: el chequeo del estado actual dentro de la transacción garantiza idempotencia; el patrón "leer-verificar-actualizar" en una única transacción evita la ventana de carrera

### 🚫 Reglas de Validación
- Solo se actúa sobre reservas con `RESERVA.estado = post_evento` cuyo tiempo en ese estado ≥ 7 días naturales
- Condición de fianza: `fianza_status ∈ {devuelta, retenida_parcial}` O `fianza_eur ≤ 0` O `fianza_eur IS NULL`; si no se cumple, la transición está bloqueada
- `reserva_completada` es un estado terminal e inmutable: no existe transición de salida
- `AUDIT_LOG` obligatorio, con indicación de que la transición fue ejecutada por el sistema/cron (no por un gestor)
- La operación debe ser idempotente: ejecutarla dos veces sobre la misma reserva no produce efectos adicionales

## 📊 Impacto de Negocio
- Impacto esperado: cero intervenciones manuales de archivado necesarias (D9); histórico siempre actualizado sin retraso acumulado (D5); trazabilidad del cierre administrativo en cada reserva (D1)
- Criterio de éxito: 100% de reservas en `post_evento` con fianza resuelta pasan a `reserva_completada` en ≤ 8 días naturales desde el evento; cero expedientes bloqueados indefinidamente en `post_evento` sin causa justificada
