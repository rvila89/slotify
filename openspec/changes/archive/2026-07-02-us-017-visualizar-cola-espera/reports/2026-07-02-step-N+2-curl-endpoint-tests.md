# Step N+2 — Pruebas de Endpoint con curl (2026-07-02)

## Módulo: US-017 Visualizar Cola de Espera

### Setup

- Backend: NestJS en `http://localhost:3000` (dev), BD: `slotify_dev`
- Auth: `POST /api/auth/login` con `info@masialencis.com / Slotify2026!`
- Tenant: `00000000-0000-0000-0000-000000000001` (Masia l'Encís)

### BD baseline (pre-curl tests) — slotify_dev

| tabla             | pre |
|-------------------|-----|
| reserva           | 0   |
| cliente           | 0   |
| fecha_bloqueada   | 0   |
| audit_log         | 0   |

Datos sembrados manualmente vía psql para las pruebas:
- `r...001` bloqueante 2b, `SLO-US017-B01`, fecha 2029-09-01, TTL +22h
- `r...002` cola pos1 `SLO-US017-Q01` (creada hace 2 h)
- `r...003` cola pos2 `SLO-US017-Q02` (creada hace 30 min)
- `fb...001` FECHA_BLOQUEADA 2029-09-01 → `r...001`
- `r...004` bloqueante 2b sin cola `SLO-US017-B02` (FA-01)
- `r...005` bloqueante 2c `SLO-US017-B03` + `r...006` cola (FA-02)
- `r...007` bloqueante 2v `SLO-US017-B04` con `visita_programada_fecha=2029-08-20` (FA-03)
- `r...008` reserva sin FECHA_BLOQUEADA `SLO-US017-D01` (FA-04)
- `r2...001` bloqueante otro tenant `00...0ff` (aislamiento)

### Comandos ejecutados y resultados

#### Happy Path — bloqueante 2b + 2 en cola

```
GET /api/reservas/r1000000-0000-0000-0000-000000000001/cola
Authorization: Bearer <token>
```

Respuesta `200 OK`:
```json
{
  "estaBloqueada": true,
  "bloqueante": {
    "idReserva": "r1000000-0000-0000-0000-000000000001",
    "codigo": "SLO-US017-B01",
    "clienteNombre": "Ana García Bloqueante 2b",
    "subEstado": "2b",
    "ttlExpiracion": "2026-07-03T13:29:48.895Z",
    "ttlRestante": "21 h",
    "visitaProgramadaFecha": null
  },
  "cola": [
    {
      "idReserva": "r1000000-0000-0000-0000-000000000002",
      "codigo": "SLO-US017-Q01",
      "clienteNombre": "Luis Pérez Cola1",
      "posicionCola": 1,
      "fechaCreacion": "2026-07-02T13:30:50.767Z",
      "tiempoEnCola": "2 h"
    },
    {
      "idReserva": "r1000000-0000-0000-0000-000000000003",
      "codigo": "SLO-US017-Q02",
      "clienteNombre": "Marta Ruiz Cola2",
      "posicionCola": 2,
      "fechaCreacion": "2026-07-02T15:00:51.297Z",
      "tiempoEnCola": "30 min"
    }
  ]
}
```
PASS: sección bloqueante presente, cola FIFO ASC por posicionCola, TTL derivado de instante, tiempoEnCola calculado.

#### FA-01 — Bloqueante sin cola

```
GET /api/reservas/r1000000-0000-0000-0000-000000000004/cola
```
Respuesta `200 OK`: `{ estaBloqueada: true, bloqueante: {...subEstado:"2b"...}, cola: [] }` PASS

#### FA-02 — Bloqueante en 2c

```
GET /api/reservas/r1000000-0000-0000-0000-000000000005/cola
```
Respuesta `200 OK`: `{ estaBloqueada: true, bloqueante: {...subEstado:"2c"...}, cola: [pos1] }` PASS

#### FA-03 — Bloqueante en 2v con visitaProgramadaFecha

```
GET /api/reservas/r1000000-0000-0000-0000-000000000007/cola
```
Respuesta `200 OK`:
```json
{
  "bloqueante": {
    "subEstado": "2v",
    "visitaProgramadaFecha": "2029-08-20",
    "ttlRestante": "21 h"
  },
  "cola": []
}
```
PASS: `visitaProgramadaFecha` presente como `YYYY-MM-DD`, subEstado `2v`.

#### FA-04 — Reserva sin FECHA_BLOQUEADA (fecha disponible)

```
GET /api/reservas/r1000000-0000-0000-0000-000000000008/cola
```
Respuesta `200 OK`:
```json
{ "estaBloqueada": false, "bloqueante": null, "cola": [] }
```
PASS: 200 (no 404), `estaBloqueada: false`, `bloqueante: null`, `cola: []`.

#### Error 404 — Reserva inexistente

```
GET /api/reservas/00000000-0000-0000-0000-999999999999/cola
```
Respuesta `404 Not Found`:
```json
{
  "statusCode": 404,
  "message": "La reserva no existe para el tenant",
  "error": "Not Found"
}
```
PASS

#### Error 401 — Sin token

```
GET /api/reservas/r1000000-0000-0000-0000-000000000001/cola
(sin Authorization header)
```
Respuesta `401 Unauthorized`:
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized"
}
```
PASS

#### Aislamiento multi-tenant — JWT tenant-1 accede a reserva de tenant-2

```
GET /api/reservas/r2000000-0000-0000-0000-000000000001/cola
Authorization: Bearer <token-tenant-1>
```
Respuesta `404 Not Found` (RLS hace invisible la reserva del otro tenant). PASS

### Verificación BD (lectura pura — sin mutación)

El endpoint `GET /reservas/{id}/cola` es lectura pura. Se verificó que:
- Ninguna reserva fue modificada durante los curl.
- No se crearon audit_log de acciones de negocio (solo login events del proceso de obtención de tokens).
- La BD queda en el mismo estado que antes de los curl (0 reservas propias de test tras limpieza).

| tabla           | pre | post-curl | restaurado |
|-----------------|-----|-----------|------------|
| reserva         | 8*  | 8*        | sí (limpieza al final) |
| cliente         | 8*  | 8*        | sí (limpieza al final) |
| fecha_bloqueada | 5*  | 5*        | sí (limpieza al final) |
| audit_log       | 0   | 8 (login) | n/a — solo login events |

*datos de prueba sembrados para los curl; eliminados al finalizar.

### Restauración

Todos los datos sembrados para las pruebas curl fueron eliminados vía psql al concluir:
- `DELETE FROM fecha_bloqueada WHERE id_bloqueo LIKE 'fb000000%'`
- `DELETE FROM reserva WHERE id_reserva LIKE 'r%000000%'`
- `DELETE FROM cliente WHERE id_cliente LIKE 'c%000000%'`

Estado final: 0 reservas, 0 clientes, 0 fechas bloqueadas propias de prueba.

### Outcome

**PASS**

Todos los escenarios cubiertos:
- Happy path (bloqueante 2b + cola FIFO) — PASS
- FA-01 cola vacía — PASS
- FA-02 bloqueante 2c — PASS
- FA-03 bloqueante 2v con visitaProgramadaFecha — PASS
- FA-04 fecha disponible (200 con estaBloqueada:false) — PASS
- 404 reserva inexistente — PASS
- 401 sin token — PASS
- Aislamiento multi-tenant (RLS → 404) — PASS
- Lectura pura verificada (sin mutación) — PASS
