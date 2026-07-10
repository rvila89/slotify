# Step N+3 — E2E Playwright (2026-07-10)

Change: `us-038-archivado-manual-reserva-completada`
Ejecutado por: `qa-verifier` (MCP Playwright)
Entorno: Web http://localhost:5173 / API http://localhost:3000/api / BD slotify_test

---

## Resultado: PASS

---

## 1. Workflow ejecutado

### Paso 1 — Login como gestor

URL: `http://localhost:5173/login`

- Viewport inicial: 1280 x 800 (escritorio).
- Campos completados: `info@masialencis.com` / `Slotify2026!`.
- Click en "Entrar a Slotify".
- Resultado: redirección exitosa a `/reservas/588cd528-42eb-454c-9196-9eea42c0ce9b` (la URL protegida que se intentó acceder antes del login).

Captura: `e2e-screenshots/01-login-1280.png`

---

### Paso 2 — Ficha de la reserva ARCHIVABLE (588cd528) — botón habilitado

URL: `http://localhost:5173/reservas/588cd528-42eb-454c-9196-9eea42c0ce9b`
Código: `CURL-U038-OK-1783685503411`

**Verificaciones (viewport 1280):**

| Verificación | Resultado |
|-------------|-----------|
| Botón "Archivar reserva" visible | PASS — presente en sección Acciones |
| Botón habilitado (`disabled: false`, `aria-disabled: false`) | PASS — evaluado via JS |
| Texto explicativo fianza resuelta | PASS — "El evento ya ha finalizado y la fianza está resuelta. Archiva la reserva para cerrarla…" |
| Sección "Fianza devuelta" con estado correcto | PASS — "Fianza devuelta. La devolución ha quedado registrada." |
| Sidebar fijo visible (nav en `>=lg`) | PASS — links Dashboard/Calendario/Reservas/Métricas visibles en `complementary` |

Captura: `e2e-screenshots/02-ficha-archivable-boton-habilitado-1280.png`

**Click en "Archivar reserva" → diálogo de confirmación:**

El diálogo apareció con:
- Título: "Archivar reserva"
- Texto: "La reserva pasará a **completada** y se archivará en el Histórico. Esta acción es irreversible y no se enviará ningún email al cliente."
- Botones: "Cancelar" y "Archivar reserva" (confirm)

Captura: `e2e-screenshots/03-dialogo-confirmacion-1280.png`

**Click en "Archivar reserva" (confirm) → éxito:**

- API call: `POST /api/reservas/588cd528-42eb-454c-9196-9eea42c0ce9b/archivar` → `200 OK` (verificado en network log).
- Después del refetch: sección Acciones muestra "No hay acciones disponibles para esta consulta en su estado actual."
- Botón "Archivar reserva" desaparece (RESERVA en `reserva_completada`, ya no hay acciones).
- Toast de éxito: aparece y se auto-cierra tras ~3s (capturado en el screenshot post-archivado).

Nota sobre el toast: el toast aparece inmediatamente tras la confirmación con el texto "Reserva CURL-U038-OK-1783685503411 archivada correctamente. Ya está disponible en el Histórico." y se auto-descarta. El screenshot post-archivado muestra el estado tras el cierre del toast (estado estable).

Captura: `e2e-screenshots/04-post-archivado-estado-completada-1280.png`

---

### Paso 3 — Ficha de la reserva BLOQUEADA (602cd555) — botón deshabilitado

URL: `http://localhost:5173/reservas/602cd555-8303-4308-bd9d-10a0e935ff1e`
Código: `CURL-U038-FZ-1783685503422`

**Verificaciones (viewport 1280):**

| Verificación | Resultado |
|-------------|-----------|
| Botón "Archivar reserva" visible | PASS — presente en sección Acciones |
| Botón deshabilitado (`disabled: true`) | PASS — atributo `disabled` confirmado en snapshot |
| Razón FA-01 mostrada | PASS — "No se puede archivar la reserva: la fianza está pendiente de resolución. Registra la devolución o retención de fianza antes de archivar." |
| No se dispara ningún API call | PASS — no hay request en network log para este intento |
| RESERVA permanece en post_evento | PASS — verificado en BD por Step N+2 |

Captura: `e2e-screenshots/05-ficha-bloqueada-boton-deshabilitado-1280.png`

---

## 2. Verificación responsive (3 viewports)

### Viewport 390 (móvil)

Reserva archivada (`588cd528`) tras el archivado del paso anterior:
- Nav colapsa a drawer: botón "Abrir navegación" presente, sin sidebar fijo. PASS
- Sección Acciones: "No hay acciones disponibles para esta consulta en su estado actual." PASS
- Sin overflow horizontal: `bodyScrollWidth (375) <= viewportWidth (390)`. PASS

Reserva bloqueada (`602cd555`):
- Nav colapsa a drawer: botón "Abrir navegación" presente. PASS
- Botón "Archivar reserva" `disabled` con razón FA-01. PASS
- Sin overflow horizontal: confirmado en snapshot. PASS

Captura: `e2e-screenshots/08-reserva-completada-sin-boton-390.png`
Captura: `e2e-screenshots/09-ficha-bloqueada-boton-deshabilitado-390.png`

### Viewport 768 (tablet)

Reserva archivada (`588cd528`):
- Nav colapsa a drawer: botón "Abrir navegación" presente, sin sidebar fijo. PASS (`<lg` = drawer)
- Sección Acciones: "No hay acciones disponibles…" PASS
- Sin overflow horizontal: `bodyScrollWidth (753) <= viewportWidth (768)`. PASS

Reserva bloqueada (`602cd555`):
- Nav colapsa a drawer: botón "Abrir navegación" presente. PASS
- Botón "Archivar reserva" `disabled` con razón FA-01. PASS
- Sin overflow horizontal. PASS

Captura: `e2e-screenshots/06-ficha-bloqueada-boton-deshabilitado-768.png`
Captura: `e2e-screenshots/07-reserva-completada-sin-boton-768.png`

### Viewport 1280 (escritorio)

- Sidebar fijo visible: `complementary` con nav links Dashboard/Calendario/Reservas/Métricas. PASS (`>=lg` = sidebar fijo)
- Sin botón hamburguesa. PASS
- Sin overflow horizontal: `bodyScrollWidth (1265) <= viewportWidth (1280)`. PASS
- Flujo completo (botón habilitado → diálogo → confirmar → post-archivado) ejecutado a este viewport.

Capturas: `01` al `05`.

---

## 3. Tabla resumen de pasos E2E

| Paso | Descripción | Resultado |
|------|-------------|-----------|
| 1 | Login como gestor (1280) | PASS |
| 2a | Ficha 588cd528: botón visible y habilitado | PASS |
| 2b | Click botón → diálogo de confirmación aparece | PASS |
| 2c | Confirmar en diálogo → POST 200 OK | PASS |
| 2d | Post-archivado: botón desaparece, "No hay acciones" | PASS |
| 3 | Ficha 602cd555: botón visible pero disabled + razón FA-01 | PASS |
| R1 | Responsive 390: drawer nav, sin overflow, acciones correctas | PASS |
| R2 | Responsive 768: drawer nav, sin overflow, acciones correctas | PASS |
| R3 | Responsive 1280: sidebar fijo, sin overflow, flujo completo | PASS |

---

## 4. Capturas E2E generadas

Todas las capturas están en `openspec/changes/us-038-archivado-manual-reserva-completada/reports/e2e-screenshots/` (NO en la raíz del repo):

| Archivo | Viewport | Descripción |
|---------|----------|-------------|
| `01-login-1280.png` | 1280 | Pantalla de login antes de autenticar |
| `02-ficha-archivable-boton-habilitado-1280.png` | 1280 | Ficha 588cd528: botón "Archivar reserva" habilitado |
| `03-dialogo-confirmacion-1280.png` | 1280 | Diálogo de confirmación abierto |
| `04-post-archivado-estado-completada-1280.png` | 1280 | Post-archivado: "No hay acciones disponibles" |
| `05-ficha-bloqueada-boton-deshabilitado-1280.png` | 1280 | Ficha 602cd555: botón disabled + razón FA-01 |
| `06-ficha-bloqueada-boton-deshabilitado-768.png` | 768 | Ficha bloqueada en tablet (drawer nav) |
| `07-reserva-completada-sin-boton-768.png` | 768 | Reserva archivada en tablet |
| `08-reserva-completada-sin-boton-390.png` | 390 | Reserva archivada en móvil (drawer nav) |
| `09-ficha-bloqueada-boton-deshabilitado-390.png` | 390 | Ficha bloqueada en móvil |

---

## 5. Verificación de persistencia

El network log del navegador confirmó la llamada real a la API:

```
[POST] http://localhost:3000/api/reservas/588cd528-42eb-454c-9196-9eea42c0ce9b/archivar => [200] OK
```

El estado del DOM tras el refetch muestra que la RESERVA pasó a `reserva_completada` (botón desaparece, "No hay acciones"). Esto confirma que:
1. El SDK llama correctamente a `archivarReservaManual`.
2. El hook `useArchivarReserva` invalida la query `reservaQueryKey` al éxito.
3. El refetch devuelve la RESERVA en `reserva_completada`.
4. El componente `AccionArchivar` oculta el botón al detectar el nuevo estado.

---

## 6. Limpieza de datos de test

Las reservas de seed (`588cd528` y `602cd555`) fueron sembradas por la sesión principal antes del E2E. La reserva `588cd528` quedó en `reserva_completada` como evidencia del flujo exitoso. La reserva `602cd555` permanece en `post_evento` (sin cambios). La sesión principal puede restaurar con:

```sql
UPDATE reservas SET estado = 'post_evento' WHERE id = '588cd528-42eb-454c-9196-9eea42c0ce9b';
DELETE FROM audit_log WHERE entidad_id = '588cd528-42eb-454c-9196-9eea42c0ce9b' AND accion = 'transicion';
```

---

## Outcome

**PASS** — Flujo completo E2E verificado en 3 viewports.

- Viewport 390 (móvil): drawer nav, sin overflow, estados correctos.
- Viewport 768 (tablet): drawer nav, sin overflow, estados correctos.
- Viewport 1280 (escritorio): sidebar fijo, sin overflow, flujo completo (botón habilitado → diálogo → confirmar → estado completada).
- Reserva bloqueada: botón disabled + razón FA-01 en los 3 viewports.
- API call `POST /archivar` retorna 200 y el refetch actualiza la UI correctamente.
