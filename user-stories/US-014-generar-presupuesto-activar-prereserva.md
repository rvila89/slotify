---
id: US-014
estado: in-progress
branch: feature/us-014-generar-presupuesto-activar-prereserva
pr: https://github.com/rvila89/slotify/pull/35
---

# 🧾 Historia de Usuario: Generar Presupuesto y Activar Pre-reserva

## 🆔 Metadatos
- ID: US-014
- Área funcional: Pre-reserva y Presupuestos
- Módulo: M4 — Presupuestos & Tarifas
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** generar un presupuesto formal cuando el cliente ha confirmado todos los datos necesarios y aprobarlo como borrador
**Para** activar el estado de pre-reserva, bloquear la fecha 7 días y enviar el presupuesto PDF al cliente con las instrucciones de pago de la señal

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-14 (principal), UC-16 (motor de tarifa delegado a Sistema — cubierto en US-016)
- Entidades implicadas: `RESERVA`, `CLIENTE`, `PRESUPUESTO`, `TARIFA`, `TEMPORADA_CALENDARIO`, `EXTRA`, `RESERVA_EXTRA`, `FECHA_BLOQUEADA`, `COMUNICACION`, `AUDIT_LOG`
- Dolor(es) que resuelve: D8 (presupuestos manuales: 30–60 min → 30 segundos), D3 (sin estados claros: pre_reserva queda inequívoco), D2 (pipeline: la reserva avanza a un estado visible), D4 (bloqueo de fecha actualizado a 7 días previene ventana de doble reserva)
- Automatización relacionada: A16 — cuando la consulta bloqueante avanza a `pre_reserva`, se vacía la cola de espera (consultas en 2.d pasan a 2.y)
- Email relacionado: E2 — email automático con presupuesto PDF adjunto (desglose 40%/60%/fianza + instrucciones de transferencia), enviado tras aprobación del borrador por el gestor
- Reglas de negocio:
  - La RESERVA debe estar en sub-estado `2.a`, `2.b`, `2.c` o `2.v`; nunca en `pre_reserva` ni en estados posteriores
  - Datos completos obligatorios antes de generar: `fecha_evento`, `duracion_horas` (4|8|12), `num_adultos_ninos_mayores4` (≥1), `tipo_evento`, y datos fiscales del CLIENTE (`dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`)
  - `num_ninos_menores4` es informativo y no cuenta para el cálculo de tarifa (niños hasta 4 años gratuitos)
  - Si `num_adultos_ninos_mayores4` > 50 → el sistema devuelve indicador "tarifa a consultar" y habilita campo de precio manual; el flujo no se bloquea
  - El presupuesto PDF incluye: desglose de tarifa (base imponible + IVA 21%), extras seleccionados, total, desglose 40%/60%/fianza e instrucciones de transferencia (IBAN del tenant, beneficiario, concepto)
  - El sistema presenta el presupuesto como borrador editable; el gestor revisa y puede ajustar cantidades, extras y descuentos antes de confirmar
  - Al confirmar el borrador: `RESERVA.estado` → `pre_reserva`; `FECHA_BLOQUEADA.tipo_bloqueo` = `blando`; `ttl_expiracion` = ahora + 7 días
  - Si la RESERVA tenía FECHA_BLOQUEADA previa (bloqueo blando de 2.b/2.c/2.v) → se actualiza la fila existente con nuevo TTL de 7 días. Si la RESERVA estaba en 2.a (sin bloqueo previo) → se inserta nueva fila en FECHA_BLOQUEADA con la fecha del evento
  - Si hay RESERVAS en cola (`sub_estado = '2d'`) apuntando a esta reserva como bloqueante → se vacían: `sub_estado → '2y'`, `posicion_cola → null`, `consulta_bloqueante_id → null` (A16). Los emails de notificación a los clientes en cola son 📐 Solo diseñado, fuera del MVP
  - La tarifa se delega al motor de UC-16 (US-016) con los parámetros (fecha, duracion_horas, num_adultos_ninos_mayores4)
  - `PRESUPUESTO.tarifa_congelada = true` al confirmar; si la tarifa del tarifario cambia posteriormente, el PRESUPUESTO existente no se recalcula
  - El gestor puede cancelar en la fase de borrador sin cambio de estado en la RESERVA ni en la FECHA_BLOQUEADA
- Supuestos: el tenant tiene TARIFA configurada para la temporada, duración y tramo de invitados correspondiente; si no, el motor UC-16 devuelve error de configuración
- Dependencias:
  - US-003 / US-004 / US-005 / US-007 / US-008 — establecen los sub-estados {2.a, 2.b, 2.c, 2.v} de los que parte UC-14
  - US-016 — motor de cálculo de tarifa (UC-16) invocado internamente por este flujo
  - Los datos fiscales de CLIENTE deben estar completos (prerrequisito de validación inline del propio UC-14)
- Notas de alcance:
  - Los emails de notificación a las consultas vaciadas de la cola (A16, parte "email a cada uno") son 📐 Solo diseñado. La transición mecánica 2.d → 2.y sí está en MVP y se verifica en los criterios de aceptación
  - Los recordatorios automáticos de seguimiento del presupuesto enviado (T-15d, T-3d) son 📐 Solo diseñado

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que RESERVA está en sub-estado `2.b` (fecha del evento 15/09/2026, bloqueo blando activo 3 días), CLIENTE tiene `dni_nif`, `direccion`, `codigo_postal`, `poblacion` y `provincia` informados, y TARIFA vigente existe para (temporada=alta, duracion_horas=8, invitados entre 31 y 50, vigente en la fecha)
  **Cuando** el gestor hace clic en "Generar presupuesto", revisa el borrador (40 invitados, 8 horas, septiembre, sin extras) y confirma
  **Entonces**:
  - Se crea `PRESUPUESTO` con `version = 1`, `tarifa_congelada = true`, `estado = 'enviado'`, `iva_porcentaje = 21`
  - `RESERVA.estado` cambia a `pre_reserva`
  - `RESERVA.ttl_expiracion` = ahora + 7 días
  - La fila de `FECHA_BLOQUEADA` para (tenant_id, fecha=15/09/2026) tiene `ttl_expiracion` actualizado a ahora + 7 días y `tipo_bloqueo = 'blando'`
  - Se crea `COMUNICACION` con `codigo_email = 'E2'` y `estado = 'enviado'`
  - Se registra entrada en `AUDIT_LOG` con `accion = 'transicion'`, `datos_anteriores.estado = '2b'` (sub_estado), `datos_nuevos.estado = 'pre_reserva'`

### ⚠️ Flujos Alternativos y Edge Cases

#### FA-01: Datos fiscales del cliente incompletos
- **Dado** que RESERVA está en sub-estado `2.b` con fecha y nº invitados completos, pero `CLIENTE.dni_nif` es nulo
  **Cuando** el gestor hace clic en "Generar presupuesto"
  **Entonces** el sistema muestra error enumerando los campos fiscales faltantes; no se crea `PRESUPUESTO`; `RESERVA` permanece en `sub_estado = '2b'`; `FECHA_BLOQUEADA` no se modifica
- Comportamiento del sistema: validación síncrona antes de llamar al motor de tarifa; lista de campos faltantes: `dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`

#### FA-02: Más de 50 invitados — tarifa a consultar
- **Dado** que RESERVA tiene `num_adultos_ninos_mayores4 = 60`
  **Cuando** el gestor inicia la generación de presupuesto
  **Entonces** el sistema muestra el borrador con la tarifa marcada como "A consultar" y habilita un campo de precio total manual; el gestor introduce el precio; el flujo continúa y completa la transición a `pre_reserva` con el precio introducido manualmente en `PRESUPUESTO.total`
- Comportamiento del sistema: el motor UC-16 retorna `{ tarifa_a_consultar: true, precio_total_eur: null }`; el sistema habilita el campo manual y espera al input del gestor antes de generar el PDF

#### FA-03: Gestor cancela en la fase de borrador
- **Dado** que el sistema ha presentado el borrador editable del presupuesto
  **Cuando** el gestor pulsa "Cancelar"
  **Entonces** no se crea ningún `PRESUPUESTO`; `RESERVA.estado` permanece en el sub-estado anterior (2.a / 2.b / 2.c / 2.v); `FECHA_BLOQUEADA` no se modifica; no se envía ningún email

#### Vaciado de cola al activar pre_reserva (A16)
- **Dado** que RESERVA bloqueante está en `sub_estado = '2b'` y hay 3 RESERVAS en `sub_estado = '2d'` con `consulta_bloqueante_id` apuntando a ella
  **Cuando** el gestor confirma el presupuesto y la RESERVA transiciona a `pre_reserva`
  **Entonces** las 3 RESERVAS en cola cambian a `sub_estado = '2y'`, `posicion_cola = null`, `consulta_bloqueante_id = null`; se registra entrada en `AUDIT_LOG` por cada transición de cola; no se envía ningún email a los clientes en cola (📐 Solo diseñado)

#### Consulta en 2.a sin bloqueo previo — nueva inserción en FECHA_BLOQUEADA
- **Dado** que RESERVA está en `sub_estado = '2a'` (sin `FECHA_BLOQUEADA` previa), el gestor ha introducido la fecha del evento y los datos completos
  **Cuando** el gestor confirma el borrador del presupuesto
  **Entonces** se inserta nueva fila en `FECHA_BLOQUEADA` con `(tenant_id, fecha)` único, `tipo_bloqueo = 'blando'`, `ttl_expiracion = ahora + 7 días`, `reserva_id` apuntando a la RESERVA

#### Motor de tarifa sin tarifa vigente (error de configuración)
- **Dado** que el tarifario del tenant no tiene ninguna `TARIFA` vigente para la combinación (temporada, duracion_horas, tramo de invitados) de la reserva
  **Cuando** el sistema intenta calcular la tarifa (delegando a UC-16/US-016)
  **Entonces** el sistema muestra error "Tarifa no configurada para los parámetros indicados"; no se crea `PRESUPUESTO`; `RESERVA` permanece en su sub-estado anterior

#### Consulta en sub-estado terminal — operación no permitida
- **Dado** que RESERVA está en `sub_estado = '2x'` (expirada)
  **Cuando** se intenta generar presupuesto
  **Entonces** el sistema rechaza la operación; no se ejecuta el motor de tarifa

### 🔒 Concurrencia / Race Conditions (zona crítica: bloqueo atómico de fecha)

#### Race condition en inserción/actualización de FECHA_BLOQUEADA al activar pre_reserva
- **Dado** dos sesiones concurrentes de gestor intentando confirmar el presupuesto de dos RESERVAS distintas para la misma `(tenant_id, fecha)` — una en 2.a (sin bloqueo) y otra en 2.b (con bloqueo) —, o dos confirmaciones simultáneas del mismo presupuesto por error de doble clic
  **Cuando** ambas transacciones intentan insertar o actualizar la misma fila en `FECHA_BLOQUEADA(tenant_id, fecha)` dentro de la misma transacción de BD
  **Entonces** exactamente una transacción tiene éxito; la otra recibe violación de restricción `UNIQUE(tenant_id, fecha)` (o falla al adquirir `SELECT ... FOR UPDATE`) y el sistema devuelve error "Fecha no disponible" al gestor; no se produce doble bloqueo ni inconsistencia entre `RESERVA.estado` y `FECHA_BLOQUEADA`

### 🚫 Reglas de Validación
- `fecha_evento` ≥ fecha actual (no se admiten fechas pasadas)
- `duracion_horas` ∈ {4, 8, 12}
- `num_adultos_ninos_mayores4` ≥ 1
- `tipo_evento` ∈ {boda, corporativo, privado, otro}
- Datos fiscales de CLIENTE requeridos: `dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia` (no nulos, no vacíos)
- `RESERVA.estado` debe ser consulta con `sub_estado` ∈ {`2a`, `2b`, `2c`, `2v`} al iniciar la operación
- Si ya existe PRESUPUESTO en estado `enviado` o `aceptado` para la reserva → el gestor debe usar UC-15 (editar) en lugar de generar de nuevo

## 📊 Impacto de Negocio
- Impacto esperado: elimina el proceso manual de 30–60 minutos para generar presupuestos (D8); hace inequívoco el estado de pre_reserva en el pipeline (D3); garantiza que el bloqueo de la fecha se eleva de 3 a 7 días de forma atómica, eliminando ventanas de doble reserva durante la fase de pre-reserva (D4)
- Criterio de éxito: tiempo medio de generación de presupuesto < 2 minutos desde el inicio hasta el envío del email E2; 0 dobles reservas en fechas con pre_reserva activa
