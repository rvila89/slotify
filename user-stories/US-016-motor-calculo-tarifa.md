---
id: US-016
estado: backlog
branch: null
pr: null
---

# 🧾 Historia de Usuario: Motor de Cálculo de Tarifa

## 🆔 Metadatos
- ID: US-016
- Área funcional: Pre-reserva y Presupuestos
- Módulo: M4 — Presupuestos & Tarifas
- Prioridad: Crítica
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Sistema
**Cuando se cumple** que se requiere calcular el precio de una reserva (al generar o editar un presupuesto)
**Ejecuto** la búsqueda en el tarifario del tenant por (temporada × duración × tramo de invitados) y sumo los extras seleccionados, devolviendo el total con IVA 21% incluido
**Para** que todo presupuesto generado use un precio correcto, reproducible y congelable desde el primer cálculo, sin trabajo manual del gestor

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-16 (motor puro de cálculo de tarifa, invocado por UC-14/US-014 y UC-15/US-015)
- Entidades implicadas: `TARIFA`, `TEMPORADA_CALENDARIO`, `EXTRA`, `RESERVA_EXTRA`, `TENANT_SETTINGS`
- Dolor(es) que resuelve: D8 (presupuestos manuales: el motor elimina el cálculo en Excel con 30–60 min de trabajo por presupuesto), D9 (sin automatizaciones: el cálculo automático libera al gestor de trabajo repetitivo)
- Automatización relacionada: ninguna propia (es una función de soporte invocada por otros flujos)
- Email relacionado: ninguno (es un motor de cálculo puro, no dispara comunicaciones)
- Reglas de negocio:
  - **Inputs obligatorios:** `fecha_evento` (DATE), `duracion_horas` (4 | 8 | 12), `num_adultos_ninos_mayores4` (INT ≥ 0), `extras` (array de `{extra_id, cantidad}`, puede ser vacío)
  - **`num_ninos_menores4` NO es un input del motor:** los niños hasta 4 años son gratuitos y no cuentan para el tramo de invitados (son informativos en la reserva)
  - **Paso 1 — Determinar temporada:** el motor consulta `TEMPORADA_CALENDARIO` del tenant para obtener la temporada del mes de `fecha_evento`. Mapping canónico del MVP (Masia l'Encís): Alta = {5, 6, 7, 8, 9} (mayo–septiembre); Media = {3, 4, 10, 11} (marzo, abril, octubre, noviembre); Baja = {12, 1, 2} (diciembre, enero, febrero)
  - **Paso 2 — Buscar TARIFA:** el motor busca la fila de `TARIFA` donde `temporada` coincide, `duracion_horas` coincide, `num_adultos_ninos_mayores4 BETWEEN invitados_min AND invitados_max`, y la tarifa está vigente en `fecha_evento` (`vigente_desde ≤ fecha_evento` y (`vigente_hasta IS NULL` OR `vigente_hasta ≥ fecha_evento`))
  - **Paso 3 — Caso >50 invitados:** si `num_adultos_ninos_mayores4 > 50` → el motor retorna `{ tarifa_a_consultar: true, precio_total_eur: null, extras_total: null }` sin error; el flujo invocante (UC-14/UC-15) habilita precio manual
  - **Paso 4 — Sumar extras:** para cada `{extra_id, cantidad}` en el array, el motor busca `EXTRA.precio_eur` actual del catálogo del tenant y calcula `subtotal = precio_eur × cantidad`. Todos los subtotales se suman en `extras_total`
  - **Paso 5 — Total:** `total = TARIFA.precio_total_eur + extras_total` (IVA 21% ya incluido en `precio_total_eur`)
  - **Paso 6 — Output:** `{ temporada, precio_tarifa_eur, extras_total_eur, total_eur, tarifa_id }` — se devuelve `tarifa_id` para que el presupuesto pueda registrar qué fila de TARIFA fue usada
  - **Congelación de tarifa:** el motor devuelve los precios actuales del catálogo; es responsabilidad del flujo invocante (UC-14/US-014, UC-15/US-015) marcar `PRESUPUESTO.tarifa_congelada = true` en el momento de confirmar el presupuesto. Si la TARIFA del tarifario cambia después, el PRESUPUESTO ya generado y congelado no se recalcula
  - **Error de configuración:** si no existe `TARIFA` vigente para la combinación de parámetros válida (y `num_adultos_ninos_mayores4 ≤ 50`), el motor lanza error `TARIFA_NO_CONFIGURADA` con los parámetros de búsqueda para diagnóstico
  - **Error de extra no encontrado:** si `extra_id` no existe en el catálogo del tenant o está inactivo (`activo = false`), el motor lanza error `EXTRA_NO_ENCONTRADO`
  - El motor es **stateless y determinista**: los mismos inputs siempre producen el mismo output dado el mismo estado del tarifario. No modifica ninguna entidad; solo lee
- Supuestos: el tenant tiene configurado `TEMPORADA_CALENDARIO` completo (los 12 meses mapeados); si falta algún mes, el motor no puede determinar la temporada y devuelve error
- Dependencias: ninguna — motor de cálculo puro, sin dependencias de estado de RESERVA ni de otras historias. Solo requiere TARIFA y TEMPORADA_CALENDARIO configuradas en el sistema
- Notas de alcance: ninguna — la totalidad de UC-16 está ✅ Implementado en MVP. El cálculo de tarifa estimada previo al presupuesto formal (mostrada en UC-03/US-004 como "tarifa estimada") comparte el mismo motor

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que el tenant tiene `TARIFA` configurada con `temporada = 'alta'`, `duracion_horas = 8`, `invitados_min = 31`, `invitados_max = 50`, `precio_total_eur = 3.200`, vigente en 2026; y `TEMPORADA_CALENDARIO` mapea mes 9 (septiembre) → alta
  **Cuando** el motor recibe `{ fecha_evento: '2026-09-15', duracion_horas: 8, num_adultos_ninos_mayores4: 40, extras: [] }`
  **Entonces** retorna `{ temporada: 'alta', precio_tarifa_eur: 3200, extras_total_eur: 0, total_eur: 3200, tarifa_id: <uuid> }`

### ⚠️ Flujos Alternativos y Edge Cases

#### Con extras del catálogo
- **Dado** la misma TARIFA del happy path, más `EXTRA 'barbacoa'` con `precio_eur = 250` y `EXTRA 'paellero'` con `precio_eur = 400`, ambos activos
  **Cuando** el motor recibe `{ fecha_evento: '2026-09-15', duracion_horas: 8, num_adultos_ninos_mayores4: 40, extras: [{extra_id: barbacoa, cantidad: 1}, {extra_id: paellero, cantidad: 1}] }`
  **Entonces** retorna `{ precio_tarifa_eur: 3200, extras_total_eur: 650, total_eur: 3850, tarifa_id: <uuid> }`

#### Niños menores de 4 años — no cuentan para tarifa
- **Dado** una reserva con `num_adultos_ninos_mayores4 = 30` y `num_ninos_menores4 = 10`
  **Cuando** el motor recibe solo `num_adultos_ninos_mayores4 = 30` (los menores de 4 no se pasan al motor)
  **Entonces** el motor busca la TARIFA para el tramo que incluye 30 invitados, ignorando completamente los 10 niños menores de 4 años

#### FA-01: Más de 50 invitados — tarifa a consultar
- **Dado** que `num_adultos_ninos_mayores4 = 55`
  **Cuando** el motor recibe los parámetros
  **Entonces** retorna `{ tarifa_a_consultar: true, precio_total_eur: null, extras_total_eur: null, total_eur: null }` sin lanzar error; el flujo invocante habilita precio manual

#### FA-02: Tarifa no configurada (error de configuración)
- **Dado** que el tenant no tiene ninguna `TARIFA` vigente con `temporada = 'alta'`, `duracion_horas = 12` y rango que incluya 45 invitados
  **Cuando** el motor busca la tarifa para esos parámetros
  **Entonces** lanza `TARIFA_NO_CONFIGURADA` con detalle `{ temporada: 'alta', duracion_horas: 12, num_invitados: 45 }` para facilitar el diagnóstico al administrador

#### Temporadas: frontera de mes
- **Dado** `fecha_evento = '2026-03-01'` (mes=3, marzo → temporada Media) y `TEMPORADA_CALENDARIO` configurado correctamente
  **Cuando** el motor determina la temporada
  **Entonces** retorna `temporada = 'media'` (no alta ni baja)
- **Dado** `fecha_evento = '2026-09-30'` (mes=9, septiembre → temporada Alta)
  **Cuando** el motor determina la temporada
  **Entonces** retorna `temporada = 'alta'`
- **Dado** `fecha_evento = '2026-12-15'` (mes=12, diciembre → temporada Baja)
  **Cuando** el motor determina la temporada
  **Entonces** retorna `temporada = 'baja'`

#### Duración: 4 horas vs 8 horas vs 12 horas
- **Dado** que `TARIFA` tiene entradas distintas para duracion_horas=4, 8 y 12, todas para temporada=alta, invitados entre 21 y 30
  **Cuando** el motor recibe `duracion_horas = 4`
  **Entonces** retorna la tarifa específica de 4 horas; no la de 8 ni la de 12

#### Tarifa versionada — vigencia de tarifa
- **Dado** que existe `TARIFA_v1` con `vigente_desde = 2025-01-01`, `vigente_hasta = 2025-12-31`, `precio_total_eur = 3000`; y `TARIFA_v2` con `vigente_desde = 2026-01-01`, `vigente_hasta = null`, `precio_total_eur = 3200`; ambas para los mismos parámetros de temporada/duración/invitados
  **Cuando** el motor recibe `fecha_evento = '2026-06-15'` (año 2026)
  **Entonces** retorna `precio_total_eur = 3200` (TARIFA_v2, vigente en 2026)

#### Extra inactivo — error
- **Dado** que `EXTRA 'barbacoa'` tiene `activo = false`
  **Cuando** el motor recibe `extras: [{extra_id: barbacoa, cantidad: 1}]`
  **Entonces** lanza `EXTRA_NO_ENCONTRADO` con detalle `{ extra_id: barbacoa, motivo: 'inactivo' }`

#### Extra no pertenece al tenant — error (aislamiento multi-tenant)
- **Dado** que el `extra_id` pasado al motor pertenece a otro tenant
  **Cuando** el motor busca el EXTRA en el catálogo del tenant actual
  **Entonces** lanza `EXTRA_NO_ENCONTRADO` (Row-Level Security previene la lectura cross-tenant)

### 🔒 Concurrencia / Race Conditions
El motor de tarifa es una operación de **lectura pura** (sin escrituras a BD). No hay estado compartido mutable durante el cálculo. Las únicas escrituras ocurren en el flujo invocante (UC-14/US-014: inserción en PRESUPUESTO, actualización de FECHA_BLOQUEADA), donde sí aplican los tests de concurrencia definidos en US-014. No se requieren tests de race condition propios para este motor.

### 🚫 Reglas de Validación
- `fecha_evento` debe ser una fecha válida (no nula, no pasada al momento de llamar al motor)
- `duracion_horas` ∈ {4, 8, 12}; cualquier otro valor → error de validación de input
- `num_adultos_ninos_mayores4` ≥ 0; si = 0 y el motor no tiene tramo para 0 invitados → `TARIFA_NO_CONFIGURADA`
- Cada `extra_id` en el array debe ser no nulo, pertenecer al tenant y estar activo
- `cantidad` de cada extra ≥ 1
- El tenant debe tener `TEMPORADA_CALENDARIO` configurado para el mes de `fecha_evento`; si no → error `TEMPORADA_NO_CONFIGURADA`

## 📊 Impacto de Negocio
- Impacto esperado: elimina el cálculo manual de presupuestos (D8); el motor es la pieza central que hace posible el objetivo de "presupuesto en 30 segundos" del producto. Sin este motor, UC-14 no puede funcionar
- Criterio de éxito: 0 errores de cálculo de tarifa en producción (verificable comparando el total del motor con la tarifa del tarifario para las 45 combinaciones posibles); latencia de cálculo < 200 ms en el percentil 99
