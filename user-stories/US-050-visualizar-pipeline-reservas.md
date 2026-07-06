---
id: US-050
estado: backlog
branch: null
pr: null
---

# Historia de Usuario: Visualizar Pipeline de Reservas (Kanban + Listado)

## Metadatos
- ID: US-050
- Área funcional: Gestión del Pipeline de Reservas
- Prioridad: Alta
- Alcance MVP: Implementado (pendiente)
- Estado: Backlog

## Historia
**Como** Gestor
**Quiero** ver todas las reservas activas del pipeline agrupadas por fase en un Kanban y también en un Listado tabular desde una sola pantalla
**Para** tener visibilidad global del estado de todas las reservas en curso sin necesidad de navegar ficha a ficha

## Contexto de Negocio
- Caso(s) de uso: UC-37 (Kanban), UC-38 (Listado)
- Entidades implicadas: `RESERVA` (solo lectura, vía US-049)
- Dolor(es) que resuelve: D2 (cero visibilidad del pipeline — imposible priorizar follow-ups), D7 (sin dashboards — gestión por intuición)
- Dependencias: US-049 (endpoint `GET /reservas`), US-001 (sesión activa)
- Notas de alcance:
  - La pantalla `/reservas` actualmente muestra un `SectionPlaceholder` — esta US lo reemplaza con la página funcional
  - **Tab "Flujo de Reserva" (Kanban)**: 5 columnas agrupadas por fase, scroll horizontal. Sin transiciones de estado inline por ahora — clic en tarjeta navega a FichaConsulta
  - **Tab "Listado"**: tabla responsive con columnas Nombre · Estado · Fecha · Aforo · Acciones
  - Diseño de referencia: Figma node 0:523 (`rBCYMkAoQQRVnWhOxXatio`)
  - Los avatares de equipo visibles en la columna "Confirmada" del Figma quedan fuera de MVP (requieren entidad de asignación de equipo)

## Criterios de Aceptación (BDD)

### Happy Path — Tab Flujo de Reserva (Kanban)

- **Dado** que el gestor está autenticado
  **Cuando** navega a `/reservas`
  **Entonces** el sistema muestra la pantalla con el tab "Flujo de Reserva" activo por defecto y 5 columnas Kanban visibles: Consulta · Pre-reserva · Confirmada · En Curso · Post-evento

- **Dado** que existen reservas en distintos estados activos
  **Cuando** el gestor visualiza el Kanban
  **Entonces** cada reserva aparece en la columna correcta según su fase:
  - 2a/2b/2c/2d/2v → columna "Consulta"
  - pre_reserva → columna "Pre-reserva"
  - reserva_confirmada → columna "Confirmada"
  - evento_en_curso → columna "En Curso"
  - post_evento → columna "Post-evento"

- **Dado** que el gestor visualiza una tarjeta del Kanban
  **Entonces** la tarjeta muestra: nombre del evento, fecha + aforo, barra de progreso LOGÍSTICA (%) y barra LIQUIDACIÓN (%), y una nota de estado si existe

- **Dado** que el gestor hace clic en el icono de enlace o en la tarjeta
  **Cuando** la tarjeta pertenece a la reserva con `idReserva = X`
  **Entonces** el sistema navega a `/reservas/X` (FichaConsultaPage)

### Happy Path — Tab Listado

- **Dado** que el gestor selecciona el tab "Listado"
  **Cuando** el sistema carga los datos (mismo hook que el Kanban)
  **Entonces** el gestor ve una tabla con todas las reservas activas, con columnas: Nombre · Estado · Fecha · Aforo · Acciones

- **Dado** que el gestor hace clic en una fila de la tabla
  **Entonces** el sistema navega a la FichaConsulta de esa reserva

### Flujos Alternativos y Edge Cases

#### FA-01 / Sin reservas activas
- **Dado** que no hay reservas activas para el tenant
  **Cuando** el gestor accede a `/reservas`
  **Entonces** las columnas del Kanban aparecen vacías con un estado vacío descriptivo y un CTA de "Nueva Reserva"

#### FA-02 / Estado de carga
- **Dado** que el sistema está cargando las reservas
  **Cuando** el gestor accede a `/reservas`
  **Entonces** se muestra un skeleton de carga (columnas con tarjetas fantasma) sin errores de interfaz

#### FA-03 / Error de red
- **Dado** que `GET /reservas` falla con error de red o 5xx
  **Cuando** el gestor accede a `/reservas`
  **Entonces** se muestra un estado de error con opción de reintento

#### FA-04 / Responsive móvil (< lg)
- **Dado** que el gestor usa un dispositivo móvil (viewport < 1024px)
  **Cuando** visualiza el tab "Flujo de Reserva"
  **Entonces** el Kanban se muestra con scroll horizontal (no columnas apiladas) y en el tab "Listado" las filas se adaptan a tarjetas apiladas

### Reglas de Validación
- Solo se muestran reservas activas (mismos filtros que UC-37: excluye terminales 2x/2y/2z, reserva_completada, reserva_cancelada)
- Aislamiento de tenant: solo reservas del gestor autenticado (garantizado por US-049)

## Impacto de Negocio
El gestor obtiene una vista panorámica del pipeline completo de reservas activas en un único punto de entrada, eliminando la necesidad de navegar ficha a ficha para saber en qué estado está cada reserva. Habilita la priorización diaria y el seguimiento del progreso de cada evento desde logística hasta liquidación.

## Scope técnico (cuando se implemente)

### Frontend
- `apps/web/src/features/reservas/pages/ReservasPage/`
  - `ReservasPage.tsx` — orquestador con estado de tab activo (`flujo` | `listado`)
  - `KanbanView.tsx` — 5 columnas Kanban con scroll horizontal
  - `KanbanColumn.tsx` — cabecera (dot color + label + badge count) + lista de tarjetas
  - `ReservaKanbanCard.tsx` — tarjeta con nombre, fecha+pax, barras de progreso, nota, icono link
  - `ListadoView.tsx` — tabla responsive (tabla en `≥lg`, cards apiladas en `<lg`)
  - `ProgressBar.tsx` — barra de progreso reutilizable (label, valor %, color)
- `apps/web/src/features/reservas/api/useReservasActivas.ts` — hook TanStack Query (staleTime: 30_000)
- Actualizar barrel `apps/web/src/features/reservas/index.ts`
- `apps/web/src/App.tsx`: sustituir `SectionPlaceholder` en route `/reservas` por `ReservasPage`

### Tokens de diseño Figma (node 0:523)
- Fondo columna: `bg-[#f6f3ee] rounded-xl p-4`
- Tarjeta: `bg-[#fcf9f4] border border-[rgba(216,194,188,0.3)] rounded-xl p-[17px] shadow-[0px_12px_24px_-4px_rgba(125,110,100,0.08)]`
- Progress LOGÍSTICA: color `#8d4d39` sobre `#eae1d6`
- Progress LIQUIDACIÓN: color `#6a5c52` sobre `#eae1d6`
- Dots de columna: Consulta=`#6a5c52`, Pre-reserva=`#d98b74`, Confirmada=`#8d4d39`, En Curso=`#8d4d39`, Post-evento=`#6a5c52`
- Ancho columna: `min-w-[320px] w-[320px]`

### Mapping fase → columna Kanban
| Columna | Estados agrupados | Dot color |
|---------|-------------------|-----------|
| Consulta | 2a, 2b, 2c, 2d, 2v | `#6a5c52` |
| Pre-reserva | pre_reserva | `#d98b74` |
| Confirmada | reserva_confirmada | `#8d4d39` |
| En Curso | evento_en_curso | `#8d4d39` |
| Post-evento | post_evento | `#6a5c52` |
