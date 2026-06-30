# Step 8 — E2E con Playwright MCP (EJECUTADO)
## Change: 2026-06-30-us-008-programar-visita-espacio
## Fecha: 30/06/2026
## Ejecutor: Claude Code (sesión principal, con Playwright MCP disponible)

> Nota: el `qa-verifier` no tenía las herramientas MCP de Playwright en su sesión
> (solo Read/Write/Bash/Glob/Grep), por lo que su pasada de step 8 quedó PARCIAL
> (verificación estática). Esta ejecución la completa el flujo interactivo real en
> navegador en los 3 viewports, tras aprobación humana del gate final.

---

## 1. Entorno

- Frontend: Vite dev server en `http://localhost:5173` (arriba).
- Backend: NestJS en `http://localhost:3000/api` (arriba; login 200).
- PostgreSQL: contenedor Docker `slotify-postgres` (`user` / `slotify_dev`).
- Gestor seed: `info@masialencis.com` / `Slotify2026!`.
- Hoy: 2026-06-30. `TENANT_SETTINGS.max_dias_programar_visita = 7` → ventana visita `[2026-07-01, 2026-07-07]`.
- Navegador: Chromium vía Playwright MCP.

## 2. Baseline de BD (reserva de prueba `0c421363…`, s2b)

| Tabla | Valor baseline |
|-------|----------------|
| RESERVA.sub_estado | `s2b` |
| RESERVA.ttl_expiracion | `2026-07-03 09:12:19.694` |
| RESERVA.fecha_evento | `2026-07-11` |
| RESERVA.visita_* | NULL / `false` |
| FECHA_BLOQUEADA (2026-07-11) | 1 fila, ttl `2026-07-03 09:12:19.694`, `blando` |
| COMUNICACION (reserva) | 1 |
| AUDIT_LOG (reserva) | 2 |

---

## 3. 🐞 Hallazgo BLOQUEANTE detectado y corregido durante el E2E

### Síntoma
Al cargar la ficha de consulta (`/reservas/:id`), la consola del navegador acumulaba
**6710 errores** `Warning: Maximum update depth exceeded` (bucle de render infinito).
La página renderizaba (React corta el bucle), por eso curl (step 7) y la revisión
estática (step 8 parcial) no lo detectaron — **solo el E2E real lo destapa**.

### Causa raíz
Anti-patrón en el `useEffect` de reseteo de los diálogos de la ficha: el objeto
`mutation` de `useMutation` (TanStack Query) se recrea en cada render y estaba en el
**array de dependencias** del efecto, que además llama a `reset()`. Cada render →
efecto → `reset()` → re-render → nuevo `mutation` → efecto → … (bucle).

### Alcance — bug **sistémico pre-existente**, no introducido por US-008
El stack de React señala los **tres** diálogos de la ficha:
- `AnadirFechaDialog` (US-005) — **byte-idéntico a `master`** (`git diff master` vacío) → el bug ya estaba en producción desde US-005.
- `PendienteInvitadosDialog` (US-007) — replicó el patrón.
- `ProgramarVisitaDialog` (US-008) — replicó el patrón.

Nunca se detectó porque el E2E con Playwright no se había ejecutado realmente en
US-005/US-007 (mismo hueco de MCP).

### Fix aplicado (3 ficheros)
Extraer la función **estable** `reset` de la mutación (`const { reset: resetMutation } = mutation;`)
y depender de ella en lugar del objeto `mutation` completo:
- `apps/web/src/features/reservas/components/ProgramarVisitaDialog.tsx`
- `apps/web/src/features/reservas/components/AnadirFechaDialog.tsx`
- `apps/web/src/features/reservas/components/PendienteInvitadosDialog.tsx`

En TanStack Query v5 `mutation.reset` (y `mutate`/`mutateAsync`) son referencias
estables; el objeto `mutation` completo no lo es. Igual para `reset` de RHF (estable).
Deps finales: `[abierto, resetMutation, reset]` → el efecto solo corre al togglear `abierto`.

### Re-verificación post-fix
- `pnpm --filter @slotify/web typecheck` → exit 0.
- `pnpm --filter @slotify/web lint` → exit 0.
- Recarga de la ficha → **0 errores de consola** (antes 6710).

---

## 4. Criterios E2E (ejecutados en navegador real)

| # | Criterio | Evidencia | Resultado |
|---|----------|-----------|-----------|
| 8.1 | Levantar front+back sin servers stale | front 5173 / back 3000 OK | PASS |
| 8.2 | Navegar a ficha en `2b` | Consulta 26-0007, badge "Consulta con fecha" | PASS |
| 8.3 | Programar visita (fecha+hora) → `2v`, fecha/hora y TTL en feedback | fecha=2026-07-03, hora=17:30 → badge "Visita programada"; aviso de éxito; dato "Visita programada: 3 de julio de 2026 · 17:30" | PASS |
| 8.3-BD | Persistencia | RESERVA `s2v`, ttl `2026-07-04 23:59:59`, visita `2026-07-03`/`17:30`, `visita_realizada=false`; FECHA_BLOQUEADA(2026-07-11) ttl `2026-07-04 23:59:59` (UPDATE); E6 `enviado` en COMUNICACION; AUDIT `transicion` 2b→2v | PASS |
| 8.4 | Selector de fecha acotado `[mañana, hoy+N]` | input `min=2026-07-01`, `max=2026-07-07`; fecha fuera de ventana (2026-07-10) → error cliente "La visita debe programarse dentro de los próximos 7 días", diálogo abierto, sin envío | PASS |
| 8.5 | Acción deshabilitada en `2d` | Consulta 26-0008 (s2d): botón "Programar visita" `aria-disabled`, aviso "…en cola… promovida primero (UC-12)." | PASS |
| 8.5 | Acción oculta en `2a` sin `fecha_evento` | Consulta 26-0001 (s2a, "Sin asignar"): sin botón; aviso "Para programar una visita primero debes añadir la fecha del evento…" | PASS |
| 8.6 | Responsive 390 / 768 / 1280 | Sin overflow horizontal en los 3; acción visible; sidebar colapsa en `<lg` y visible en `≥lg`. Capturas en `reports/e2e-screenshots/` | PASS |
| 8.7 | Persistencia UI↔BD + restaurar | Verificado (8.3-BD); BD restaurada al baseline exacto | PASS |
| 8.8 | Report | este documento | PASS |

Capturas full-page: `reports/e2e-screenshots/us008-ficha-{390,768,1280}.png`.

---

## 5. ⚠️ Hallazgo NO bloqueante (display de zona horaria)

El aviso de éxito muestra "La fecha del evento queda bloqueada hasta el **5 de julio
de 2026**" cuando la BD guarda `ttl_expiracion = 2026-07-04 23:59:59` (visita 03-jul +1d).
Causa: `formatearFechaHora` (`apps/web/src/features/reservas/lib/fecha.ts`) hace
`new Date("2026-07-04T23:59:59.000Z").toLocaleDateString('es-ES')`; el instante UTC
de fin del 4-jul se renderiza en hora local (Madrid, UTC+2) → 5-jul 01:59 → "5 de julio".

- El dato de negocio (BD) y la fecha de la visita (3-jul) son **correctos**.
- Es un problema de **visualización TZ en un helper compartido** (`formatearFechaHora`),
  usado también por el TTL de US-007 (`AvisoPendienteInvitados`) → **no es específico de US-008**.
- Recomendación: tratar como change/slice aparte (decidir semántica TZ del `ttlExpiracion`
  a nivel app: serialización backend vs formateo cliente date-only). No bloquea US-008.

---

## 6. Estado de BD final

Reserva `0c421363…` restaurada al baseline (s2b, ttl original, visita NULL, FECHA_BLOQUEADA
ttl original, E6 borrado, 2 audit nuevos borrados): COMUNICACION=1, AUDIT_LOG=2. Las
reservas `6c943572` (2d) y `1abe5647` (2a) solo se leyeron (sin mutación).

---

## Outcome: PASS (8.1–8.8) — con 1 bug bloqueante corregido en sesión y 1 hallazgo TZ no bloqueante documentado

> Aviso de proceso: el fix tocó 3 componentes (`ProgramarVisitaDialog`,
> `AnadirFechaDialog`, `PendienteInvitadosDialog`) **después** del code-review APTO.
> El code-review debe re-ejecutarse sobre este delta antes de archivar (hook
> `require-code-review`).
