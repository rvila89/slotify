# QA Step N+2 — Pruebas de Endpoints con curl
# US-034: Finalizar evento
# Fecha: 2026-07-09

## Entorno

- Plataforma: Windows 11 Pro 10.0.26200
- Docker Desktop: NO disponible
- PostgreSQL localhost:5432: NO accesible
- Rama: feature/us-034-finalizar-evento

## Bloqueo: API no levantable sin Postgres

El backend arranca (ts-node-dev compila y resuelve rutas, log confirma el endpoint mapeado):

```
[RouterExplorer] Mapped {/api/reservas/:id/finalizar-evento, POST} route
```

Pero falla en `PrismaService.onModuleInit()` al intentar `$connect()` sobre localhost:5432:

```
PrismaClientInitializationError: Can't reach database server at `localhost:5432`
```

En consecuencia, las pruebas curl reales (7.2-7.6) no pudieron ejecutarse.

## Verificacion HTTP via supertest (sin BD real)

La bateria `finalizar-evento.controller.http.spec.ts` ejercita el contrato HTTP completo con supertest y un use-case doblado:

| Caso | Comando simulado | Respuesta esperada | Resultado |
|---|---|---|---|
| Happy path con fianza (e5=enviado) | POST /api/reservas/res-evento/finalizar-evento (rol gestor) | 200 + {estado: post_evento, e5: {resultado: enviado, comunicacionId}} | PASSED |
| Sin fianza (e5=no_aplica) | POST /api/reservas/res-evento/finalizar-evento (modo no-aplica) | 200 + {e5: {resultado: no_aplica, comunicacionId: null}} | PASSED |
| Conflicto de estado | POST /api/reservas/res-evento/finalizar-evento (modo conflicto) | 409 + {code: transicion_no_permitida} | PASSED |
| No encontrada / otro tenant | POST /api/reservas/res-evento/finalizar-evento (modo no-encontrada) | 404 + {statusCode: 404} | PASSED |
| Sin rol gestor (403) | POST con usuarioActual.rol='cliente' | 403 + use-case no invocado | PASSED |
| Sin JWT (401/403) | POST sin req.user | 401 o 403, use-case no invocado | PASSED |

Total: 6/6 casos PASSED.

## Hallazgo critico — Discrepancia respuesta 200 vs contrato

### Contrato OpenAPI (`docs/api-spec.yml`)

`FinalizarEventoResponse` esta definido como:

```yaml
FinalizarEventoResponse:
  allOf:
    - $ref: '#/components/schemas/Reserva'
    - type: object
      required: [e5, documentacionPendiente]
      properties:
        e5: { $ref: '#/components/schemas/FinalizarEventoE5' }
        documentacionPendiente:
          type: array
          items: { type: string }
```

Es decir: el cuerpo Reserva COMPLETO + `e5` + `documentacionPendiente`.

### Respuesta real del backend

El controller devuelve `FinalizarEventoResultado`:

```typescript
{
  reservaId: string;
  estado: EstadoReserva;
  e5: ResultadoDispararE5;
  documentacionPendiente: string[];
}
```

Los campos del objeto `Reserva` del contrato (clienteId, fianzaEur, fianzaStatus, fechaEvento, codigo, subEstado, ttlExpiracion, etc.) NO se hidratan en la respuesta.

### Impacto en el frontend

El hook `useFinalizarEvento` en `onSuccess` hace:

```typescript
queryClient.setQueryData(reservaQueryKey(id), (prev) =>
  prev ? { ...prev, ...respuesta } : prev,
);
void queryClient.invalidateQueries({ queryKey: reservaQueryKey(id) });
```

El spread `{ ...prev, ...respuesta }` actualiza `estado` en la cache con `post_evento` (correcto), pero los campos de Reserva que no vienen en `respuesta` no se sobreescriben (tampoco se corrompen). El `invalidateQueries` posterior fuerza un refetch de `GET /reservas/{id}` que trae la Reserva completa actualizada.

El componente `AvisoEventoFinalizado` accede solo a `resultado.e5.resultado` y `resultado.documentacionPendiente`, ambos presentes en la respuesta real. La UI no muestra los campos de Reserva completos del 200.

### Clasificacion del hallazgo

NIVEL: MEDIO. La discrepancia contrato/implementacion es real pero el impacto funcional es mitigado por el `invalidateQueries`. Sin embargo:
- El contrato dice que la respuesta es una `Reserva` completa. El cliente generado tipara la respuesta como `FinalizarEventoResponse` (que extiende `Reserva`). Si el frontend accediera a campos de Reserva desde la respuesta del 200 (sin esperar el refetch), obtendria `undefined`.
- La discrepancia debe resolverse: (a) el contrato debe ajustarse para reflejar el subconjunto real, o (b) el backend debe hidratar la Reserva completa en la respuesta.

## Pruebas de BD real pendientes

Los siguientes escenarios quedan NO VERIFICADOS hasta que Postgres este disponible:

- 7.2: POST happy path con fianza → estado=post_evento + COMUNICACION E5 estado=enviado + AUDIT_LOG
- 7.3: POST sin fianza (0 y NULL+cobrada) → sin COMUNICACION E5 + alerta dato anomalo en AUDIT_LOG
- 7.4: POST con proveedor fake en fallo → post_evento + COMUNICACION.estado=fallido
- 7.5: POST conflicto (estado distinto, segunda finalizacion) → 409, sin mutacion
- 7.6: RLS real (otro tenant → 404 con BD)

## Outcome

PARCIAL — verificacion HTTP sin BD: 6/6 casos PASSED via supertest. Pruebas curl contra BD real: NO EJECUTADAS. Hallazgo de discrepancia respuesta 200 vs contrato (nivel MEDIO). Bloqueante hasta disponibilidad de Postgres.
