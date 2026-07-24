# Step 8 — QA E2E Playwright
## Change: solicitud-datos-presupuesto-borrador
**Fecha:** 2026-07-24
**Agente:** qa-verifier

---

## Entorno

| Componente | URL / detalle |
|---|---|
| Web (Vite) | http://localhost:5273 |
| API (NestJS) | http://localhost:3100 (prefijo /api) |
| BD | slotify_dev |
| Login | info@masialencis.com / Slotify2026! |
| E2E-SDP-1 | reservaId `95a3138f-26a8-4ea0-b99f-ae89048423a6` — estado consulta 2b, datos fiscales incompletos |
| E2E-SDP-2 | reservaId `3967c362-f220-4046-8838-0f779e0d93d8` — estado consulta 2b, datos fiscales completos |

---

## Resultados por caso

### 8.2 — Datos incompletos: happy path (E2E-SDP-1) — PASS

**Pasos ejecutados:**
1. Login con info@masialencis.com.
2. `goto /reservas/95a3138f-26a8-4ea0-b99f-ae89048423a6`.
3. Verificado que `data-testid="boton-generar-presupuesto"` existe y está habilitado (ref=f1e132).
4. Click en "Generar presupuesto" → modal `data-testid="dialog-generar-presupuesto"` abierto.
5. Dentro del modal: **botón "Solicitar datos al cliente" presente** (ref=f1e249, `data-testid="solicitar-datos-cliente"`).
6. Click en "Solicitar datos al cliente".

**Resultado observado:**
- El modal se cerró inmediatamente.
- La página hizo scroll al inicio (el banner aparece en la zona superior).
- Apareció el banner `status` (ref=f1e263) con texto: **"Solicitud de datos creada"** / **"Borrador de solicitud de datos creado en Comunicaciones. Revísalo y envíalo cuando quieras."**
- La sección Comunicaciones (`data-testid="comunicaciones-card"`) mostró un nuevo elemento:
  - Subtipo: "Solicitud de datos para presupuesto"
  - Asunto: "Pre-reserva confirmada"
  - Estado: **Borrador**
  - Destinatario: e2e.sdp@example.com
  - Creado: 24 de julio de 2026 a las 11:03
- La sección Acciones pasó a modo "borrador pendiente" (sin botón "Generar presupuesto").

**Capturas:**
- `e2e-screenshots/8.2-sdp1-ficha-inicial.png` — ficha con botón habilitado
- `e2e-screenshots/8.2-sdp1-modal-con-boton-solicitar.png` — modal con botón "Solicitar datos al cliente"
- `e2e-screenshots/8.2-sdp1-banner-y-comunicaciones.png` — banner + borrador en Comunicaciones

**Veredicto: PASS**

---

### 8.3 — Datos completos: botón NO aparece (E2E-SDP-2) — PASS

**Pasos ejecutados:**
1. `goto /reservas/3967c362-f220-4046-8838-0f779e0d93d8`.
2. Click en "Generar presupuesto" → modal abierto.
3. Inspeccionado el contenido del modal.

**Resultado observado:**
- Los campos de datos fiscales del cliente estaban rellenos en el modal: DNI "12345678Z", Dirección "C/ Major 1", CP "08001", Población "Barcelona", Provincia "Barcelona".
- El modal contenía únicamente los botones **"Cancelar"** y **"Confirmar presupuesto"** (este último deshabilitado por falta de precio manual al superar los 50 invitados).
- **El botón "Solicitar datos al cliente" NO apareció** en el modal.

**Captura:**
- `e2e-screenshots/8.3-sdp2-modal-sin-boton-solicitar.png` — modal sin el botón

**Veredicto: PASS**

---

### 8.4 — Enviar borrador + 409 al reintentar (E2E-SDP-1) — PASS

**Pasos ejecutados:**
1. Vuelto a la ficha E2E-SDP-1 (`goto`).
2. En sección Comunicaciones: click en "Revisar y enviar" (ref=f3e179, `data-testid="abrir-revisar-borrador"`).
3. Modal "Revisar y enviar borrador" abierto con asunto "Pre-reserva confirmada" y cuerpo con solicitud de datos (nombre, DNI, dirección).
4. Click en "Enviar email" (`data-testid="confirmar-enviar-borrador"`).

**Resultado tras envío:**
- El modal se cerró.
- Apareció el banner `status` (ref=f3e216): **"Email enviado"** / "El correo se ha **enviado correctamente** al cliente. Las acciones de la consulta ya están disponibles."
- En Comunicaciones: el estado del item cambió de "Borrador" a **"Enviado"**, con campo "Enviado: 24 de julio de 2026 a las 11:05".
- La sección Acciones recuperó el botón "Generar presupuesto".

**Pasos para el 409:**
5. Click en "Generar presupuesto" → modal abierto de nuevo (datos fiscales siguen incompletos, botón "Solicitar datos al cliente" visible).
6. Click en "Solicitar datos al cliente".

**Resultado del 409:**
- El modal **permaneció abierto** (no se cerró).
- Apareció un elemento `alert` (ref=f3e356) inline dentro del modal: **"Ya se solicitaron los datos a este cliente."**
- **NO apareció ningún banner de éxito** en la página.
- La API respondió HTTP 409 (confirmado por consola de red: `Failed to load resource: 409 (Conflict) @ .../solicitar-datos-presupuesto`).

**Capturas:**
- `e2e-screenshots/8.4-sdp1-modal-revisar-borrador.png` — modal revisar borrador antes del envío
- `e2e-screenshots/8.4-sdp1-email-enviado-banner-y-comunicaciones.png` — banner "email enviado" + comunicación en estado Enviado
- `e2e-screenshots/8.4-sdp1-409-aviso-inline-modal-abierto.png` — aviso inline 409 con modal abierto

**Veredicto: PASS**

---

### 8.5 — Responsive (390 / 768 / 1280) — PASS

Prueba ejecutada con `browser_resize` antes de navegar a la ficha y abrir el modal de E2E-SDP-1.

| Viewport | Nav | Overflow horizontal | Modal usable | Captura |
|---|---|---|---|---|
| 390×844 (móvil) | Drawer/hamburguesa — botón "Abrir navegación" visible | scrollWidth=375, clientWidth=375, excess=0 — **sin overflow** | Sí, controles accesibles | `8.5-responsive-390-modal.png` |
| 768×1024 (tablet) | Drawer/hamburguesa — botón "Abrir navegación" visible (`<lg`) | scrollWidth=753, clientWidth=753, excess=0 — **sin overflow** | Sí | `8.5-responsive-768-modal.png` |
| 1280×800 (escritorio) | Sidebar fijo (`complementary`) | scrollWidth=1265, clientWidth=1265, excess=0 — **sin overflow** | Sí | `8.5-responsive-1280-modal.png` |

Notas de responsiveness:
- En 390px y 768px la navegación lateral colapsa a drawer con botón hamburguesa, cumpliendo la regla `<lg → drawer`.
- En 1280px la nav es sidebar fijo (`complementary`), cumpliendo la regla `≥lg → sidebar fijo`.
- En ningún viewport se detectó overflow horizontal.
- Los botones del modal ("Solicitar datos al cliente", "Cancelar", "Confirmar presupuesto") son visibles y táctiles en los tres viewports.

**Veredicto: PASS**

---

## Consola de errores observados

| Error | Origen | Esperado |
|---|---|---|
| `401 Unauthorized @ /api/auth/refresh` | Refresh de token en SPA (goto recarga la app) | Sí — comportamiento normal al navegar con goto |
| `409 Conflict @ .../solicitar-datos-presupuesto` | Respuesta API al reintentar la solicitud ya enviada | Sí — es el caso de prueba 8.4 |

No se registró ningún error de consola inesperado.

---

## Estado de la BD

No se realizaron escrituras destructivas. El borrador creado en 8.2 fue enviado en 8.4 (flujo funcional completo). Los datos de E2E-SDP-2 no fueron alterados. La BD queda en el estado final funcional esperado para el flujo del change.

---

## Resumen

| Caso | Estado |
|---|---|
| 8.2 Datos incompletos — botón aparece + happy path | PASS |
| 8.3 Datos completos — botón NO aparece | PASS |
| 8.4 Enviar borrador + banner email enviado + 409 inline | PASS |
| 8.5 Responsive 390 / 768 / 1280 sin overflow | PASS |

**Outcome global: PASS**

Todos los casos del step 8 han pasado. No se detectaron regresiones ni comportamientos inesperados.
