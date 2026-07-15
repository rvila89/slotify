# Step N+2 — Pruebas de endpoint (curl en vivo + integración real de BD)

**Change:** documentos-enviar-factura-senal-e3 (épico #6, rebanada 6.4b — Bloque C)
**Date:** 2026-07-15
**Branch:** feature/documentos-enviar-factura-senal-e3
**Ejecutado desde:** sesión principal (Docker + Postgres reales)
**Outcome:** ✅ VERDE (con 1 hallazgo documentado)

---

## 0. Enfoque

El endpoint `POST /api/reservas/{id}/facturas/senal/enviar` se verificó por **dos vías
complementarias**:

1. **curl en vivo** contra la API arrancada (`pnpm dev`, prefijo global `/api`,
   Postgres `slotify_dev`) — para los caminos que NO requieren sembrar datos.
2. **Test de integración REAL de BD** (decisión acordada en el gate de QA, para NO
   escribir en la BD de desarrollo compartida): nuevo
   `apps/api/src/facturacion/__tests__/enviar-factura-senal-integracion.spec.ts`,
   que importa `FacturacionModule` con adaptadores Prisma reales contra la BD aislada
   `slotify_test` y verifica el estado de la BD tras el envío. Sustituye el curl del
   happy-path/idempotencia (que exigía sembrar una factura de señal en la BD dev).

Motivo: la BD `slotify_dev` no tenía ninguna factura de señal y la escritura directa a
esa BD compartida fue (correctamente) denegada; reproducir el flujo completo por API
(consulta→bloqueo fecha→confirmación) es impracticable para un check de QA. El test de
integración cubre exactamente los efectos de BD que el curl del happy-path validaría, y
queda como **test permanente** (lección [[us049-backend-untested-real-db]]: exigir
integración SQL real, no solo dobles).

---

## 1. curl en vivo (API real, `slotify_dev`)

| Caso | Comando | Resultado |
|------|---------|-----------|
| Ruta registrada | `GET /api/docs-json` → paths | `"/api/reservas/{id}/facturas/senal/enviar"` presente ✅ |
| 404 factura señal inexistente | `POST .../reservas/<inexistente>/facturas/senal/enviar` | **HTTP 404**, `codigo: "FACTURA_SENAL_NO_ENCONTRADA"`, mensaje "No hay factura de señal para la reserva", envelope con `path`/`timestamp` ✅ |
| 401 sin JWT | mismo POST sin `Authorization` | **HTTP 401** ✅ |

Respuesta 404 literal:

```json
{"statusCode":404,"message":"No hay factura de señal para la reserva",
 "error":"Not Found","codigo":"FACTURA_SENAL_NO_ENCONTRADA",
 "path":"/api/reservas/.../facturas/senal/enviar","timestamp":"..."}
```

El formato de error cuadra con el envelope estándar del contrato (`ErrorResponse` +
`codigo`).

## 2. Integración real de BD (`slotify_test`) — `enviar-factura-senal-integracion.spec.ts`

```
Test Suites: 1 passed  ·  Tests: 5 passed
```

| Escenario | Verificación de BD | Estado |
|-----------|--------------------|--------|
| **Happy path** | factura `borrador→enviada`, `fecha_emision` fijada, `numero_factura` conservado (`F-2028-0007`), `RESERVA.cond_part_enviadas_fecha` fijada, `cond_part_firmadas=false`, COMUNICACION E3 `enviado` creada, AUDIT_LOG `FACTURA` presente; resultado con `condPartEnviadasFecha` (Date) + `condPartAdjuntada` (boolean) | ✅ |
| **PDF de señal ausente** (`pdf_url=null`) | lanza `EmisionEnvioFallidoError` (→502); factura sigue `borrador`, `cond_part_enviadas_fecha` NULL, sin COMUNICACION E3 `enviado` (rollback total) | ✅ |
| **Idempotencia** (E3 `enviado` previa) | lanza `E3YaEnviadoError` (→409); exactamente 1 COMUNICACION E3 `enviado` (sin duplicar) | ✅ |
| **404 reserva inexistente** | lanza `FacturaSenalNoEncontradaError` | ✅ |
| **404 cross-tenant (RLS)** | comando con otro tenant → `FacturaSenalNoEncontradaError` (RLS oculta la reserva) | ✅ |

El transporte de email va en modo `FakeEmailAdapter` (test); la generación de condicions
va real (degrada a `null` sin tumbar el envío). `afterAll` limpió `slotify_test` (0
registros residuales verificado).

---

## 3. HALLAZGO (para code-review / gate final)

**"E3 `fallido` previa → permite reintento" NO es reproducible en 6.4b y colisiona con el
índice único parcial.**

- El spec-delta (`facturacion`) y `design.md §D-idempotencia` declaran que si existe una
  COMUNICACION E3 en `fallido` (envío anterior fallido), la acción **permite reintentar**.
- **Realidad**: el adaptador DIRECTO de E3 (`EnviarE3EmisionAdapter`, §D-ruta-email) solo
  persiste COMUNICACION E3 en `enviado` **tras** confirmar el envío, DENTRO de la tx; ante
  fallo hace **rollback total**, por lo que **nunca** deja una fila `fallido`. Un `fallido`
  (es_reenvio=false) solo lo produce el MOTOR `DespacharEmailService`, que este slice **no
  usa**.
- Además, el índice único **parcial** `(reserva_id, codigo_email) WHERE reserva_id IS NOT
  NULL AND es_reenvio=false` haría que un `crear` de reintento sobre una fila `fallido`
  preexistente **colisionara con P2002** (y, al reintentar el bucle de numeración 10 veces,
  acabara en 500).

**Impacto en 6.4b: NINGUNO** — el camino es inalcanzable por el flujo real de la rebanada
(comprobado en integración: intentar sembrar un `fallido` y reenviar reproduce el P2002).
La lógica de la guarda (permitir cuando solo hay `fallido`) queda cubierta por el spec
UNITARIO con dobles (§3.5), donde no existe el constraint.

**Recomendación (decisión de gate):** corregir el spec/design para marcar el escenario
"fallido→reintento" como **N/A para el diseño de adaptador directo** (este slice nunca
persiste `fallido`); si en el futuro un flujo por motor pudiera dejar un `fallido` E3,
endurecer `ComunicacionSenalEmisionPrismaRepository.crear` a un **upsert** sobre la clave
parcial (o marcar `es_reenvio=true`). NO se aplica cambio de código en 6.4b por ser un
camino no alcanzable; se documenta como deuda/decisión.

---

## 4. Restauración

- `slotify_test`: limpiado por `afterAll` del spec (0 residuales, verificado por conteo).
- `slotify_dev`: **sin cambios** (solo lecturas curl 404/401; no se sembró ni mutó nada).

**Veredicto del paso:** ✅ Endpoint verificado (routing, auth, mapeo de errores, efectos de
BD) por curl en vivo + integración real; 1 hallazgo no bloqueante documentado.
