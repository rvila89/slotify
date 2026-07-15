# Step N+3 — E2E con Playwright MCP

- Fecha: 15/07/2026
- Change: `condiciones-particulares-e3-us023`
- Agente: `qa-verifier`

---

## Nota de entorno

**ESTADO: EJECUTADO Y VERDE por la sesión principal (15/07/2026).**

El subagente QA no alcanza el stack completo (frontend + backend + BD) en sandbox, así que este E2E
lo ejecutó la SESIÓN PRINCIPAL con Playwright MCP contra backend `pnpm dev` (`:3000`), frontend
`pnpm dev` (`:5173`) y Postgres de desarrollo. Las dos reservas de los escenarios se fabricaron con
el script de fixtures `apps/api/prisma/e2e-fixtures-us023.ts` (idempotente, con `--teardown`), ya
revertido al final (BD limpia, tenant piloto intacto verificado). Los pasos originales se conservan
abajo; el resultado real está en la sección **Resultado**.

Desviaciones respecto al plan (documentadas y justificadas):
- El flujo real requiere **aprobar la factura** (borrador→enviada, US-022) ANTES de que aparezca el
  botón de envío E3 ("Enviar factura 40%"). Por eso, en el Escenario 2, la factura acaba en
  `enviada` (por la aprobación), y el endurecimiento GAP 2 se verifica sobre la transacción del
  **envío del email E3**, que sí revierte del todo (0 COMUNICACION E3, 0 DOCUMENTO,
  `cond_part_enviadas_fecha` NULL). El assert A7 original ("factura sigue borrador") no aplica a
  este flujo.
- La aprobación de factura exige **datos fiscales completos del cliente** (guarda pre-existente del
  change de datos fiscales inline); se completaron en el fixture B para poder alcanzar el paso E3.

---

## Requisitos previos (sesión principal)

```bash
# 1. Arrancar backend (apps/api)
pnpm start:dev
# Verificar: http://localhost:3000/api/health → 200 OK

# 2. Arrancar frontend (apps/web)
pnpm dev
# Verificar: http://localhost:5173 carga la SPA

# 3. Seed E2E temporal en slotify_dev (o slotify_test si la sesión lo prefiere)
# Necesario:
#   - Un tenant CON condiciones configuradas (condiciones/{tenantId}.pdf existe en storage)
#   - Una reserva en estado reserva_confirmada con factura señal enviada Y E3 ya enviado
#     (COMUNICACION E3 es_reenvio=false, estado=enviado) → para probar el botón "Reenviar E3"
#   - Una reserva en estado reserva_confirmada con factura señal borrador de un tenant
#     SIN condiciones configuradas → para probar el endurecimiento GAP 2
# Anotar los IDs y URLs de estas reservas para los steps de navegación.
```

---

## Escenario 1 — Botón "Reenviar E3": éxito (200) + toast + persistencia BD

### Contexto
Reserva: `RESERVA_ID_CON_E3` — tiene E3 ya enviado (`COMUNICACION E3 es_reenvio=false, estado=enviado`).

### Pasos Playwright MCP

#### Paso 1.1 — Autenticación
```
browser_navigate: http://localhost:5173/login

browser_snapshot  # verificar formulario de login

browser_fill_form: [
  { target: "input[name='email']", name: "email", type: "textbox", value: "<email-gestor>" },
  { target: "input[name='password']", name: "password", type: "textbox", value: "<password-gestor>" }
]

browser_click: target="button[type='submit']"  # element="Botón Iniciar sesión"

browser_wait_for: text="Dashboard"  # esperar carga post-login

browser_snapshot  # confirmar sesión iniciada
```

#### Paso 1.2 — Navegar a la ficha de la reserva con E3 enviado
```
browser_navigate: http://localhost:5173/reservas/<RESERVA_ID_CON_E3>

browser_wait_for: text="Reenviar E3"  # esperar que la acción aparezca en la ficha

browser_snapshot  # captura: ficha con botón "Reenviar E3" visible
# Guardar captura como: e2e-screenshots/01-ficha-con-boton-reenviar-e3.png
```

**Assert esperado:** botón "Reenviar E3" visible y habilitado en la sección de factura/documentos.

#### Paso 1.3 — Pulsar "Reenviar E3"
```
browser_click: target="button"  # element="Botón Reenviar E3"

browser_wait_for: text="E3 reenviado"  # esperar toast de éxito (o texto equivalente del toast)
# Alternativa: browser_wait_for: text="reenviado correctamente"

browser_snapshot  # captura: toast de éxito visible
# Guardar captura como: e2e-screenshots/02-toast-exito-reenvio-e3.png
```

**Assert esperado:** toast de confirmación visible; la fecha de envío en la UI se actualiza.

#### Paso 1.4 — Verificar persistencia en UI
```
browser_snapshot  # captura: ficha actualizada con nueva fecha cond_part_enviadas_fecha

# Verificar en la sección de comunicaciones/historial que aparece la nueva entrada de reenvío
browser_wait_for: text="Reenvío"  # o texto equivalente en el historial de comunicaciones

browser_snapshot  # captura: historial con entrada de reenvío
# Guardar captura como: e2e-screenshots/03-historial-con-reenvio-e3.png
```

**Assert esperado:** UI refleja la nueva `cond_part_enviadas_fecha`; historial muestra el reenvío.

#### Paso 1.5 — Verificar persistencia en BD (sesión principal)
```sql
-- Nueva COMUNICACION es_reenvio=true
SELECT id, codigo_email, estado, es_reenvio, fecha_envio
FROM "COMUNICACION"
WHERE reserva_id = '<RESERVA_ID_CON_E3>' AND es_reenvio = true
ORDER BY fecha_envio DESC LIMIT 1;
-- Esperado: 1 fila con estado='enviado', codigo_email='E3', es_reenvio=true

-- DOCUMENTO no duplicado
SELECT COUNT(*) FROM "DOCUMENTO"
WHERE reserva_id = '<RESERVA_ID_CON_E3>' AND tipo = 'condiciones_particulares';
-- Esperado: COUNT = 1 (sin duplicado)

-- cond_part_enviadas_fecha actualizada
SELECT cond_part_enviadas_fecha FROM "RESERVA" WHERE id = '<RESERVA_ID_CON_E3>';
-- Esperado: timestamp reciente (posterior al E3 original)
```

---

## Escenario 2 — Envío E3 endurecido: tenant sin condiciones → alerta + factura borrador

### Contexto
Reserva: `RESERVA_ID_TENANT_SIN_COND` — tenant sin `condiciones/{tenantId}.pdf` en storage.
Factura señal en estado `borrador` (aún no enviada).

### Pasos Playwright MCP

#### Paso 2.1 — Navegar a la ficha de la reserva sin condiciones
```
browser_navigate: http://localhost:5173/reservas/<RESERVA_ID_TENANT_SIN_COND>

browser_wait_for: text="Enviar E3"  # esperar que la acción de envío esté disponible

browser_snapshot  # captura: ficha con botón "Enviar E3" visible, factura en borrador
# Guardar captura como: e2e-screenshots/04-ficha-enviar-e3-sin-condiciones.png
```

#### Paso 2.2 — Pulsar "Enviar E3"
```
browser_click: target="button"  # element="Botón Enviar E3" (o equivalente en la ficha)

browser_wait_for: text="condiciones particulares"
# Esperar alerta de error con texto de GAP 2: "Configura las condiciones particulares del espacio"

browser_snapshot  # captura: alerta visible con mensaje de error
# Guardar captura como: e2e-screenshots/05-alerta-condiciones-no-configuradas.png
```

**Assert esperado:**
- Alerta visible con mensaje aproximado: "Configura las condiciones particulares del espacio para
  poder enviar E3" (o equivalente UI de `CONDICIONES_NO_CONFIGURADAS`).
- La factura sigue en estado `borrador` (UI no actualiza a "enviada").
- No hay toast de éxito.

#### Paso 2.3 — Verificar que la factura sigue en borrador en UI
```
browser_snapshot  # captura: estado de factura sigue borrador tras el intento fallido
# Guardar captura como: e2e-screenshots/06-factura-sigue-borrador-tras-error.png
```

**Assert esperado:** badge/estado de factura muestra "Borrador" (no "Enviada").

#### Paso 2.4 — Verificar persistencia en BD (sesión principal)
```sql
-- Factura sigue en borrador
SELECT estado FROM "FACTURA"
WHERE reserva_id = '<RESERVA_ID_TENANT_SIN_COND>' AND tipo = 'senal';
-- Esperado: estado = 'borrador'

-- cond_part_enviadas_fecha sigue NULL
SELECT cond_part_enviadas_fecha FROM "RESERVA"
WHERE id = '<RESERVA_ID_TENANT_SIN_COND>';
-- Esperado: NULL

-- Sin COMUNICACION E3 creada
SELECT COUNT(*) FROM "COMUNICACION"
WHERE reserva_id = '<RESERVA_ID_TENANT_SIN_COND>' AND codigo_email = 'E3';
-- Esperado: COUNT = 0

-- Sin DOCUMENTO condiciones creado
SELECT COUNT(*) FROM "DOCUMENTO"
WHERE reserva_id = '<RESERVA_ID_TENANT_SIN_COND>' AND tipo = 'condiciones_particulares';
-- Esperado: COUNT = 0
```

---

## Escenario 3 — Responsive (OBLIGATORIO): 3 viewports

Ejecutar los pasos clave de los Escenarios 1 y 2 en cada viewport. Para cada viewport:
- Verificar que no hay overflow horizontal.
- Verificar que la navegación colapsa a drawer + hamburguesa en `<lg` (390 y 768).
- Verificar que la navegación es sidebar fijo en `≥lg` (1280).
- Verificar que el botón "Reenviar E3" y la alerta de condiciones son accesibles (touch targets).

### Viewport 390 (móvil)
```
browser_resize: { width: 390, height: 844 }

browser_navigate: http://localhost:5173/reservas/<RESERVA_ID_CON_E3>

browser_snapshot  # captura: ficha en móvil — nav colapsada (drawer/hamburguesa)
# Guardar captura como: e2e-screenshots/07-viewport-390-ficha-reenvio.png

# Verificar drawer
browser_click: target="button[aria-label='Menu']"  # element="Botón hamburguesa"
browser_snapshot  # captura: drawer abierto en móvil
# Guardar captura como: e2e-screenshots/08-viewport-390-drawer-abierto.png
browser_press_key: key="Escape"  # cerrar drawer

# Probar scroll horizontal (no debe haber)
browser_evaluate: function="() => document.documentElement.scrollWidth > document.documentElement.clientWidth"
# Esperado: false (sin overflow horizontal)

# Ejecutar flujo de reenvío en móvil (pasos 1.3-1.4 del Escenario 1)
browser_click: target="button"  # element="Botón Reenviar E3"
browser_wait_for: text="E3 reenviado"
browser_snapshot  # captura: toast en móvil
# Guardar captura como: e2e-screenshots/09-viewport-390-toast-reenvio.png
```

### Viewport 768 (tablet)
```
browser_resize: { width: 768, height: 1024 }

browser_navigate: http://localhost:5173/reservas/<RESERVA_ID_CON_E3>

browser_snapshot  # captura: ficha en tablet — nav colapsada (drawer/hamburguesa, <lg)
# Guardar captura como: e2e-screenshots/10-viewport-768-ficha.png

# Verificar overflow
browser_evaluate: function="() => document.documentElement.scrollWidth > document.documentElement.clientWidth"
# Esperado: false

browser_snapshot
# Guardar captura como: e2e-screenshots/11-viewport-768-sin-overflow.png
```

### Viewport 1280 (escritorio)
```
browser_resize: { width: 1280, height: 800 }

browser_navigate: http://localhost:5173/reservas/<RESERVA_ID_CON_E3>

browser_snapshot  # captura: ficha en escritorio — sidebar fijo visible (≥lg)
# Guardar captura como: e2e-screenshots/12-viewport-1280-sidebar-fijo.png

# Verificar overflow
browser_evaluate: function="() => document.documentElement.scrollWidth > document.documentElement.clientWidth"
# Esperado: false

# Probar alerta condiciones en escritorio (Escenario 2)
browser_navigate: http://localhost:5173/reservas/<RESERVA_ID_TENANT_SIN_COND>
browser_click: target="button"  # element="Botón Enviar E3"
browser_wait_for: text="condiciones particulares"
browser_snapshot  # captura: alerta en escritorio
# Guardar captura como: e2e-screenshots/13-viewport-1280-alerta-condiciones.png
```

---

## Restauración y limpieza (sesión principal, tras todos los escenarios)

```bash
# Eliminar datos de test creados durante E2E
# 1. COMUNICACION es_reenvio=true creada en Escenario 1
DELETE FROM "COMUNICACION"
WHERE reserva_id = '<RESERVA_ID_CON_E3>' AND es_reenvio = true;

# 2. Restaurar cond_part_enviadas_fecha al valor previo al test
UPDATE "RESERVA"
SET cond_part_enviadas_fecha = '<valor-previo>'  -- anotar antes del test
WHERE id = '<RESERVA_ID_CON_E3>';

# 3. Si se creó seed E2E temporal, eliminarlo por completo (reservas, comunicaciones, documentos
#    del tenant de test)

# 4. Cerrar el navegador
browser_close
```

**Capturas:** mover todos los archivos `e2e-screenshots/*.png` a
`openspec/changes/condiciones-particulares-e3-us023/reports/e2e-screenshots/`
(ver MEMORY: "qa-verifier deja capturas E2E en la raíz").

---

## Checklist de asserts del E2E

| # | Assert | Escenario | Resultado |
|---|--------|-----------|-----------|
| A1 | Botón "Reenviar E3" visible y habilitado en ficha con E3 previo | 1 | ✅ PASA |
| A2 | Éxito tras pulsar "Reenviar E3" (POST `.../senal/reenviar` → 200) | 1 | ✅ PASA (200 OK) |
| A3 | UI/BD actualiza `cond_part_enviadas_fecha` tras reenvío | 1 | ✅ PASA (13:03) |
| A4 | BD: nueva COMUNICACION `es_reenvio=true`, estado=`enviado` | 1 | ✅ PASA (total E3 = 2) |
| A5 | BD: DOCUMENTO condiciones sigue siendo 1 fila (sin duplicado) | 1 | ✅ PASA (= 1) |
| — | BD: factura NO re-emitida (mismo `F-2026-9001`, `fecha_emision` original, `enviada`) | 1 | ✅ PASA |
| A6 | Alerta "Configura las condiciones particulares..." tras envío E3 sin config (409) | 2 | ✅ PASA (409 Conflict) |
| A7 | ~~Factura sigue en `borrador`~~ → N/A: la factura se aprueba antes (queda `enviada`) | 2 | ⚪ N/A (ver desviaciones) |
| A8 | BD: `cond_part_enviadas_fecha`=NULL, sin COMUNICACION E3, sin DOCUMENTO (rollback E3) | 2 | ✅ PASA (0 / 0 / NULL) |
| A9 | Sin overflow horizontal en 390, 768, 1280 | 3 | ⚠️ 390 y 1280 = 0; 768 = 15px **pre-existente del app-shell** (dashboard = 35px), NO de US-023 |
| A10 | Nav colapsa a drawer + hamburguesa en 390 y 768 (`<lg`) | 3 | ✅ PASA |
| A11 | Nav es sidebar fijo en 1280 (`≥lg`) | 3 | ✅ PASA |
| A12 | Touch targets accesibles (botón "Reenviar E3") en móvil 390 | 3 | ✅ PASA |

---

## Resultado

- **Estado de step-N+3: EJECUTADO — VERDE.** Todos los asserts propios de US-023 pasan.
- Escenario 1 (reenvío E3): 200 OK, nueva COMUNICACION `es_reenvio=true`, DOCUMENTO no duplicado,
  `cond_part_enviadas_fecha` actualizada, factura no re-emitida ni transición. Verificado en UI + BD.
- Escenario 2 (GAP 2 endurecido): envío E3 → 409 + alerta "Configura las condiciones particulares
  del espacio para poder enviar E3"; rollback total (0 COMUNICACION E3, 0 DOCUMENTO,
  `cond_part_enviadas_fecha` NULL). Verificado en UI + red (409) + BD.
- Escenario 3 (responsive): 390 y 1280 sin overflow; drawer+hamburguesa en móvil; sidebar fijo en
  escritorio. **Único hallazgo**: 15px de overflow horizontal en 768 localizado en el **banner de
  cabecera del app-shell** (contenedor del botón "Nueva Reserva"), reproducible también en
  `/dashboard` (35px) → **pre-existente, ajeno a US-023**. Los componentes de US-023 (botón Reenviar
  E3 y alerta de condiciones) no introducen overflow.
- Capturas en `reports/e2e-screenshots/`: 01 (ficha+botón), 02 (post-reenvío), 04 (factura borrador
  tenant B), 05 (alerta condiciones), 07 (móvil 390), 08 (drawer abierto 390), 10 (tablet 768),
  12 (sidebar fijo 1280).
- Fixtures revertidos (`--teardown`); BD limpia y tenant piloto intacto verificado.
- Deuda menor sugerida (fuera de alcance de US-023): corregir el overflow de 15px del app-shell en
  ~768 (probable `100vw`/gutter de scrollbar en la cabecera).
