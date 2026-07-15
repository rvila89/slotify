# Step N+1 — Unit tests + verificación de BD (US-024)

- Fecha: 15/07/2026
- Change: `firma-condiciones-particulares-us024`
- Ejecutado por: **sesión principal** (con Docker `slotify-postgres` en 5432; los subagentes QA corren sin Postgres).

---

## 5.1 Baseline de BD

Entidades impactadas: `RESERVA` (`cond_part_firmadas`, `cond_part_firmadas_fecha`), `DOCUMENTO`
(`tipo='condiciones_particulares'`), `AUDIT_LOG` (`accion='actualizar'`).

Los tests de integración usan la BD aislada `slotify_test` (`.env.test`), con siembra/limpieza por
patrón de email (`@us024-int.test`) y fechas futuras propias (2028-05-xx), sin tocar `slotify_dev`.

## 5.2 Tests dirigidos del change

```
pnpm jest src/confirmacion/__tests__/registrar-firma-condiciones.use-case.spec.ts \
          src/reservas/__tests__/maquina-estados-firma-condiciones.spec.ts
→ Test Suites: 2 passed, Tests: 43 passed
```

**Integración con BD REAL** (añadida por la sesión principal; los subagentes no tienen Postgres):

```
pnpm jest src/confirmacion/__tests__/registrar-firma-condiciones-integracion.spec.ts --runInBand
→ Test Suites: 1 passed, Tests: 7 passed
```

Cobertura de la integración real (verificada por estado de BD):
- Happy path: crea `DOCUMENTO condiciones_particulares`, marca `cond_part_firmadas=true` +
  `cond_part_firmadas_fecha`, `AUDIT_LOG accion='actualizar'` (datos_anteriores false / nuevos true),
  y el estado NO transiciona (sin `AUDIT_LOG accion='transicion'`).
- El `DOCUMENTO` original NO firmado de US-023 permanece (conviven 2 filas del mismo tipo).
- Re-firma no idempotente: 2 versiones firmadas, fecha actualizada, flag se mantiene `true`,
  auditoría de la 2ª con `datos_anteriores.condPartFirmadas=true`.
- Guarda `CONDICIONES_NO_ENVIADAS` (→ 409) con `cond_part_enviadas_fecha` nulo: rechazo sin efectos.
- Guarda `ESTADO_INVALIDO` (→ 422) en estado terminal (`reserva_completada`): rechazo sin efectos.
- Estados válidos `evento_en_curso` y `post_evento`: aceptados.
- RLS cross-tenant: `RESERVA_NO_ENCONTRADA` (→ 404), sin mutación sobre la reserva del tenant dueño.

> Este test de integración cubre los mismos vectores que las pruebas curl (Fase 6) contra BD real,
> validando la unidad de trabajo transaccional (atomicidad) y la RLS efectiva — el riesgo que los
> unit con puertos mockeados no pueden cubrir.

## 5.3 Suite de los módulos cambiados

```
pnpm jest src/confirmacion src/reservas --runInBand
→ Test Suites: 108 passed, 108 total
→ Tests: 1125 passed, 1125 total   (153 s)
```

Sin regresiones en los módulos afectados. No se ejecuta el `pnpm test` global completo por flakiness
pre-existente ajena a este change (suites ESM de react-pdf al agruparse, y el deadlock intermitente de
concurrencia de US-004); ambos están documentados como deuda previa y no tocan el código de US-024.

## 5.4 Estado posterior de BD

`slotify_test`: limpiada por el teardown (`afterAll`/`beforeEach`) de la suite de integración.
`slotify_dev`: no mutada (los tests corren contra `slotify_test`).

## Resultado

**Step N+1: COMPLETADO.** Unit dirigidos (43) + integración real (7) + módulos afectados (1125) en
verde. Sin bloqueantes. La atomicidad de la UoW y la RLS quedan verificadas contra Postgres real.
