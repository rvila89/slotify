---
id: US-049
estado: en-revision
branch: feature/us-049-050-pipeline-reservas
pr: null
---

# Historia de Usuario: Implementar Endpoint GET /reservas del Pipeline

## Metadatos
- ID: US-049
- Área funcional: Gestión del Pipeline de Reservas
- Prioridad: Alta
- Alcance MVP: Implementado (pendiente)
- Estado: Backlog

## Historia
**Como** Gestor
**Quiero** que el sistema exponga un endpoint `GET /reservas` que devuelva la lista de reservas activas del pipeline con datos de progreso incluidos
**Para** poder alimentar las vistas de Kanban y Listado de la pantalla de Reservas sin múltiples llamadas adicionales

## Contexto de Negocio
- Caso(s) de uso: UC-37, UC-38
- Entidades implicadas: `RESERVA`, `CLIENTE` (join para nombre), `FICHA_OPERATIVA` (para progreso logística), `LIQUIDACION` (para progreso liquidación)
- Dolor(es) que resuelve: D2 (cero visibilidad del pipeline — imposible priorizar follow-ups), D7 (sin dashboards — gestión por intuición)
- Reglas de negocio:
  - El endpoint filtra estados activos: excluye `2x`, `2y`, `2z`, `reserva_completada`, `reserva_cancelada`
  - RLS: solo reservas con `tenant_id` del JWT del gestor autenticado
  - `progressLogistica` (0/50/100%) se deriva de `preEventoStatus`: `pendiente=0`, `en_curso=50`, `cerrado=100`
  - `progressLiquidacion` (0/50/100%) se deriva de `liquidacionStatus`: `pendiente=0`, `facturada=50`, `cobrada=100`
  - Para estados consulta (2a/2b/2c/2d/2v) y pre_reserva: ambos progresos arrancan en 0%
  - `nombreEvento` = `{cliente.nombre} {cliente.apellidos}` (o `codigo` como fallback si no hay cliente)
- Dependencias: US-001 (sesión activa con `tenant_id` en JWT), US-003 (reservas existen en la BD)
- Notas de alcance:
  - El endpoint `GET /reservas` ya está definido en `docs/api-spec.yml` (línea 194) pero no tiene implementación en el backend
  - Se añaden campos opcionales al schema `Reserva`: `nombreEvento`, `progressLogistica`, `progressLiquidacion` (cambio aditivo — no rompe contratos existentes como FichaConsulta)
  - Los parámetros de query ya definidos en la spec se mantienen: `estado`, `subEstado`, `fechaDesde`, `fechaHasta`, `search`, `page`, `limit`
  - Scope de implementación: hexagonal completo (domain port + application use case + infrastructure adapter + interface controller)

## Criterios de Aceptación (BDD)

### Happy Path

- **Dado** que el gestor está autenticado
  **Cuando** llama a `GET /reservas` (sin filtros adicionales)
  **Entonces** el sistema devuelve todas las reservas activas del tenant (excluyendo terminales y completadas/canceladas) con `nombreEvento`, `progressLogistica` y `progressLiquidacion`

- **Dado** que existen reservas en todos los estados activos (2a, 2b, 2c, 2d, 2v, pre_reserva, reserva_confirmada, evento_en_curso, post_evento)
  **Cuando** el gestor llama a `GET /reservas`
  **Entonces** todas aparecen en la respuesta ordenadas por `fechaCreacion` descendente

- **Dado** que una reserva tiene `preEventoStatus = en_curso`
  **Cuando** aparece en el listado
  **Entonces** su `progressLogistica` es `50`

- **Dado** que una reserva tiene `liquidacionStatus = cobrada`
  **Cuando** aparece en el listado
  **Entonces** su `progressLiquidacion` es `100`

### Flujos Alternativos y Edge Cases

#### FA-01 / Sin reservas activas
- **Dado** que no hay reservas activas para el tenant
  **Cuando** el gestor llama a `GET /reservas`
  **Entonces** el sistema responde `{ data: [], metadata: { total: 0, page: 1, limit: 20 } }` con status 200

#### FA-02 / Exclusión de estados terminales
- **Dado** que existen reservas en `2x`, `2y`, `2z`, `reserva_completada` o `reserva_cancelada`
  **Cuando** el gestor llama a `GET /reservas` sin filtro de estado
  **Entonces** esas reservas NO aparecen en la respuesta

#### FA-03 / Multi-tenancy
- **Dado** que existen reservas de tenant A y tenant B
  **Cuando** el gestor del tenant A llama a `GET /reservas`
  **Entonces** solo aparecen las reservas del tenant A (RLS por `tenant_id` del JWT)

#### FA-04 / Filtro por estado
- **Dado** que el gestor pasa `?estado=pre_reserva`
  **Cuando** llama a `GET /reservas`
  **Entonces** solo aparecen reservas en `pre_reserva`

### Concurrencia / Race Conditions
No aplica. Este endpoint es de solo lectura — no produce mutaciones, no requiere bloqueos.

### Reglas de Validación
- JWT requerido (401 sin token)
- `tenant_id` del JWT inyectado en todas las queries (no configurable por el usuario)
- Parámetros de paginación: `page >= 1`, `limit` entre 1 y 100

## Impacto de Negocio
El gestor pasa de no tener ninguna vista de pipeline activo a poder ver todas sus reservas en curso en un único endpoint optimizado, que alimenta tanto el Kanban como el Listado de la pantalla de Reservas sin overhead de múltiples llamadas.

## Scope técnico (cuando se implemente)

### Backend (hexagonal)
- `apps/api/src/reservas/domain/listar-reservas.port.ts` — puerto dominio
- `apps/api/src/reservas/application/listar-reservas.use-case.ts` — caso de uso
- `apps/api/src/reservas/infrastructure/listar-reservas.prisma.adapter.ts` — adaptador Prisma (query activas + join cliente)
- `apps/api/src/reservas/interface/listar-reservas.controller.ts` — controller `GET /reservas`

### Contrato OpenAPI
- Añadir `operationId: listarReservas` al path `GET /reservas` existente
- Añadir campos opcionales a `Reserva` schema: `nombreEvento: string`, `progressLogistica: integer (0-100)`, `progressLiquidacion: integer (0-100)`
- Regenerar SDK: `apps/web/src/api-client/`

### Tests TDD (RED antes de implementar)
- `apps/api/src/reservas/__tests__/listar-reservas.use-case.spec.ts`
  - Lista vacía cuando no hay reservas activas
  - Incluye todos los estados activos (2a, 2b, 2c, 2d, 2v, pre_reserva, reserva_confirmada, evento_en_curso, post_evento)
  - Excluye 2x, 2y, 2z, reserva_completada, reserva_cancelada
  - Multi-tenancy: tenant A no ve reservas de tenant B
  - `progressLogistica` = 0 para pendiente, 50 para en_curso, 100 para cerrado
  - `progressLiquidacion` = 0 para consulta sin liquidación, 100 para cobrada
  - `nombreEvento` derivado correctamente del cliente
