# QA Report — Sección 6: unit tests + verificación de BD

**Change:** `presupuesto-datos-fiscales-cliente-inline` (US-014, incidencia #5, Parte B)
**Fecha:** 2026-07-13
**Ejecutado por:** sesión principal (Postgres real disponible; los subagentes QA no lo tienen — ver memoria `subagentes-sin-docker-postgres`)

## Entorno
- Postgres: contenedor `slotify-postgres` (postgres:15), *healthy*.
- Tests de integración: BD dedicada `slotify_test` (`.env.test`), aislada del dev (`slotify_dev`).

## 6.1 Baseline de BD
- Reserva objetivo para verificación manual: `976f45c4-dfd6-4d14-af0f-62e85adb66ac` (`sub_estado = 2b`).
- Cliente asociado — datos fiscales previos: **todos `null`** (`dniNif`, `direccion`, `codigoPostal`, `poblacion`, `provincia`).
- Los tests de integración siembran/limpian su propio dataset en `slotify_test` (no tocan dev).

## 6.2 Tests dirigidos del módulo cambiado

```
npx jest --runInBand --testPathPatterns=actualizar-datos-fiscales-cliente
Test Suites: 3 passed, 3 total
Tests:       22 passed, 22 total
```

Desglose:
- `actualizar-datos-fiscales-cliente.use-case.spec.ts` — tasks 3.1, 3.2, 3.3 (actualización parcial, no-borrado por omisión, reserva inexistente/otro-tenant → error). VERDE.
- `actualizar-datos-fiscales-cliente.controller.http.spec.ts` — task 3.4 (200 / 404 / 401 / 403 / 400). VERDE.
- `actualizar-datos-fiscales-cliente-integracion.spec.ts` — task 3.5, **SQL real contra Postgres**: persiste los 5 campos y **no muta** RESERVA ni `FECHA_BLOQUEADA`. 5/5 VERDE. Confirmado desde la sesión principal (lección US-049).

## 6.3 Suite requerida
- Los specs del módulo cambiado: 22/22 verde (arriba).
- Nota flaky conocida (ajena al change): `alta-consulta-con-fecha-concurrencia.spec.ts` puede fallar con deadlock `40P01` (US-004, deuda pre-existente documentada en memoria `us004-concurrency-test-flaky`). No relacionado con este change.

## 6.4 Estado posterior de BD / restauración
- Los tests de integración limpian su propio estado en `slotify_test`.
- El cliente de dev tocado en la QA con curl (sección 7) se restauró a su baseline (`null` en los 5 campos). Verificado vía `GET /reservas/{id}`.

## Veredicto sección 6
**OK** — 22 tests verde incluyendo integración SQL real; BD restaurada.
