---
id: US-015
estado: en_revision
branch: feature/us-015-editar-reenviar-presupuesto-prereserva
pr: 73
---

# 🧾 Historia de Usuario: Editar y Reenviar Presupuesto en Pre-reserva

## 🆔 Metadatos
- ID: US-015
- Área funcional: Pre-reserva y Presupuestos
- Módulo: M4 — Presupuestos & Tarifas
- Prioridad: Media
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** editar un presupuesto ya generado (cantidades, extras o descuentos) y enviar la versión actualizada al cliente mientras la reserva está en pre_reserva
**Para** ajustar la oferta económica ante cambios en los requisitos del cliente sin perder el historial de versiones ni tener que regenerar todo desde cero

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-15
- Entidades implicadas: `RESERVA`, `PRESUPUESTO`, `RESERVA_EXTRA`, `EXTRA`, `CLIENTE`, `COMUNICACION`, `AUDIT_LOG`
- Dolor(es) que resuelve: D8 (presupuestos manuales: ajustar un presupuesto en Excel implicaba rehacerlo; aquí se edita en el sistema con recálculo automático), D2 (el historial de versiones mantiene visibilidad del pipeline)
- Automatización relacionada: ninguna (acción manual del gestor; el envío del presupuesto actualizado es disparado explícitamente por el gestor, no automático)
- Email relacionado: E2 (template reutilizado — el sistema envía el presupuesto PDF actualizado usando la misma plantilla E2, pero esta vez como reenvío manual). **Gap de spec detectado:** §9.3 define E2 con trigger "Gestor activa pre-reserva"; UC-15 (reenvío estando ya en pre_reserva) no tiene asignado un código E propio. El comportamiento esperado es usar el template E2 para el reenvío. Pendiente de confirmar con product owner.
- Reglas de negocio:
  - Precondición: `RESERVA.estado = 'pre_reserva'`; `PRESUPUESTO.estado ∈ {'borrador', 'enviado'}`. Un presupuesto en estado `aceptado` (señal ya confirmada vía UC-17) no puede editarse
  - Campos editables: `num_adultos_ninos_mayores4` (si cambia → se recalcula tarifa vía motor UC-16), `RESERVA_EXTRA` (añadir, quitar o modificar cantidad), `descuento_eur`
  - El precio unitario de cada `RESERVA_EXTRA` se congela en el momento de añadir la línea (no al aceptar el presupuesto): si el EXTRA del catálogo cambia de precio después, el precio congelado en la línea existente no se recalcula; solo las líneas nuevas añadidas en esta edición toman el precio actual del catálogo
  - Al confirmar la edición: se crea un nuevo `PRESUPUESTO` con `version = anterior + 1`, `tarifa_congelada = true`, y el presupuesto anterior queda como historial (no se borra)
  - El sistema recalcula: `base_imponible`, `iva_importe` (21%), `total`; regenera el PDF
  - El gestor confirma el envío explícitamente; el sistema registra `COMUNICACION` y actualiza `PRESUPUESTO.estado = 'enviado'`
  - `RESERVA.estado` permanece `pre_reserva` y `FECHA_BLOQUEADA.ttl_expiracion` no se modifica durante esta operación (UC-15 no extiende el bloqueo)
  - Si el gestor modifica cantidades sin confirmar el envío, el borrador queda guardado en el sistema (estado `borrador`) hasta que el gestor lo envíe o lo descarte
- Supuestos: el tenant tiene TARIFA configurada para el nuevo nº de invitados si se cambia ese campo. Si no existe tarifa para la nueva combinación, el motor devuelve "tarifa a consultar" y habilita precio manual (igual que en UC-14/US-014)
- Dependencias:
  - US-014 — establece el estado `pre_reserva` y crea el primer `PRESUPUESTO` del que parte esta historia
  - US-016 — motor de tarifa invocado si se cambia el nº de invitados o la duración
- Notas de alcance:
  - La política de cancelación/liquidación tardía es `Negociable` hardcoded en MVP (no configurable); fuera del alcance de esta historia
  - No se contempla la edición del presupuesto tras la confirmación de la señal (UC-17 en adelante): esa zona pertenece a facturas complementarias (📐 Solo diseñado)

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que RESERVA está en `pre_reserva` con `PRESUPUESTO.version = 1` en estado `enviado` (importe total 3.200 €, sin descuento)
  **Cuando** el gestor aplica un descuento de 200 € (`descuento_eur = 200`), confirma la edición y envía
  **Entonces**:
  - Se crea `PRESUPUESTO.version = 2` con `total = 3.000 €`, `tarifa_congelada = true`, `estado = 'enviado'`
  - El PRESUPUESTO version=1 persiste en la BD como historial (no eliminado)
  - Se registra `COMUNICACION` con template E2 y `estado = 'enviado'`
  - Se registra entrada en `AUDIT_LOG` con `accion = 'actualizar'` y referencia al nuevo `id_presupuesto`
  - `RESERVA.estado` permanece `pre_reserva`; `FECHA_BLOQUEADA.ttl_expiracion` no cambia

### ⚠️ Flujos Alternativos y Edge Cases

#### Añadir extra del catálogo — precio congelado al añadir
- **Dado** que RESERVA está en `pre_reserva` y `EXTRA 'barbacoa'` tiene `precio_eur = 250 €` en el catálogo actual
  **Cuando** el gestor añade 1 unidad de "barbacoa" al presupuesto y confirma
  **Entonces** se crea `RESERVA_EXTRA` con `precio_unitario = 250`, `subtotal = 250`, `origen = 'anadido_post_confirmacion'` (si se añade tras la activación de pre_reserva), `factura_id = null`; el total del presupuesto se incrementa en 250 €
- **Dado** que, después de añadir la línea, el precio del catálogo de "barbacoa" cambia a 300 €
  **Cuando** el gestor edita otro campo del presupuesto (p. ej. el descuento)
  **Entonces** la línea de "barbacoa" existente mantiene `precio_unitario = 250`; solo las líneas nuevas añadidas en esta edición toman el precio actual (300 €)

#### Eliminar extra del presupuesto
- **Dado** que PRESUPUESTO tiene una `RESERVA_EXTRA` para "paellero" con `subtotal = 400 €`
  **Cuando** el gestor elimina esa línea y confirma la edición
  **Entonces** `RESERVA_EXTRA` queda eliminada (o marcada como inactiva); el total del nuevo PRESUPUESTO no incluye los 400 €; se crea nueva versión del PRESUPUESTO

#### Cambio de nº invitados — recálculo de tarifa
- **Dado** que PRESUPUESTO version=1 fue calculado con 40 invitados (tramo 31–50)
  **Cuando** el gestor cambia `num_adultos_ninos_mayores4` a 25 (tramo 21–30, con precio de tarifa distinto) y confirma
  **Entonces** el motor UC-16 recalcula con los nuevos parámetros; se crea PRESUPUESTO version=2 con el nuevo `precio_total_eur` de la TARIFA para el tramo 21–30; el PRESUPUESTO version=1 se conserva como historial

#### Cambio de invitados a >50 — tarifa a consultar
- **Dado** que el cliente amplía el aforo a 55 invitados
  **Cuando** el gestor introduce `num_adultos_ninos_mayores4 = 55`
  **Entonces** el motor UC-16 retorna `{ tarifa_a_consultar: true }`; el sistema habilita campo de precio manual; el gestor introduce el nuevo precio; la nueva versión del PRESUPUESTO incluye el precio manual

#### Guardar borrador sin enviar
- **Dado** que el gestor ha modificado el descuento del presupuesto
  **Cuando** el gestor guarda sin confirmar el envío
  **Entonces** se crea `PRESUPUESTO.version = 2` con `estado = 'borrador'`; no se registra COMUNICACION; el cliente no recibe email; el gestor puede enviar el borrador más tarde desde la ficha de pre_reserva

#### Estado inválido — PRESUPUESTO ya aceptado
- **Dado** que el PRESUPUESTO tiene `estado = 'aceptado'` (señal ya confirmada, RESERVA ha transicionado a `reserva_confirmada`)
  **Cuando** el gestor intenta editar el presupuesto desde la ficha
  **Entonces** el sistema rechaza la operación con mensaje "El presupuesto está aceptado y no puede modificarse"; no se crea nueva versión

#### Estado inválido — RESERVA fuera de pre_reserva
- **Dado** que `RESERVA.estado ≠ 'pre_reserva'` (p. ej. sigue en `2b`)
  **Cuando** se intenta acceder a la edición de presupuesto vía UC-15
  **Entonces** el sistema rechaza la operación; el botón de edición no está disponible en la UI

#### Sin cambios — reenvío de versión existente
- **Dado** que el gestor abre el presupuesto pero no modifica ningún campo
  **Cuando** confirma el envío
  **Entonces** no se crea nueva versión; se reenvía el PDF de la versión actual (`estado = 'enviado'`); se registra nueva `COMUNICACION`; se registra en `AUDIT_LOG`

### 🔒 Concurrencia / Race Conditions
Esta historia no toca el bloqueo atómico de fecha (no hay inserción ni modificación de `FECHA_BLOQUEADA`). El único riesgo concurrente es la edición simultánea del presupuesto por dos sesiones del mismo gestor; se mitiga con operaciones optimistic-lock a nivel de fila en `PRESUPUESTO` (versión como campo de control). No se especifican tests de concurrencia adicionales: no es zona crítica según la heurística de la spec.

### 🚫 Reglas de Validación
- `RESERVA.estado = 'pre_reserva'` (obligatorio)
- `PRESUPUESTO.estado ∈ {'borrador', 'enviado'}` (no `aceptado`)
- `descuento_eur` ≥ 0 y ≤ `base_imponible` (no puede resultar en total negativo)
- Si se cambia `num_adultos_ninos_mayores4`: el motor UC-16 debe encontrar TARIFA vigente o devolver "tarifa a consultar"
- `duracion_horas ∈ {4, 8, 12}` si se modifica
- Los campos `base_imponible`, `iva_importe` y `total` se derivan siempre del motor (no son editables directamente por el gestor excepto en modo precio manual con >50 invitados)

## 📊 Impacto de Negocio
- Impacto esperado: permite renegociar la oferta económica sin perder trazabilidad de versiones; el gestor puede responder rápidamente a cambios del cliente (nº invitados, extras, descuento) sin rehacer el presupuesto desde cero en un Excel externo
- Criterio de éxito: 0% de presupuestos editados que se vuelven a generar como "nueva reserva" por no poder editar la existente (sustitución completa del flujo Excel)
