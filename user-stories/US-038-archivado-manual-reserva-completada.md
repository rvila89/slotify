# 🧾 Historia de Usuario: Gestor archiva manualmente la reserva a `reserva_completada` antes del T+7d automático

## 🆔 Metadatos
- ID: US-038
- Área funcional: Post-evento
- Módulo: M1 (Reservas — Pipeline, Histórico, Ficha y Cola)
- Prioridad: Media
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** poder archivar manualmente una reserva que está en `post_evento` cuando todos los trámites están resueltos
**Para** moverla al histórico consultable sin tener que esperar al archivado automático a T+7d, manteniendo el pipeline de reservas activas limpio y actualizado

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-28 (flujo alternativo manual, pasos 1–5 del flujo alternativo)
- Entidades implicadas: `RESERVA` (`estado`, `fianza_status`, `fianza_eur`), `AUDIT_LOG`
- Dolor(es) que resuelve: D5 (el gestor puede limpiar activamente el pipeline de reservas terminadas sin esperar al automatismo de T+7d), D1 (trazabilidad con autoría explícita del gestor que ejecuta el cierre administrativo)
- Automatización relacionada: ninguna (acción completamente manual del gestor; el cron A12 de archivado automático seguirá en ejecución pero detectará `reserva_completada` y no actuará — ver US-037)
- Email relacionado: ninguno
- Reglas de negocio:
  - Solo disponible cuando `RESERVA.estado = post_evento`
  - Condición de fianza resuelta idéntica a la del archivado automático (US-037): `fianza_status ∈ {devuelta, retenida_parcial}` O `fianza_eur = 0` O `fianza_eur IS NULL`
  - Si la fianza no está resuelta: el sistema **bloquea** el archivado y muestra el motivo específico al gestor
  - Al confirmar: `RESERVA.estado = reserva_completada` (estado terminal, inmutable)
  - La reserva queda indexada y accesible en el módulo Histórico
  - `AUDIT_LOG` registra la transición con el `usuario_id` del gestor que ejecutó la acción
  - El archivado manual no cancela ni afecta al cron de archivado automático; si el cron evalúa esta reserva después del archivado manual, la encontrará en `reserva_completada` y la saltará (idempotencia de US-037)
- Supuestos: ninguno adicional
- Dependencias: US-034 (precondición: `RESERVA.estado = post_evento`), US-036 (si `fianza_eur > 0`: fianza debe estar resuelta antes de poder archivar)
- Notas de alcance:
  - ninguna: el alcance de esta historia es el definido por UC-28 flujo alternativo manual; no hay funcionalidades `📐` involucradas en este flujo específico.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path — Archivado manual con fianza devuelta
- **Dado** que `RESERVA.estado = post_evento`, `RESERVA.fianza_status = devuelta` y han transcurrido, por ejemplo, 3 días desde la transición a `post_evento`
  **Cuando** el gestor selecciona "Archivar reserva" en la ficha y confirma la acción en el diálogo de confirmación
  **Entonces**:
  - `RESERVA.estado = reserva_completada`
  - La reserva aparece y es filtrable en el módulo Histórico
  - `AUDIT_LOG` registra `accion = transicion`, `usuario_id = <id del gestor>`, `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado: reserva_completada}`
  - El gestor ve confirmación en la UI: "Reserva [código] archivada correctamente. Ya está disponible en el Histórico."

### ⚠️ Flujos Alternativos y Edge Cases

#### Happy Path — Sin fianza (fianza_eur = 0 o NULL)
- **Dado** que `RESERVA.estado = post_evento` y `RESERVA.fianza_eur = 0` (tenant configurado sin fianza)
  **Cuando** el gestor selecciona "Archivar reserva" y confirma
  **Entonces** `RESERVA.estado = reserva_completada`; la validación de `fianza_status` no aplica; el archivado es inmediato sin restricciones adicionales
- Comportamiento del sistema: `fianza_eur = 0 OR NULL` → condición de fianza satisfecha automáticamente

#### Happy Path — Con fianza totalmente retenida
- **Dado** que `RESERVA.fianza_status = retenida_parcial` y `RESERVA.fianza_devuelta_eur = 0.00` (retención total por desperfectos)
  **Cuando** el gestor selecciona "Archivar reserva" y confirma
  **Entonces** `RESERVA.estado = reserva_completada`; `retenida_parcial` con importe devuelto 0 es un estado resuelto válido para archivar
- Comportamiento del sistema: equivalente al happy path; cualquier valor de `fianza_status ∈ {devuelta, retenida_parcial}` habilita el archivado

#### FA-01 — Intento de archivado con fianza pendiente de resolución (fianza_status = cobrada)
- **Dado** que `RESERVA.estado = post_evento` y `RESERVA.fianza_status = cobrada` (fianza cobrada pero sin devolución ni retención registradas)
  **Cuando** el gestor selecciona "Archivar reserva"
  **Entonces** el sistema bloquea la acción y muestra: "⚠️ No se puede archivar la reserva: la fianza está pendiente de resolución. Registra la devolución o retención de fianza antes de archivar."; `RESERVA.estado` permanece `post_evento`; el botón "Archivar reserva" puede estar deshabilitado en la UI cuando `fianza_status = cobrada`
- Comportamiento del sistema: validación pre-acción; el bloqueo es informativo y guía al gestor hacia US-036

#### FA-02 — Intento de archivado con fianza en estado intermedio (fianza_status = recibo_enviado)
- **Dado** que `RESERVA.estado = post_evento` y `RESERVA.fianza_status = recibo_enviado` (recibo enviado pero fianza aún no registrada como cobrada)
  **Cuando** el gestor intenta archivar
  **Entonces** el sistema bloquea con el mismo mensaje que FA-01; `fianza_status ∉ {devuelta, retenida_parcial}` bloquea el archivado cuando `fianza_eur > 0`
- Comportamiento del sistema: cualquier `fianza_status` distinto de `devuelta` o `retenida_parcial` (cuando `fianza_eur > 0`) es tratado como "fianza no resuelta"

### 🔒 Concurrencia / Race Conditions
- **Dado** que el gestor archiva manualmente (US-038) y el cron de archivado automático (US-037) intentan transicionar la misma `RESERVA` de `post_evento → reserva_completada` de forma concurrente
  **Cuando** ambas operaciones se ejecutan simultáneamente
  **Entonces** exactamente una de las dos transiciones tiene éxito; la segunda detecta `RESERVA.estado = reserva_completada` en su lectura transaccional y no produce error, no duplica el registro en `AUDIT_LOG` ni genera ningún estado inconsistente
- Comportamiento del sistema: el chequeo del estado actual dentro de la transacción garantiza idempotencia; el resultado final es correcto independientemente de cuál operación llega primero

### 🚫 Reglas de Validación
- Solo disponible cuando `RESERVA.estado = post_evento`
- Condición de fianza: `fianza_status ∈ {devuelta, retenida_parcial}` O `fianza_eur ≤ 0` O `fianza_eur IS NULL`; si no se cumple, el archivado está bloqueado
- `reserva_completada` es un estado terminal e inmutable: no existe transición de salida
- `AUDIT_LOG` obligatorio con `usuario_id` del gestor que ejecutó la acción

## 📊 Impacto de Negocio
- Impacto esperado: el gestor puede cerrar expedientes terminados con agilidad cuando todos los trámites están resueltos, sin esperar 7 días (D5); el pipeline de reservas activas queda limpio (D1); trazabilidad con autoría explícita del cierre (D1)
- Criterio de éxito: 100% de archivados manuales generan `RESERVA.estado = reserva_completada` con `AUDIT_LOG` y `usuario_id`; cero archivados posibles con fianza no resuelta
