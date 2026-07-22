# Step 8 — Curl Endpoint Tests
**Change:** reserva-viva-edicion-recalculo-ficha
**Date:** 2026-07-22
**Agent:** qa-verifier
**Outcome:** PARTIAL PASS — funcionalidad de recálculo en BD correcta; CONTRATO NO HONRADO en la respuesta HTTP

---

## 8.1 Setup del backend

```
# Entorno
DATABASE_URL=postgresql://user:password@localhost:5432/slotify_dev
API_PORT=3002
EMAIL_SANDBOX=true
WEB_URL=http://localhost:5174

# Migración aplicada
npx prisma migrate deploy → Applied 20260722120000_recalculo_reserva_viva

# Servidor
cd apps/api && node dist/src/main.js
```

Login: `POST /api/auth/login` con `{"email":"info@masialencis.com","password":"Slotify2026!"}`
Tenant piloto: `00000000-0000-0000-0000-000000000001`

Nota: Access tokens caducan en 5 minutos; se obtenía un token fresco antes de cada batería de curls.

---

## 8.2 GET /reservas/{id}/ficha-operativa — pre-relleno y campos estructurados

**Reserva usada:** `1a5f9011-9aca-45a2-89c2-bf7049c9bb36` (codigo=26-0001, estado=reserva_confirmada, preEventoStatus=pendiente)

```bash
curl -s "http://localhost:3002/api/reservas/1a5f9011-9aca-45a2-89c2-bf7049c9bb36/ficha-operativa" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta 200:**
```json
{
  "idFicha": "d149bd00-0381-4b6b-99db-c84ae620226f",
  "reservaId": "1a5f9011-9aca-45a2-89c2-bf7049c9bb36",
  "numInvitadosConfirmado": 30,
  "duracionHoras": "8",
  "numAdultosNinosMayores4": 30,
  "numNinosMenores4": null,
  "contactoEventoNombre": "Roger Vilà Mateo",
  "contactoEventoTelefono": "+34620761051",
  "contactoEventoCorreo": "roger.vila.mateo@gmail.com",
  "horaLlegada": "11:00",
  "duracion": "8h",
  "notasOperativas": null,
  "briefingEquipo": null,
  "fichaCerrada": false,
  "fechaCierre": null,
  "preEventoStatus": "pendiente"
}
```

Verificaciones:
- `duracionHoras: "8"` — pre-relleno desde RESERVA.duracionHoras PASS
- `numAdultosNinosMayores4: 30` — pre-relleno desde RESERVA PASS
- `numNinosMenores4: null` — la RESERVA no tiene valor (null) PASS
- `numInvitadosConfirmado: 30` — derivado (read-only), `derivarNumPersonas(30, null)` = 30 PASS

**RESULTADO: PASS**

---

## 8.3 PATCH dentro de la ventana viva — recálculo en cascada

**Baseline RESERVA:** `importe_total=902`, `importe_senal=360.8`, `importe_liquidacion=541.2`

```bash
curl -s -X PATCH "http://localhost:3002/api/reservas/1a5f9011-9aca-45a2-89c2-bf7049c9bb36/ficha-operativa" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"precioManualEur": "5000"}'
```

**Respuesta HTTP 200** (ficha actualizada, `preEventoStatus` transitó a `en_curso`):
```json
{
  "idFicha": "d149bd00-...",
  "reservaId": "1a5f9011-...",
  "preEventoStatus": "en_curso",
  ...
  (sin campo `recalculo` — ver HALLAZGO #1 abajo)
}
```

**BD verificada post-PATCH:**
- `RESERVA.importe_senal = 360.8` — INVARIANTE DURA: sin cambio PASS
- `RESERVA.importe_total = 5000` — actualizado por recálculo PASS
- `RESERVA.importe_liquidacion = 4639.2` (= 5000 - 360.8) PASS
- `PRESUPUESTO v2` creado: `total=5000`, `origen='modificacion'`, `estado=borrador` PASS

**HALLAZGO #1 (BUG / CONTRACT MISMATCH):**
La respuesta del PATCH NO incluye el campo `recalculo` (`nuevoTotal`, `pagoInicial`, `liquidacionRestante`, `tarifaAConsultar`) que especifica el contrato (`GuardarFichaOperativaResponse` en `docs/api-spec.yml`). El SDK del frontend espera `recalculo` en la respuesta (`useGuardarFicha.ts` línea 49: `const { recalculo, ...ficha } = respuesta`).

Causa raíz: `guardar-ficha-operativa.use-case.ts` llama `await this.recalcularSiProcede(comando)` que devuelve `Promise<void>` (descarta el resultado de `RecalcularReservaVivaUseCase.ejecutar`). El controlador devuelve `FichaOperativaResponseDto` en lugar de `GuardarFichaOperativaResponseDto` con `recalculo` incluido.

El frontend `AvisoRecalculo.tsx` y `BloquePrecioManual.tsx` dependen del campo `recalculo` para mostrar el nuevo total y el aviso de precio. Sin este campo, los componentes no recibirán datos.

**Archivos afectados:**
- `apps/api/src/ficha-evento/application/guardar-ficha-operativa.use-case.ts` — `recalcularSiProcede` debe retornar `RecalcularReservaVivaResultado | undefined` y el use-case debe retornar `FichaOperativa & { recalculo }`
- `apps/api/src/ficha-evento/interface/ficha-operativa.controller.ts` — `guardarFicha` debe devolver `GuardarFichaOperativaResponseDto`

**Restauración BD:**
```
Presupuesto v2 eliminado.
RESERVA restaurada: importe_total=902, importe_senal=360.8, importe_liquidacion=541.2, preEventoStatus=pendiente
FACTURA liquidacion restaurada: total=541.2
```

**RESULTADO: FAIL (contrato no honrado)**

---

## 8.4 PATCH fuera de la ventana viva — 422

**Reserva modificada:** `9a6a92c0-659d-4460-aa04-fd933554fcc7` (preEventoStatus forzado a `cerrado` vía SQL para simular ventana cerrada)

```bash
curl -s -X PATCH "http://localhost:3002/api/reservas/9a6a92c0-.../ficha-operativa" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"numAdultosNinosMayores4": 60, "numNinosMenores4": 5}'
```

**Respuesta 422:**
```json
{
  "statusCode": 422,
  "message": "La reserva no admite recálculo de aforo/duración fuera de la ventana viva",
  "error": "Unprocessable Entity",
  "code": "fuera_de_ventana_viva"
}
```

**Restauración BD:** `preEventoStatus` restaurado a `pendiente`.

**RESULTADO: PASS**

---

## 8.5 Caso >50 invitados — tarifaAConsultar

### 8.5a Sin precioManualEur → 422 precio_manual_requerido

```bash
curl -s -X PATCH "http://localhost:3002/api/reservas/1a5f9011-.../ficha-operativa" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"numAdultosNinosMayores4": 55, "numNinosMenores4": 5}'
```

**Respuesta 422:**
```json
{
  "statusCode": 422,
  "message": "Se requiere un precio manual para recalcular (tarifa a consultar, >50 invitados)",
  "error": "Unprocessable Entity",
  "code": "precio_manual_requerido"
}
```

**RESULTADO: PASS**

### 8.5b Con precioManualEur → 200 (pero sin `recalculo` en respuesta)

```bash
curl -s -X PATCH "http://localhost:3002/api/reservas/1a5f9011-.../ficha-operativa" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"numAdultosNinosMayores4": 55, "numNinosMenores4": 5, "precioManualEur": "7000"}'
```

**Respuesta 200** — sin `recalculo` (mismo HALLAZGO #1).

**BD verificada:**
- `RESERVA.importe_senal = 360.8` — INVARIANTE DURA: sin cambio PASS
- `RESERVA.importe_total = 7000` PASS
- `RESERVA.numAdultosNinosMayores4 = 55`, `numNinosMenores4 = 5` PASS
- `PRESUPUESTO v2`: `total=7000`, `origen='modificacion'` PASS

**Restauración BD:**
```
Presupuesto v2 eliminado.
RESERVA restaurada: importe_total=902, importe_senal=360.8, importe_liquidacion=541.2, numAdultosNinosMayores4=30, numNinosMenores4=null, preEventoStatus=pendiente
FACTURA liquidacion restaurada: total=541.2
```

**RESULTADO: BD correcta, respuesta HTTP no honra contrato (HALLAZGO #1)**

---

## Resumen de resultados

| Caso | HTTP | BD | Resultado |
|---|---|---|---|
| 8.2 GET pre-relleno | 200 correcto | N/A | PASS |
| 8.3 PATCH recálculo viva | 200 (sin `recalculo`) | correcta | FAIL (contrato) |
| 8.4 PATCH fuera ventana | 422 `fuera_de_ventana_viva` | sin mutar | PASS |
| 8.5a >50 sin precio | 422 `precio_manual_requerido` | sin mutar | PASS |
| 8.5b >50 con precio | 200 (sin `recalculo`) | correcta | FAIL (contrato) |

---

## HALLAZGO #1 — BUG: campo `recalculo` ausente en respuesta PATCH

**Severidad:** Alta — el frontend no puede mostrar el aviso de recálculo (nuevo total / restante)

**Descripción:** El contrato `docs/api-spec.yml` define `GuardarFichaOperativaResponse` como `FichaOperativa & { recalculo?: RecalculoResultado | null }`. El backend devuelve solo `FichaOperativa`, descartando el resultado del `RecalcularReservaVivaUseCase`.

**Impacto en E2E:** el flujo de Fase 9 no podrá verificar el aviso de recálculo en la UI si no se corrige antes.

**Fix necesario (no ejecutado por QA — rol de backend-developer):**
1. `guardar-ficha-operativa.use-case.ts`: `recalcularSiProcede` debe retornar `RecalcularReservaVivaResultado | undefined`; `ejecutar` debe retornar `FichaOperativa & { recalculo?: RecalcularReservaVivaResultado }`.
2. `ficha-operativa.controller.ts`: `guardarFicha` debe devolver `GuardarFichaOperativaResponseDto` (extiende `FichaOperativaResponseDto` con `recalculo?`).
3. `ficha-operativa.dto.ts`: añadir `GuardarFichaOperativaResponseDto extends FichaOperativaResponseDto` con campo `recalculo`.

---

**Outcome: PARTIAL PASS** — recálculo en BD correcto, invariante señal preservada, 422s correctos. Campo `recalculo` ausente en HTTP response es BUG que impide el flujo E2E completo.
