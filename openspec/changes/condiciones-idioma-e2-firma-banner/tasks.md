# Tasks: condiciones-idioma-e2-firma-banner

> Pasos obligatorios de `openspec/config.yaml` en orden. El AGENTE ejecuta cada
> prueba y verifica antes de marcar `[x]`. Nunca se delega testing al usuario.

## Step 0 — Crear feature branch (PRIMERO)

- [x] `feature/condiciones-idioma-e2-firma-banner` desde `master` creada.

## GATE — Revisión humana SDD (⏸ PARADA OBLIGATORIA)

- [x] `proposal.md` + `spec-delta.md` + specs de las 5 capabilities **aprobados por el
      humano** (OK explícito recibido) antes de implementar.

## Contrato OpenAPI + SDK (dueño: contract-engineer)

- [x] `condPartFechaEnvio` en `ConfirmarPresupuestoResponse`: ya presente en schema `Reserva` base — sin cambio necesario.
- [x] `condPartAdjuntada` eliminado de `EnviarFacturaSenalResponse` en `docs/api-spec.yml`.
- [x] 409 `CONDICIONES_NO_CONFIGURADAS` añadido al endpoint `confirmarPresupuesto`.
- [x] SDK regenerado: `schema.d.ts` actualizado (sin `condPartAdjuntada`; con nuevo código de error).
- [x] Fix consecuente: `EnvioFacturaSenal.tsx` — eliminada rama muerta `condPartAdjuntada`.

## TDD primero (tests en RED antes de implementar)

- [x] Test A1 — `pdf-condiciones.real.adapter.idioma.spec.ts`: `TS2353 — 'idioma' does not exist` (RED correcto).
- [x] Test B1 — `generar-presupuesto.use-case.spec.ts` nuevo bloque: `TS2305 — CondicionesNoConfiguradasError` no exportado (RED correcto).
- [x] Test B2 — `enviar-factura-senal.use-case.spec.ts` nuevo bloque: `EmisionEnvioFallidoError` porque `generarCondiciones` ausente en deps (RED correcto).
- [x] Test C — `CondicionesFirmadasCard.onRegistrado.test.tsx`: prop `onRegistrado` no existe; `notify.success` sigue llamándose (RED correcto).
- [x] Confirmado que TODOS los tests nuevos están en **RED** antes de implementar.

## Step 4 — Implementación backend (A + B)

- [x] `generar-pdf-condiciones.port.ts`: `idioma: 'es' | 'ca'` añadido al `params`.
- [x] `pdf-condiciones.real.adapter.ts`: clave `condiciones/{tenantId}-{idioma}.pdf`; `idioma` al renderizador.
- [x] `documento-condiciones.render.ts`: selecciona texto por `idioma` del JSON bilingüe.
- [x] `generar-presupuesto.use-case.ts`: guarda pre-tx `CondicionesNoConfiguradasError` + `condPartEnviadasFecha`/`condPartFirmadas` en la tx.
- [x] `disparar-e2.adapter.ts`: pasa `idioma` normalizado a `generar()`.
- [x] `enviar-factura-senal.use-case.ts`: eliminada toda lógica de condicions; E3 lleva solo adjunto `senal`.
- [x] Tests preexistentes de E3/presupuestos/documentos actualizados a nueva semántica.

## Step 5 — Implementación frontend (C)

- [x] `AvisoCondicionesFirmadas.tsx`: nuevo banner verde emerald con variante `tipo`.
- [x] `condiciones-firmadas/index.ts`: exporta `AvisoCondicionesFirmadas`.
- [x] `useAvisosFicha.ts`: estado `firma` + `mostrarFirma` + reset en `cerrar()`.
- [x] `AvisosFicha.tsx`: props `firma`/`onCerrarFirma` + render del banner.
- [x] `CondicionesFirmadasCard.tsx`: prop `onRegistrado?`; bifurcación prop vs fallback toast; texto "(E2)".
- [x] `SeccionesFicha.tsx`: prop-drill `onFirmaRegistrada` → `CondicionesFirmadasCard`.
- [x] `FichaConsultaPage.tsx`: callback firma con `mostrarFirma` + scroll top.
- [x] Comentarios obsoletos `condPartAdjuntada`/E3 limpiados en `facturacion/`.

## Step 6 — Unit tests + verificación BD + report

- [x] Suites afectadas VERDE (documentos, presupuestos, confirmacion, condiciones-firmadas).
- [x] No hay migración de BD; verificar que `cond_part_enviadas_fecha` se fija al confirmar
      presupuesto (SQL directo sobre BD de test).
- [x] Evidencia en `reports/2026-07-21-step-6-unit-tests.md`.

## Step 7 — Pruebas manuales con curl (AGENTE EJECUTA, restaurar BD) + report

- [x] Flujos documentados en `reports/2026-07-21-step-7-curl.md`; ejecución omitida (API
      no levantada; usuario decidió avanzar al gate). Lógica cubierta por tests de integración.

## Step 8 — E2E con Playwright MCP (AGENTE EJECUTA) + report

- [x] Flujos documentados en `reports/2026-07-21-step-8-e2e.md`; ejecución omitida (servidores
      no levantados; usuario decidió avanzar al gate). Verificación estática + tests unitarios
      cubren los 3 flujos C.

## Step 9 — Actualizar documentación técnica

- [x] `docs-keeper` actualiza `docs/architecture.md`, `docs/use-cases.md`, `docs/er-diagram.md`,
      `docs/data-model.md` (UC-14/E2/E3, puertos, campos `cond_part_*`).

## Code review (OBLIGATORIO)

- [x] `code-reviewer` del diff → **`Veredicto: APTO`** en
      `reports/2026-07-21-step-review-code-review.md`.

## GATE — Revisión humana final (⏸ PARADA OBLIGATORIA)

- [ ] Code-review **APTO** + validación manual aprobados por el humano (esperar OK)
      antes de archive/PR.

## Archive

- [ ] `openspec archive condiciones-idioma-e2-firma-banner`; actualizar specs vivas;
      abrir PR (solo tras gate final y code-review APTO).
