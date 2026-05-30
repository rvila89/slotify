# 🧾 Historia de Usuario: Visualizar el Calendario de Disponibilidad

## 🆔 Metadatos
- ID: US-039
- Área funcional: Calendario y Disponibilidad
- Módulo: M2 — Calendario & Disponibilidad
- Prioridad: Crítica  (heredada de UC-29)
- Alcance MVP: ✅ Implementado
- Estado: Borrador
- Owner: PM

## 🎯 Historia
**Como** Gestor
**Quiero** ver el calendario mensual con el estado de disponibilidad de cada fecha mediante un código de colores, incluyendo indicador de cola cuando hay leads en espera
**Para** tener visibilidad instantánea del pipeline de reservas, detectar fechas comprometidas y tomar decisiones de seguimiento sin consultar registros individuales

## 🧠 Contexto de Negocio
- Caso(s) de uso: UC-29
- Entidades implicadas: `RESERVA`, `FECHA_BLOQUEADA`, `TENANT`
- Dolor(es) que resuelve: D2 (cero visibilidad del pipeline), D4 (riesgo de doble reserva)
- Automatización relacionada: ninguna directa (vista de lectura pura; los estados que refleja son escritos por A1, A2, A4, A5, A6, A15, A21)
- Email relacionado: ninguno
- Reglas de negocio:
  - El Calendario es la página de inicio del sistema tras el login (sidebar → primera opción).
  - Vista por defecto: mensual (FullCalendar o react-big-calendar — librería negociable).
  - Código de colores canónico (SlotifyGeneralSpecs §11.3): gris = consulta activa (2.a/2.b/2.c/2.v), ámbar = pre_reserva, verde = reserva_confirmada / evento_en_curso / post_evento, azul = reserva_completada (histórica), rojo = reserva_cancelada.
  - El indicador `🔁 N en cola` se superpone sobre la fecha bloqueante (en 2.b) cuando hay ≥ 1 consulta en sub_estado 2.d apuntando a esa fecha (`consulta_bloqueante_id`).
  - El gestor puede cambiar la vista (mes / semana / día / lista) y navegar entre períodos.
  - Al hacer clic en una fecha con reserva/bloqueo activo, el sistema muestra el detalle resumido (cliente, estado, TTL restante).
  - Al hacer clic en una fecha con indicador `🔁`, el sistema abre la vista de cola de espera (UC-11 / US-017).
  - Aislamiento multi-tenant: solo se muestran fechas del `tenant_id` del JWT activo.
- Supuestos:
  - Los sub-estados terminales (2.x, 2.y, 2.z) no ocupan fecha (la fecha ya fue liberada); no aparecen como bloqueadas.
  - `evento_en_curso` y `post_evento` heredan el color verde de `reserva_confirmada` (diferenciación visual de detalle solo en la ficha).
- Dependencias: ninguna de implementación (vista de lectura sobre datos generados por otras US).
- Notas de alcance: UC-29 menciona "Indicador 🔁: tiene cola de espera" sin especificar el color exacto para 2.d. SlotifyGeneralSpecs §11.3 añade "violeta = en cola"; sin embargo, en la vista de calendario el indicador actúa sobre la fecha bloqueante (gris + 🔁), no sobre una celda propia para 2.d. No hay conflicto de entidades; el color violeta se reserva para futuras vistas de pipeline. Si el PO prefiere mostrar un chip distinto, es decisión negociable de UI.

## ✅ Criterios de Aceptación (BDD)

### 🎯 Happy Path

- **Dado** que el Gestor está autenticado en el tenant y existen reservas en distintos estados para el mes en curso
  **Cuando** accede a la sección Calendario
  **Entonces** el sistema muestra la vista mensual del mes actual, con cada fecha con bloqueo activo coloreada según el código canónico:
  - Gris → fecha con consulta activa (2.a, 2.b, 2.c o 2.v)
  - Ámbar → fecha con pre_reserva
  - Verde → fecha con reserva_confirmada, evento_en_curso o post_evento
  - Azul → fecha con reserva_completada (histórica)
  - Rojo → fecha con reserva_cancelada
  - Sin color (blanco/neutro) → fecha libre, sin bloqueo activo

- **Dado** que una fecha tiene sub_estado 2.b y hay ≥ 1 reserva en 2.d con `consulta_bloqueante_id` apuntando a esa reserva
  **Cuando** el Gestor visualiza el calendario
  **Entonces** la celda de esa fecha muestra el color gris (consulta activa) más el indicador `🔁 N en cola`, donde N es el número de reservas en cola

### ⚠️ Flujos Alternativos y Edge Cases

#### Mes sin reservas / fechas libres
- **Dado** que el mes seleccionado no tiene ningún bloqueo en `FECHA_BLOQUEADA` para el tenant
  **Cuando** el Gestor navega a ese mes
  **Entonces** todas las celdas se muestran sin color (disponibles) y el calendario sigue siendo interactivo y navegable
- Comportamiento del sistema: vista vacía pero completamente funcional; sin errores.

#### Clic en fecha con reserva activa
- **Dado** que la fecha D tiene una consulta activa en sub_estado 2.b con cliente "Ana García" y TTL restante de 2 días
  **Cuando** el Gestor hace clic sobre la celda D
  **Entonces** el sistema muestra un panel/popover con al menos: nombre del cliente, sub_estado actual ("2.b — Con fecha"), TTL restante ("2 días") y enlace a la ficha completa de la reserva
- Comportamiento del sistema: lectura de `RESERVA` y `FECHA_BLOQUEADA`; sin mutación de estado.

#### Clic en fecha con indicador de cola
- **Dado** que la fecha D muestra `🔁 2 en cola`
  **Cuando** el Gestor hace clic sobre la celda D o sobre el indicador 🔁
  **Entonces** el sistema navega / abre la vista de cola de esa fecha (UC-11 / US-017), mostrando la consulta bloqueante y las 2 consultas en espera
- Comportamiento del sistema: delega en US-017 para la visualización de cola.

#### Cambio de vista (semana / lista)
- **Dado** que el Gestor está en la vista mensual
  **Cuando** selecciona la vista "semana" o "lista"
  **Entonces** el sistema muestra las mismas fechas con el mismo código de colores adaptado a la nueva vista, sin recargar datos innecesariamente
- Comportamiento del sistema: el código de colores es consistente entre vistas.

#### Navegación a mes pasado (histórico)
- **Dado** que el Gestor navega a un mes anterior con reservas completadas y canceladas
  **Cuando** visualiza el calendario de ese mes
  **Entonces** las fechas de reservas_completadas se muestran en azul y las canceladas en rojo; las fechas de consultas expiradas (2.x, 2.y, 2.z) aparecen sin color (su bloqueo ya fue liberado)
- Comportamiento del sistema: consulta `RESERVA.estado` y `RESERVA.fecha_evento` en modo lectura; `FECHA_BLOQUEADA` para ese mes ya no tiene registros de esas reservas terminales.

#### Aislamiento multi-tenant
- **Dado** que el tenant_id del JWT es "T-001"
  **Cuando** el sistema carga el calendario
  **Entonces** solo se muestran fechas con `FECHA_BLOQUEADA.tenant_id = 'T-001'` y `RESERVA.tenant_id = 'T-001'`; ningún dato de otros tenants es visible
- Comportamiento del sistema: la query filtra obligatoriamente por `tenant_id` del JWT.

### 🔒 Concurrencia / Race Conditions (solo zonas críticas)
Esta historia es de **lectura pura** (no muta estado). No aplica test de race condition en el propio UC-29. Las garantías de concurrencia sobre los bloqueos de fecha residen en US-040 (que es quien escribe `FECHA_BLOQUEADA`). El calendario refleja el estado actual de la BD; el stale-read de milisegundos no es un riesgo operativo relevante para una vista visual.

### 🚫 Reglas de Validación
- El calendario **solo** muestra fechas con `FECHA_BLOQUEADA` activa o `RESERVA.fecha_evento` en estados no terminales del tenant autenticado.
- El indicador `🔁` **requiere** ≥ 1 registro `RESERVA` con `sub_estado = '2d'` y `consulta_bloqueante_id` apuntando a la reserva bloqueante de esa fecha.
- Las fechas anteriores a hoy con estados `2.a`, `2.b`, `2.c`, `2.v` (consultas activas sobre fechas pasadas, caso anómalo) no deben bloquearse a nivel de UI pero sí mostrarse para auditoría.
- El código de colores es idéntico en todas las vistas (mes, semana, día, lista); no puede variar por vista.

## 📊 Impacto de Negocio
- Impacto esperado: el Gestor obtiene visión instantánea del estado de ocupación sin abrir fichas individuales, reduciendo el tiempo de inspección diaria del pipeline de ~15 min (manual en Sheets) a <1 min.
- Criterio de éxito: el Gestor identifica correctamente el estado de todas las fechas bloqueadas del mes en <30 segundos sin errores de interpretación (validable en test de usabilidad con el gestor de Masia l'Encís).
