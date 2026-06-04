# 🧾 Historia de Usuario: Confirmar Pago de Señal y Activar Reserva Confirmada

## 🆔 Metadatos
- ID: US-021
- Área funcional: Confirmación de Reserva
- Módulo: M5 — Confirmación & Facturación
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** registrar el justificante del pago de la señal y confirmar la reserva
**Para** elevar la reserva a estado `reserva_confirmada`, convertir el bloqueo blando en firme (sin TTL) y activar los tres sub-procesos paralelos (pre-evento, liquidación, fianza), dejando la fecha definitivamente asegurada

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-17
- Entidades implicadas: `RESERVA`, `FECHA_BLOQUEADA`, `DOCUMENTO`, `FICHA_OPERATIVA`, `COMUNICACION`, `AUDIT_LOG`
- Dolor(es) que resuelve: D4 (el bloqueo firme sin TTL elimina la última ventana de doble reserva una vez confirmada), D1 (flujo guiado elimina gestión manual de seguimiento), D3 (estado `reserva_confirmada` hace inequívoco el pipeline)
- Automatización relacionada: activación automática de sub-procesos (`pre_evento_status`, `liquidacion_status`, `fianza_status`) como parte de la transición; creación de `FICHA_OPERATIVA` vacía para el sub-proceso de pre-evento (UC-20)
- Email relacionado: E3 — se envía al cliente tras la aprobación de la factura de señal (US-022) y la generación de condiciones particulares (US-023); incluye factura de señal adjunta, condiciones particulares y próximos hitos
- Reglas de negocio:
  - `RESERVA.estado` debe ser `pre_reserva` al iniciar la operación; cualquier otro estado la rechaza
  - El gestor sube un fichero de justificante (imagen o PDF); se crea `DOCUMENTO` con `tipo = 'justificante_pago'`
  - La transición es atómica: `RESERVA.estado → reserva_confirmada` + actualización de `FECHA_BLOQUEADA` (`tipo_bloqueo → 'firme'`, `ttl_expiracion → null`) deben ocurrir en la misma transacción de BD, usando `SELECT ... FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`
  - Sub-procesos inicializados: `pre_evento_status = 'pendiente'`, `liquidacion_status = 'pendiente'`, `fianza_status = 'pendiente'`
  - `FICHA_OPERATIVA` creada vacía con `reserva_id` de la reserva confirmada (relación 1:1)
  - E3 se dispara únicamente después de que el gestor aprueba la factura de señal en borrador (US-022) y el sistema genera el documento de condiciones particulares (US-023); hasta ese momento, los artefactos están en preparación
  - `RESERVA.importe_senal` y `RESERVA.importe_liquidacion` se calculan a partir de `RESERVA.importe_total` con el porcentaje de `TENANT_SETTINGS.pct_senal` en el momento de la confirmación (40/60 en MVP)
- Supuestos: el presupuesto ya fue aceptado en la fase de `pre_reserva` (UC-14/US-014); `RESERVA.importe_total` está fijado
- Dependencias:
  - US-014 — establece el estado `pre_reserva` y fija `importe_total` desde el presupuesto aceptado
  - US-022 — generación de factura de señal; su aprobación es prerequisito para E3
  - US-023 — generación de condiciones particulares; su generación es prerequisito para E3
- Notas de alcance:
  - UC-17 no define flujos alternativos (FA-xx) explícitos más allá de las precondiciones. Los edge cases están derivados de las reglas de la spec y del modelo de datos

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que `RESERVA` está en estado `pre_reserva` con fecha de evento 15/09/2026, `FECHA_BLOQUEADA` activo con `tipo_bloqueo = 'blando'` y `importe_total = 3.000,00 €`, y el gestor tiene el justificante de pago del cliente en mano
  **Cuando** el gestor selecciona "Confirmar pago de señal", sube el fichero justificante (PDF, < 10 MB) y confirma
  **Entonces**:
  - Se crea `DOCUMENTO` con `tipo = 'justificante_pago'`, `reserva_id` y `url` del fichero almacenado
  - `RESERVA.estado` cambia a `reserva_confirmada`
  - `RESERVA.pre_evento_status = 'pendiente'`, `liquidacion_status = 'pendiente'`, `fianza_status = 'pendiente'`
  - `RESERVA.importe_senal = 1.200,00 €` (40 %), `RESERVA.importe_liquidacion = 1.800,00 €` (60 %)
  - `FECHA_BLOQUEADA` para `(tenant_id, fecha = 15/09/2026)` tiene `tipo_bloqueo = 'firme'` y `ttl_expiracion = null`
  - `FICHA_OPERATIVA` creada con `reserva_id`, todos los campos de contenido nulos, `ficha_cerrada = false`
  - `AUDIT_LOG` registra `accion = 'transicion'`, `datos_anteriores.estado = 'pre_reserva'`, `datos_nuevos.estado = 'reserva_confirmada'`
  - El sistema presenta al gestor la factura de señal en borrador para revisión (US-022 disparado)

### ⚠️ Flujos Alternativos y Edge Cases

#### Reserva no está en pre_reserva — operación rechazada
- **Dado** que `RESERVA.estado` es `reserva_confirmada` (ya confirmada) o cualquier sub-estado de `consulta`
  **Cuando** se intenta ejecutar "Confirmar pago de señal"
  **Entonces** el sistema rechaza la operación con mensaje "La reserva no está en estado pre_reserva"; no se modifica ninguna entidad; no se registra transición en `AUDIT_LOG`
- Comportamiento del sistema: validación síncrona del estado antes de ejecutar cualquier acción

#### Justificante no adjuntado
- **Dado** que el gestor selecciona "Confirmar pago de señal" pero no adjunta ningún fichero
  **Cuando** intenta confirmar el formulario
  **Entonces** el sistema muestra error de validación "Es obligatorio adjuntar el justificante de pago"; no se produce ningún cambio de estado ni modificación de `FECHA_BLOQUEADA`

#### Fichero justificante con formato no válido
- **Dado** que el gestor adjunta un fichero con extensión `.exe` o de tamaño > 10 MB
  **Cuando** intenta confirmar
  **Entonces** el sistema rechaza el fichero con mensaje de error específico (formato no permitido / tamaño excedido); no se procesan los cambios de estado

#### FICHA_OPERATIVA ya existente (idempotencia)
- **Dado** que por algún error previo ya existe una `FICHA_OPERATIVA` con el mismo `reserva_id`
  **Cuando** el sistema intenta crear la ficha operativa
  **Entonces** el sistema detecta el registro existente y no lo duplica; la transición de estado continúa sin error

### 🔒 Concurrencia / Race Conditions (zona crítica: bloqueo atómico firme)

#### Double-click / confirmación simultánea desde dos sesiones
- **Dado** dos solicitudes concurrentes para confirmar la misma `RESERVA` en `pre_reserva` (doble clic del gestor o dos sesiones abiertas), ambas intentando actualizar `FECHA_BLOQUEADA(tenant_id, fecha)` con `tipo_bloqueo = 'firme'`
  **Cuando** ambas transacciones ejecutan `SELECT ... FOR UPDATE` sobre la misma fila de `FECHA_BLOQUEADA`
  **Entonces** exactamente una transacción adquiere el lock y completa la transición; la segunda bloquea hasta que la primera libera el lock y entonces detecta que `RESERVA.estado` ya es `reserva_confirmada`, devolviendo error "La reserva ya ha sido confirmada" sin modificar entidades adicionales; no se producen dos `FICHA_OPERATIVA` ni dos `DOCUMENTO` de justificante para la misma reserva

#### Confirmación concurrente sobre fecha ya en bloqueo firme de otra reserva
- **Dado** que `FECHA_BLOQUEADA(tenant_id, fecha = 15/09/2026)` ya tiene `tipo_bloqueo = 'firme'` vinculado a una `RESERVA` distinta
  **Cuando** se intenta confirmar una segunda reserva para la misma fecha (escenario de fallo de integridad)
  **Entonces** la transacción falla con violación de `UNIQUE(tenant_id, fecha)` antes de modificar el estado de la segunda reserva; el gestor recibe error "Fecha no disponible"; no se produce doble reserva confirmada (D4)

### 🚫 Reglas de Validación
- `RESERVA.estado` = `pre_reserva` obligatorio al iniciar la operación
- Justificante obligatorio: fichero presente, formato `image/jpeg`, `image/png` o `application/pdf`, tamaño ≤ 10 MB
- `RESERVA.importe_total` > 0 (debe haber un presupuesto aceptado previo)
- La transición `RESERVA.estado` + `FECHA_BLOQUEADA` actualización deben ocurrir en la misma transacción de BD (atomicidad garantizada por `SELECT ... FOR UPDATE`)

## 📊 Impacto de Negocio
- Impacto esperado: el bloqueo firme elimina la última ventana de doble reserva posible (D4); el estado `reserva_confirmada` hace inequívoco el pipeline (D3); la activación automática de los tres sub-procesos reduce el riesgo de olvidar iniciar liquidación o fianza (D1)
- Criterio de éxito: 0 dobles reservas en fechas con `reserva_confirmada` activa; tiempo entre subir el justificante y tener la reserva en estado confirmado < 5 segundos