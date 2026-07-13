# QA Report — Sección 7: pruebas manuales con curl

**Change:** `presupuesto-datos-fiscales-cliente-inline` (US-014, incidencia #5, Parte B)
**Fecha:** 2026-07-13
**Ejecutado por:** sesión principal (BD real + dev servers levantados)
**Endpoint:** `PATCH /api/reservas/{id}/datos-fiscales` (operationId `actualizarDatosFiscalesCliente`)

## 7.1 Entorno
- API dev en `http://localhost:3000` (prefijo global `/api`), BD `slotify_dev` sembrada.
- Autenticación: login gestor `info@masialencis.com` → `POST /api/auth/login` → `accessToken` (JWT, rol `gestor`).
- Reserva de prueba: `976f45c4-dfd6-4d14-af0f-62e85adb66ac` (`sub_estado = 2b`); cliente con los 5 campos fiscales a `null` (baseline).

## 7.2 Happy path (200) — los 5 campos
Body: `{"dniNif":"12345678Z","direccion":"C/ Mayor 1","codigoPostal":"08001","poblacion":"Barcelona","provincia":"Barcelona"}`
- **HTTP 200**. Response devuelve los 5 campos con los valores persistidos.
- `GET /reservas/{id}` posterior: cliente con los 5 campos guardados; **`sub_estado` sigue `2b`** (reserva intacta).

## 7.3 PATCH parcial — no borra por omisión (D-2)
Body: `{"poblacion":"Girona"}` (solo un campo)
- **HTTP 200**. Resultado: `poblacion` pasa a `Girona`; `dniNif`/`direccion`/`codigoPostal`/`provincia` **conservan** sus valores previos. Confirmada la semántica PATCH parcial sin borrado por omisión.

## 7.4 Casos de error
| Caso | Petición | Esperado | Obtenido |
|------|----------|----------|----------|
| 7.4a Body vacío (`minProperties:1`) | `{}` | 400 | **400** ✓ |
| 7.4b Propiedad ajena (`additionalProperties:false`, p. ej. `fechaEvento` de RESERVA) | `{"fechaEvento":"2026-09-01"}` | 400 | **400** ✓ |
| 7.4c Campo vacío (`minLength:1`) | `{"dniNif":""}` | 400 | **400** ✓ |
| 7.4d Sin token | (sin `Authorization`) | 401 | **401** ✓ |
| 7.4e Reserva inexistente | id `...00ff` | 404 | **404** ✓ |
| 403 sin rol gestor | — | 403 | Cubierto por test HTTP automatizado 3.4 (no hay usuario no-gestor en el seed dev para curl) |

El formato de error coincide con el contrato (`ErrorResponse`: `statusCode`/`message`/`error`).

## 7.5 No mutación de RESERVA ni FECHA_BLOQUEADA
- Tras los PATCH, `sub_estado` de la reserva permanece `2b` (verificado vía API).
- No mutación de `FECHA_BLOQUEADA` verificada adicionalmente por el test de integración SQL real (sección 6, task 3.5).

## Restauración
- El cliente de dev se restauró a su baseline: los 5 campos a `null` (el PATCH parcial no puede escribir `null` por `minLength:1`; restauración vía `UPDATE` directo sobre `slotify_dev`, `UPDATE 1`). Verificado vía `GET /reservas/{id}` → los 5 campos `null`.

## Veredicto sección 7
**OK** — happy, parcial (D-2) y toda la matriz de errores conformes al contrato; reserva no mutada; BD restaurada.
