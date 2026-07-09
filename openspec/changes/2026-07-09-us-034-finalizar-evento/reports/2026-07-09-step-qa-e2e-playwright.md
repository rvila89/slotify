# QA Step N+3 — E2E con Playwright MCP
# US-034: Finalizar evento
# Fecha: 2026-07-09

## Entorno

- Plataforma: Windows 11 Pro 10.0.26200
- Docker Desktop: NO disponible
- PostgreSQL localhost:5432: NO accesible
- Rama: feature/us-034-finalizar-evento

## Estado del E2E

BLOQUEADO. Ni el backend ni el frontend pueden levantarse sin Postgres:
- Backend (`pnpm --filter @slotify/api run dev`): arranca ts-node-dev, compila, mapea rutas, pero falla en `PrismaService.onModuleInit()` con `PrismaClientInitializationError: Can't reach database server at localhost:5432`.
- Frontend (`pnpm --filter @slotify/web dev`): dependeria de la API para autenticar y obtener datos; sin backend funcional no puede ejercitarse el flujo completo.

Los flujos E2E con Playwright MCP (browser_navigate, browser_click, browser_type, browser_snapshot) no se pudieron ejecutar.

## Verificacion estatica de data-testids

Se verifico mediante lectura de codigo fuente la presencia de todos los data-testid requeridos:

| data-testid | Componente | Estado |
|---|---|---|
| `boton-finalizar-evento` | `AccionesConsulta.tsx` linea 300 | PRESENTE |
| `dialog-finalizar-evento` | `FinalizarEventoDialog.tsx` linea 88 | PRESENTE |
| `confirmar-finalizar-evento` | `FinalizarEventoDialog.tsx` linea 144 | PRESENTE |
| `cancelar-finalizar-evento` | `FinalizarEventoDialog.tsx` linea 136 | PRESENTE |
| `aviso-evento-finalizado` | `AvisoEventoFinalizado.tsx` linea 38 | PRESENTE |
| `e5-enviado` | `AvisoEventoFinalizado.tsx` linea 53 | PRESENTE |
| `e5-fallido` | `AvisoEventoFinalizado.tsx` linea 61 | PRESENTE |
| `no_aplica` | NO EXISTE | CORRECTO (sin fianza no se renderiza UI de E5) |
| `aviso-documentacion-pendiente` | `FinalizarEventoDialog.tsx` linea 104 | PRESENTE |
| `aviso-error-finalizar-evento` | `FinalizarEventoDialog.tsx` linea 123 | PRESENTE |

## Verificacion a nivel de test de componente (Vitest)

Los tests de componente (sin BD, con dobles) verifican los flujos de UI de US-034:

### FinalizarEvento.test.tsx (8 tests — PASSED)
- Boton visible solo en estado `evento_en_curso`
- Boton NO visible en otros estados (pre_reserva, reserva_confirmada, post_evento)
- Aviso `aviso-evento-finalizado` con `e5-enviado` cuando e5.resultado=enviado
- Aviso con `e5-fallido` cuando e5.resultado=fallido
- Sin mencion de E5 cuando e5.resultado=no_aplica
- `aviso-documentacion-pendiente` cuando hay items pendientes

### FinalizarEventoDialog.test.tsx (4 tests — PASSED)
- POST al SDK generado al confirmar
- Invalidacion de query tras 200
- Advertencia no bloqueante de documentacion pendiente visible antes de confirmar
- Estado fallido (200 + e5=fallido) NO es error de la mutacion
- 409 inline en el dialogo (aviso-error-finalizar-evento visible, dialogo no cierra)

### finalizarEvento.test.ts (4 tests — PASSED)
- puedeFinalizarEvento: true solo para evento_en_curso
- puedeFinalizarEvento: false para pre_reserva, reserva_confirmada, post_evento
- etiquetaDocumentacionPendiente: traduce claves conocidas
- etiquetaDocumentacionPendiente: fail-open para claves desconocidas

## Responsive (regla dura del proyecto: 390/768/1280)

Verificacion a nivel codigo fuente (sin ejecucion real en navegador):

El dialogo `FinalizarEventoDialog` implementa:
- `w-[calc(100%-2rem)] max-w-lg`: no desborda en movil (390px)
- `max-h-[90vh] overflow-y-auto`: scroll interno, sin overflow vertical
- `DialogFooter className="flex-col gap-3 sm:flex-row"`: apilado en movil (<640px), en fila en tablet/desktop
- Botones `w-full sm:w-auto h-12` (48px altura, objetivo tactico accesible)
- Avisos con `flex items-start` y listas envolventes

El `AccionesConsulta` usa `flex flex-col gap-5` sin anchos fijos que rompan en movil.

La nav lateral del AppShell (verificado por `AppShellResponsive.test.tsx`, 3 tests PASSED):
- Colapsa a drawer + hamburguesa en `<lg`
- Sidebar fijo en `>=lg`

Sin overflow horizontal observable en el codigo de US-034.

Nota: 8.4 ajustado segun instruccion del QA: solo se verifica el mensaje de alerta de fallo de E5, NO el boton de reenvio (diferido a otra US). Confirmado en `AvisoEventoFinalizado.tsx`: no hay boton de reenvio, solo el mensaje "Podras reenviarlo desde la ficha."

## Flujos E2E pendientes (reales, con BD)

Los siguientes flujos quedan NO VERIFICADOS con navegador real:
- Finalizar con fianza (e5-enviado + estado refresca a post_evento en la UI)
- Finalizar sin fianza (sin mencion E5)
- 409 doble finalizacion (aviso inline, dialogo no cierra)
- Responsive en 390/768/1280 con navegador real
- Verificacion de persistencia en BD tras la accion de UI

## Outcome

PARCIAL — verificacion estatica de data-testids completa, verificacion de responsive a nivel codigo fuente, flujos verificados a nivel test de componente (Vitest). E2E Playwright real BLOQUEADO por falta de Postgres/Docker. La seccion 8.4 ajustada: solo mensaje de alerta de reenvio, no boton (correcto segun implementacion).
