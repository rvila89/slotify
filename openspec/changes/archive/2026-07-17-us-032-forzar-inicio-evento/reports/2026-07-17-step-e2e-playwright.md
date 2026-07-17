# Step E2E (Playwright) — Forzar inicio del evento  (2026-07-17)

App real (`pnpm dev`, web `http://localhost:5173`, api `:3000`) contra BD de desarrollo.
Login gestor `info@masialencis.com`. Navegación **in-app** (no `goto` directo, para no perder
el JWT en memoria — gotcha conocido). Escenario: reserva `reserva_confirmada` + `fecha_evento
= hoy` + `liquidacion_status = facturada`.

## Flujo ejercitado (viewport 1280 — escritorio)
1. Login → dashboard. La reserva aparece en "Subprocesos críticos" y "Hoy y mañana".
2. Ficha de la reserva: sección **Acciones** muestra el aviso "Hoy es el día del evento… en
   **reserva confirmada**", "Hay 1 precondición(es) sin cumplir" y el botón **"Forzar inicio
   del evento"** (visible por `estado=reserva_confirmada` + `fecha=hoy`).
   → captura `e2e-us032-01-desktop-1280-ficha.png`
3. Clic en el botón → **paso 1** del diálogo: "Forzar inicio del evento", lista
   "Precondiciones incumplidas: Cobro de la liquidación", botones Cancelar / Continuar.
   → captura `e2e-us032-02-desktop-1280-dialogo-paso1.png`
4. Continuar → **paso 2** (doble confirmación): "Confirmar forzado del inicio", aviso de
   **override** + "Confirma que asumes el riesgo…", botones Atrás / Forzar inicio del evento.
   → captura `e2e-us032-03-desktop-1280-dialogo-paso2.png`
5. Confirmar → **200**: aviso de éxito "Inicio de evento forzado. La reserva ha pasado a
   **evento en curso**." + "Quedaron precondiciones sin resolver: Cobro de la liquidación".
   La sección Acciones pasa a ofrecer "Marcar evento como finalizado" (US-034). El botón de
   forzado desaparece. → captura `e2e-us032-04-desktop-1280-exito.png`
6. **Cancelación = no-op**: en una reserva nueva `reserva_confirmada`, abrir diálogo y
   Cancelar en paso 1 → la reserva permanece `reserva_confirmada` (verificado en BD:
   `fresh_estado=reserva_confirmada`), sin transición ni audit log.

## Persistencia
Tras el forzado, la BD refleja `estado=evento_en_curso` y una entrada `AUDIT_LOG` de
transición con `forzado_por_gestor:true` (ver report curl). El refetch de TanStack Query deja
la ficha en `evento_en_curso` sin recargar la página.

## Verificación responsive (390 / 768 / 1280)
| viewport | US-032 (botón + diálogo + acción) | overflow horizontal | resultado |
|----------|-----------------------------------|---------------------|-----------|
| **390 (móvil)** | Botón visible; nav colapsa a **drawer + hamburguesa** ("Abrir navegación"); diálogo cabe en viewport (ancho 358 / vw 390, `fitsViewport:true`) | El contenido de US-032 (región Acciones + diálogo) **NO desborda**. Sí hay desborde de la **cabecera del app-shell** ("0 reservas hoy" + "Nueva Reserva"): **pre-existente, ajeno a US-032** | PASS (US-032) · ⚠ deuda shell |
| **768 (tablet)** | Botón visible; diálogo usable | Desborde de **~15px** en la cabecera del shell ("0 reservas hoy" + "Nueva Reserva") — **exactamente la deuda pre-existente documentada** (`appshell-overflow-768-deuda`); US-032 no lo introduce | PASS (US-032) · ⚠ deuda shell |
| **1280 (escritorio)** | Flujo completo happy path ejecutado (pasos 1–5) | Sin desborde | PASS |

**Nota sobre el desborde**: los elementos que desbordan en 390/768 son SIEMPRE de la cabecera
compartida del app-shell (`0 reservas hoy`, botón `Nueva Reserva`, notificaciones), nunca
componentes de US-032 (`AccionForzarInicio`, `ForzarInicioEventoDialog`, `AvisoEventoForzado`,
que miden ≤ viewport). Es la deuda técnica pre-existente del shell (memoria
`appshell-overflow-768-deuda`), a resolver en un change propio de layout — fuera del alcance de
US-032.

## Restauración
Fixtures (reserva "hoy" y "mañana") borrados con `--teardown`. BD de desarrollo sin residuos.
Capturas en `reports/e2e-screenshots/`.

## Outcome
PASS (US-032). El flujo de forzado —visibilidad condicional del botón, doble confirmación,
transición a `evento_en_curso`, aviso de precondiciones sin resolver y cancelación no-op— es
correcto y responsive en los 3 viewports. Única salvedad: deuda de overflow de la cabecera del
app-shell, pre-existente y ajena a esta US.
