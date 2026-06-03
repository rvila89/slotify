# 🧾 Historia de Usuario: Buscar y Filtrar en el Histórico de Reservas

## 🆔 Metadatos
- ID: US-042
- Área funcional: Histórico
- Módulo: M1 — Reservas (Pipeline, Histórico, Ficha y Cola)
- Prioridad: Alta  (heredada de UC-32)
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** buscar y filtrar reservas en el histórico mediante filtros estructurados y búsqueda full-text, y acceder al detalle de cualquier registro en modo lectura
**Para** consultar la información completa de eventos pasados sin riesgo de modificarlos accidentalmente, apoyando la gestión comercial, la preparación de nuevos eventos similares y la trazabilidad operativa

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-32
- Entidades implicadas: `RESERVA`, `CLIENTE`, `FACTURA`, `PRESUPUESTO`, `FICHA_OPERATIVA`, `DOCUMENTO`
- Dolor(es) que resuelve: D5 (histórico centralizado y consultable — elimina la dispersión de información entre correos y hojas de cálculo), D1 (gestión integral en un único sistema), D9 (el gestor accede al historial de un cliente sin búsquedas manuales entre archivos)
- Automatización relacionada: ninguna directa (vista de lectura pura; el estado `reserva_completada` es escrito por A12 en US-037 y manualmente en US-038)
- Email relacionado: ninguno
- Reglas de negocio:
  - La vista de Histórico muestra por defecto `RESERVA` con `estado = reserva_completada`. El filtro "estado final" permite incluir también `reserva_cancelada` en la búsqueda.
  - Las reservas en el histórico son **inmutables**: el modo lectura no expone controles de edición. Los sub-estados terminales (2.x, 2.y, 2.z) ya no tienen bloqueo activo y no aparecen en esta vista (su `fecha_evento` puede consultarse desde la ficha de una reserva relacionada si el gestor lo busca por código).
  - Filtros disponibles: rango de fechas de evento, tipo de evento (`RESERVA.tipo_evento`), estado final (`reserva_completada` | `reserva_cancelada`), importe total.
  - Búsqueda full-text sobre: nombre y apellidos del `CLIENTE` asociado, `RESERVA.codigo`, email del `CLIENTE`, `RESERVA.notas`.
  - Los resultados se muestran paginados, ordenados por `RESERVA.fecha_evento` descendente por defecto.
  - Aislamiento multi-tenant: la consulta filtra obligatoriamente por `tenant_id` del JWT activo.
- Supuestos:
  - Las consultas en estados terminales de consulta (2.x, 2.y, 2.z) son registros del pipeline que nunca llegaron a `reserva_confirmada`; el gestor puede verlos en la vista de Pipeline si busca por código, pero no forman parte de la vista de Histórico (que recoge eventos que llegaron a completarse o cancelarse).
  - El detalle en modo lectura muestra todos los datos de la ficha: datos del cliente, presupuesto aceptado, facturas, ficha operativa y documentos adjuntos.
- Dependencias:
  - US-037 (archivado automático) y US-038 (archivado manual) para que existan registros en estado `reserva_completada`.
  - US-001 (sesión activa) como precondición de acceso.
- Notas de alcance: UC-32 menciona la posibilidad de "acceder al detalle de cualquier reserva (modo lectura)". El modo lectura comprende todos los datos de la ficha; no hay funcionalidad de edición en el histórico (las reservas completadas son terminales e inmutables por diseño del modelo mental del sistema). No hay zonas `📐` que rocen este UC.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que el Gestor está autenticado y existen reservas con `estado = reserva_completada` para el tenant activo
  **Cuando** accede a la sección Histórico
  **Entonces** el sistema muestra una tabla paginada con las reservas completadas, ordenadas por `fecha_evento` descendente, con al menos las columnas: código de reserva, nombre y apellidos del cliente, fecha del evento, tipo de evento, importe total y estado final

- **Dado** que el Gestor visualiza la tabla del histórico
  **Cuando** aplica un filtro de rango de fechas de evento (p. ej. "enero 2026 — marzo 2026")
  **Entonces** la tabla se actualiza mostrando exclusivamente las reservas cuya `RESERVA.fecha_evento` cae dentro del rango, y el número de resultados se refleja en el indicador de paginación

- **Dado** que el Gestor visualiza la tabla del histórico
  **Cuando** introduce el término "García" en la búsqueda full-text
  **Entonces** el sistema devuelve todas las reservas del tenant donde "García" aparece en `CLIENTE.nombre`, `CLIENTE.apellidos`, `CLIENTE.email` o `RESERVA.notas`, con los resultados paginados y el término destacado visualmente

- **Dado** que el Gestor visualiza la tabla del histórico con resultados paginados
  **Cuando** hace clic en una fila de reserva
  **Entonces** el sistema muestra la ficha completa de esa reserva en modo lectura, sin ningún control de edición, mostrando: datos del cliente, presupuesto aceptado, facturas generadas, ficha operativa y documentos adjuntos

### ⚠️ Flujos Alternativos y Edge Cases

#### Sin resultados para los filtros aplicados
- **Dado** que el Gestor aplica un filtro de rango de fechas que no contiene ninguna reserva completada
  **Cuando** el sistema ejecuta la búsqueda
  **Entonces** se muestra un estado vacío informativo ("No hay reservas completadas en el período seleccionado") sin errores, con la opción de limpiar filtros y volver a la vista completa
- Comportamiento del sistema: tabla vacía con mensaje de estado; el botón "Limpiar filtros" restaura la vista por defecto.

#### Búsqueda full-text sin coincidencias
- **Dado** que el Gestor introduce una cadena de búsqueda que no coincide con ningún registro del tenant
  **Cuando** el sistema ejecuta la búsqueda full-text
  **Entonces** se muestra el estado vacío informativo correspondiente y se indica que no se han encontrado resultados para ese término
- Comportamiento del sistema: idéntico al edge case anterior.

#### Filtrar incluyendo reservas canceladas
- **Dado** que el Gestor selecciona "Estado final: Cancelada" en el filtro de estado final
  **Cuando** el sistema aplica el filtro
  **Entonces** la tabla muestra las reservas con `RESERVA.estado = reserva_cancelada` del tenant, manteniendo el resto de filtros activos como condiciones adicionales (AND)
- Comportamiento del sistema: la vista por defecto solo muestra `reserva_completada`; la inclusión de `reserva_cancelada` es opt-in mediante el filtro.

#### Combinación de múltiples filtros activos
- **Dado** que el Gestor tiene activos simultáneamente un filtro de rango de fechas, un filtro de tipo de evento ("boda") y un término de búsqueda full-text
  **Cuando** la tabla se actualiza
  **Entonces** solo se muestran reservas que cumplen **todas** las condiciones a la vez (AND lógico entre filtros)
- Comportamiento del sistema: los filtros son acumulativos; cada filtro adicional reduce el conjunto de resultados.

#### Acceso al histórico sin reservas completadas (tenant reciente)
- **Dado** que el tenant no tiene todavía ninguna reserva con `estado = reserva_completada` (es un tenant nuevo o todas sus reservas están aún activas)
  **Cuando** el Gestor accede al Histórico
  **Entonces** el sistema muestra la tabla vacía con el mensaje "Aún no hay reservas archivadas" y accesos directos al Calendario y al Pipeline
- Comportamiento del sistema: vista vacía funcional sin errores; no hay redirección forzada.

#### Aislamiento multi-tenant
- **Dado** que el JWT del Gestor contiene `tenant_id = 'T-001'`
  **Cuando** el sistema ejecuta cualquier consulta del Histórico
  **Entonces** solo se devuelven registros de `RESERVA` con `tenant_id = 'T-001'`; ningún dato de otros tenants es accesible ni visible
- Comportamiento del sistema: `tenant_id` del JWT es condición obligatoria en todas las queries del módulo.

### 🔒 Concurrencia / Race Conditions (solo zonas críticas)
Esta historia es de **lectura pura** sobre datos en estado terminal (`reserva_completada`, `reserva_cancelada`). Los registros del histórico son inmutables: no pueden volver a un estado anterior ni ser modificados. Por tanto, no existen ventanas de carrera relevantes en este UC. Las garantías de atomicidad y concurrencia están en US-040 (bloqueo atómico de fecha) y US-018/US-019 (cola); el Histórico se limita a consultar el resultado final de esas garantías.

### 🚫 Reglas de Validación
- El acceso al Histórico requiere sesión autenticada (`USUARIO.activo = true`, JWT válido).
- La vista de Histórico es **estrictamente de lectura**: no se exponen endpoints de mutación para reservas con `estado ∈ {reserva_completada, reserva_cancelada}`.
- El filtro por `tenant_id` es **obligatorio e implícito** en todas las consultas; no puede ser omitido ni modificado por el Gestor.
- La búsqueda full-text opera únicamente sobre los campos declarados (`CLIENTE.nombre`, `CLIENTE.apellidos`, `CLIENTE.email`, `RESERVA.notas`, `RESERVA.codigo`); no expone SQL raw ni permite inyección de queries.
- La paginación debe aplicarse siempre para proteger la disponibilidad del sistema ante históricos grandes; no se permite la devolución ilimitada de registros en una única respuesta.

## 📊 Impacto de Negocio
- Impacto esperado: el Gestor puede localizar cualquier evento pasado (por cliente, fecha o tipo) en segundos sin salir del sistema, eliminando la búsqueda manual entre archivos de correo y hojas de cálculo históricas. Facilita la preparación de nuevos presupuestos para clientes con eventos previos y la trazabilidad ante consultas externas (auditoría, reclamaciones).
- Criterio de éxito: el Gestor localiza cualquier reserva completada por nombre de cliente en < 10 segundos desde la apertura del Histórico, con 0 resultados de tenants cruzados (validable con test de aislamiento multi-tenant y test de usabilidad cronometrado con el gestor de Masia l'Encís).
