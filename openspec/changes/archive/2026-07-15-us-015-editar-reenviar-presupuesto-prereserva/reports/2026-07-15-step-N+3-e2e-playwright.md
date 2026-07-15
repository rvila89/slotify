# QA E2E Playwright — US-015 Editar y Reenviar Presupuesto en Pre-reserva

**Fecha**: 2026-07-15  
**Change**: us-015-editar-reenviar-presupuesto-prereserva  
**Agente**: qa-verifier  
**Tipo**: Step N+3 — E2E con Playwright MCP + Responsive 3 viewports + Unit tests

---

## 1. Unit Tests (Step N+1 — suites dirigidas)

### Comando ejecutado
```
cd apps/api && pnpm jest editar-presupuesto maquina-estados-editar-presupuesto --no-coverage
```

### Resultado
- Test Suites: **2 passed**, 2 total
- Tests: **49 passed**, 49 total
- Snapshots: 0 total
- Time: 13.025s

**Veredicto unit tests: PASS 49/49**

---

## 2. Baseline BD (pre-E2E)

Reserva ID: `d1f92f88-00a5-4f9d-8989-dd8fc661878a`

| Tabla | Registro | Valor baseline |
|-------|----------|----------------|
| presupuesto | versiones | v1..v7 (7 filas; v7=enviado,1156€) |
| reserva | estado | pre_reserva |
| reserva | sub_estado | null |
| fecha_bloqueada | ttl_expiracion | 2026-07-20T15:01:30.626Z |

---

## 3. Flujo E2E ejecutado (Happy Path)

### Paso 1 — Login como gestor-a1
- Navegado a `http://localhost:5173` (único `goto` permitido).
- Relleno email `gestor-a1@slotify.test` y password `Slotify2026!`.
- Click "Entrar a Slotify".
- Resultado: redirect a `/dashboard`. **PASS**

### Paso 2 — Navegar a ficha de reserva en pre_reserva
- Desde dashboard, sección "Pipeline activo", click en link "26-0001 Jatinder Halipa 18 jul 2026".
- URL resultante: `/reservas/d1f92f88-00a5-4f9d-8989-dd8fc661878a`.
- Navegación por UI (sin goto). **PASS**

### Paso 3 — Verificar botón "Editar presupuesto"
- Ficha muestra sección "Acciones" con botón `data-testid="boton-editar-presupuesto"`.
- Texto: "Editar presupuesto". Presente y clickable. **PASS**
- Captura: `01-ficha-con-boton-editar.png`

### Paso 4 — Abrir diálogo y verificar campos + preview en vivo
- Click en "Editar presupuesto": se abre `dialog` con heading "Editar presupuesto".
- Campos verificados:
  - Spinbutton "Nº de invitados (adultos y niños > 4 años)" — presente
  - Combobox "Duración del evento" (opciones 4h/8h/12h) — presente
  - Radiogroup "Método de pago" (Transferencia con IVA 21% / Efectivo sin IVA) — presente
  - Lista de extras (Barbacoa 30€/ud, Paellero 30€/ud con spinbuttons) — presente
  - Spinbutton "Descuento (€)" — presente
  - Textbox "Motivo del descuento (opcional)" — presente
- Preview inicial: Base imponible 458,68€, IVA 21% 96,32€, Total 555,00€
- Al introducir 50€ de descuento: preview recalcula en vivo
  - Base imponible: 417,36€
  - IVA 21%: 87,64€
  - Descuento aplicado: -50,00€
  - Total: 505,00€
- **Recálculo en vivo: PASS**
- Captura: `02-dialogo-edicion-abierto.png`, `03-dialogo-preview-con-descuento.png`

### Paso 5a — Guardar borrador (enviar=false)
- Descuento 50€ introducido, click "Guardar borrador" (`data-testid="guardar-borrador-edicion"`).
- Feedback: `status` con texto "Borrador del presupuesto guardado. No se ha enviado nada al cliente todavía."
- Versión: **8**, Total: **505,00 €**
- Diálogo cerrado automáticamente. **PASS**
- Captura: `04-feedback-borrador-guardado.png`

### Paso 5b — Enviar al cliente (enviar=true)
- Reabrir diálogo, introducir descuento 30€, click "Enviar al cliente" (`data-testid="enviar-edicion"`).
- Feedback: "Presupuesto actualizado y enviado al cliente. La versión anterior se conserva como historial."
- Versión: **9** · nº 2026006. Total: **525,00 €**
- **PASS**
- Captura: `05-feedback-enviado-cliente.png`

### Paso 5c — Reenviar sin cambios
- Reabrir diálogo, click "Reenviar sin cambios" (`data-testid="reenviar-presupuesto"`).
- Feedback: "Presupuesto reenviado al cliente sin cambios. Se ha registrado el reenvío por email."
- Versión: **9** · nº 2026006. Total: **525,00 €** (no crea nueva versión).
- **PASS — no versiona, reenvía E2**
- Captura: `06-feedback-reenviado-sin-cambios.png`

---

## 4. Responsive — 3 Viewports

### Método de medición
- `browser_resize` para cambiar viewport.
- `browser_evaluate` para medir `body.scrollWidth` vs `window.innerWidth`.
- Verificación visual mediante screenshots.

| Viewport | Sidebar/Nav | Overflow | Diálogo | Botones acción | Campos usables | Veredicto |
|----------|-------------|----------|---------|----------------|----------------|-----------|
| 390 (móvil) | Hamburguesa (drawer), sin sidebar visible | NO (body 375px en 390px) | Presente (358px), stacked layout | Presente, anchura 301px en dialog 358px | Todos accesibles | PASS |
| 768 (tablet) | Hamburguesa (drawer, <lg=1024) | NO (body 768px) | Presente (672px), 2 cols invitados/duración | Presentes y usables | Todos accesibles + preview visible | PASS |
| 1280 (escritorio) | Sidebar 288px presente pero hamburguesa tambien visible (deuda pre-existente app-shell, ver nota) | NO (body 1265px en 1280px) | Presente (672px), bien centrado | Presentes y usables | Todos accesibles | PASS |

**Nota sobre sidebar 1280px**: El app-shell no convierte la nav a sidebar fijo en `>=lg`. Esta deuda es pre-existente y está registrada en memoria del proyecto (`appshell-overflow-768-deuda.md`). No fue introducida por US-015. La ficha de reserva y el diálogo de edición de presupuesto son correctamente usables en todos los viewports.

Capturas: `07-responsive-390-ficha.png`, `08-responsive-390-dialogo.png`, `09-responsive-768-dialogo.png`, `10-responsive-1280-ficha.png`, `11-responsive-1280-dialogo.png`

---

## 5. Verificación BD post-E2E

| Tabla | Valor post-E2E | Igual que baseline | Observación |
|-------|---------------|-------------------|-------------|
| presupuesto (count) | 9 filas (v1..v9) | NO — esperado | E2E creó v8 (borrador) y v9 (enviado) como parte del flujo de prueba |
| reserva.estado | pre_reserva | SI | Invariante respetado |
| reserva.sub_estado | null | SI | Invariante respetado |
| fecha_bloqueada.ttl_expiracion | 2026-07-20T15:01:30.626Z | SI | Invariante respetado |

Las versiones v8 y v9 son datos de prueba creados intencionalmente por el E2E (happy path de guardar borrador y enviar). La reserva permanece en `pre_reserva` y el TTL no cambió. No se requiere restauración de invariantes; los presupuestos extra son datos de prueba aceptables para el entorno dev.

---

## 6. Capturas de pantalla

| Archivo | Descripción |
|---------|-------------|
| `01-ficha-con-boton-editar.png` | Ficha reserva 26-0001 con botón "Editar presupuesto" visible |
| `02-dialogo-edicion-abierto.png` | Diálogo abierto con todos los campos visibles (1280px) |
| `03-dialogo-preview-con-descuento.png` | Preview en vivo tras introducir 50€ descuento |
| `04-feedback-borrador-guardado.png` | Feedback de borrador guardado (v8, 505€) |
| `05-feedback-enviado-cliente.png` | Feedback de enviado al cliente (v9, 525€) |
| `06-feedback-reenviado-sin-cambios.png` | Feedback reenvío sin cambios (v9 sin versionar) |
| `07-responsive-390-ficha.png` | Ficha en mobile 390px |
| `08-responsive-390-dialogo.png` | Diálogo en mobile 390px — stacked, sin overflow |
| `09-responsive-768-dialogo.png` | Diálogo en tablet 768px — 2 cols, preview visible |
| `10-responsive-1280-ficha.png` | Ficha en desktop 1280px |
| `11-responsive-1280-dialogo.png` | Diálogo en desktop 1280px — centrado, usable |

Ruta: `openspec/changes/us-015-editar-reenviar-presupuesto-prereserva/reports/e2e-screenshots/`

---

## 7. Errores y deudas pre-existentes

| Issue | Tipo | Introducido por US-015 |
|-------|------|----------------------|
| App-shell sidebar no fija a sidebar en `>=lg` (1280px) | Deuda pre-existente (`appshell-overflow-768-deuda.md`) | NO |
| ~15px overflow cabecera 768 | Deuda pre-existente | NO |

No se detectaron errores nuevos introducidos por US-015.

---

## 8. Veredicto Final

| Componente | Resultado |
|------------|-----------|
| Unit tests (49/49) | PASS |
| Login y navegación SPA | PASS |
| Botón "Editar presupuesto" en pre_reserva | PASS |
| Diálogo con todos los campos especificados | PASS |
| Preview en vivo (recálculo descuento) | PASS |
| Guardar borrador (enviar=false) + feedback | PASS |
| Enviar al cliente (enviar=true) + feedback + versión | PASS |
| Reenviar sin cambios (no versiona) + feedback | PASS |
| Responsive 390px — sin overflow | PASS |
| Responsive 768px — sin overflow | PASS |
| Responsive 1280px — sin overflow | PASS |
| Invariantes BD (estado reserva, TTL) | PASS |

**Veredicto UI: APTO**
