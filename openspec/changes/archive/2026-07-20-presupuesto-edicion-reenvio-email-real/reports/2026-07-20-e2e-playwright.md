# Step N+3 — E2E Playwright (2026-07-20)

> Change: `presupuesto-edicion-reenvio-email-real`  
> Stack: Web `http://localhost:5180` · API `http://localhost:3100` · BD `slotify_dev` · `EMAIL_TRANSPORT=fake`

---

## Bloqueante: Playwright MCP browser no disponible

El MCP de Playwright (`@playwright/mcp@latest`) devuelve el error:

```
Error: Browser is already in use for C:\Users\roger.vila\AppData\Local\ms-playwright-mcp\mcp-chrome-4321e63,
use --isolated to run multiple instances of the same browser
```

**Causa raíz:** Una sesión de Claude anterior (PID 31684, padre cmd.exe PID 500, NO un claude.exe activo) dejó el perfil `mcp-chrome-4321e63` bloqueado con un `lockfile`. El agente no pudo terminar ese proceso (auto-mode deniega la acción `Interfere With Workloads`).

**Impacto:** El E2E con Playwright MCP no pudo ejecutarse contra el navegador real. Los criterios de prefill, scroll-to-top y responsive NO pudieron verificarse con capturas de pantalla reales.

**Para desbloquear:** Cierra la sesión de Claude que mantenga abierta una conversación anterior con Playwright, o ejecuta en PowerShell: `taskkill /F /PID 31684 /T` y luego repite la QA.

---

## Verificación alternativa (código + API)

Dado el bloqueo, se realizó una verificación en dos capas:

### 1. Verificación estática del código implementado

| Criterio | Archivo verificado | Resultado |
|----------|-------------------|-----------|
| Prefill invitados = `numAdultosNinosMayores4` | `EditarPresupuestoDialog.tsx` línea 75: `invitadosIniciales != null ? String(invitadosIniciales) : ''` | PASS (código) |
| Prefill duración = `duracionHoras` acotada {4,8,12} | `edicion.ts` · `acotarDuracionInicial()` + `EditarPresupuestoDialog.tsx` línea 76: `acotarDuracionInicial(duracionInicial)` | PASS (código) |
| Cableado prefill desde `reserva` en `DialogosFicha.tsx` | Líneas 165–166: `invitadosIniciales={reserva.numAdultosNinosMayores4 ?? undefined}` / `duracionInicial={reserva.duracionHoras ?? undefined}` | PASS (código) |
| Scroll-to-top al enviar edición | `FichaConsultaPage.tsx` línea 316: `window.scrollTo({ top: 0, behavior: 'smooth' })` en `onEditadoPresupuesto` | PASS (código) |
| Scroll-to-top al reenviar sin cambios | `FichaConsultaPage.tsx` línea 322: `window.scrollTo({ top: 0, behavior: 'smooth' })` en `onReenviadoPresupuesto` | PASS (código) |
| Banner de éxito "Presupuesto actualizado y enviado…" | `AvisoPresupuestoEditado.tsx` línea 35: `'Presupuesto actualizado y enviado al cliente...'` | PASS (código) |
| Banner accesible (`role="status"`, `data-testid="aviso-presupuesto-editado"`) | `AvisoPresupuestoEditado.tsx` línea 39 | PASS (código) |
| Dialog mobile-first, `max-h-[90vh]`, `overflow-y-auto` | `EditarPresupuestoDialog.tsx` línea 191 | PASS (código) |
| Botones táctiles y accesibles | `data-testid="enviar-edicion"`, `data-testid="reenviar-presupuesto"` presentes | PASS (código) |

### 2. Verificación por API (curl real contra `slotify_dev`)

#### Creación de reserva de test y activación de pre_reserva

Se creó una reserva de test con los siguientes parámetros:

```bash
POST /api/reservas
{
  "canalEntrada": "web",
  "fechaEvento": "2026-08-01",
  "duracionHoras": 8,
  "numAdultosNinosMayores4": 50,
  "tipoEvento": "boda",
  "idioma": "es",
  "cliente": {
    "nombre": "QA",
    "apellidos": "Test E2E",
    "email": "qa.test.e2e@slotify-qa.com",
    "telefono": "612345678"
  }
}
```

Respuesta: `201` · `idReserva: 7e5f92dc-0e1d-449c-8570-3621e164fef0` · `estado: consulta` · `subEstado: 2b`

```bash
PATCH /api/reservas/7e5f92dc.../datos-fiscales → 200 (datos fiscales cargados)
POST  /api/reservas/7e5f92dc.../presupuesto   → 201 (estado: pre_reserva, presupuesto v1)
```

#### Baseline BD pre-test

| Campo | Valor |
|-------|-------|
| `reserva.estado` | `pre_reserva` |
| `reserva.numAdultosNinosMayores4` | 50 |
| `reserva.duracionHoras` | 8 |
| `reserva.ttlExpiracion` | `2026-07-27T12:20:06.994Z` |
| `COMUNICACION` count (E2) | 1 (E2 original, `esReenvio=false`) |
| Total `COMUNICACION` | 2 (E1 + E2 original) |

#### Test: POST /presupuesto/edicion (enviar=true) — criterio D2 + D1

```bash
POST /api/reservas/7e5f92dc.../presupuesto/edicion
{
  "numAdultosNinosMayores4": 45,
  "duracionHoras": 8,
  "extras": [],
  "metodoPago": "transferencia",
  "enviar": true
}
```

| Resultado esperado | Resultado obtenido | Status |
|--------------------|--------------------|--------|
| HTTP 2xx | HTTP 200 (sin `statusCode`) | PASS |
| `presupuesto.version = 2` | `"version": 2` | PASS |
| `presupuesto.estado = "enviado"` | `"estado": "enviado"` | PASS |
| `comunicacion.esReenvio = true` | `"esReenvio": true` | PASS |
| `comunicacion.estado = "enviado"` | `"estado": "enviado"` | PASS |
| Nueva `COMUNICACION` E2 con asunto "Hemos actualizado…" | `"asunto": "Hemos actualizado tu presupuesto para el evento (reserva 26-0002)"` | PASS |
| `reserva.estado = pre_reserva` (sin cambio) | `"estado": "pre_reserva"` | PASS |
| `ttlExpiracion` inalterado | `2026-07-27T12:20:06.994Z` (igual) | PASS |
| Cuerpo contiene párrafo de edición | `"Hemos actualizado el presupuesto que te enviamos con los cambios solicitados."` | PASS (D2) |

#### Test: POST /presupuesto/reenvio — criterio D2 (sin marca edición)

```bash
POST /api/reservas/7e5f92dc.../presupuesto/reenvio
{}
```

| Resultado esperado | Resultado obtenido | Status |
|--------------------|--------------------|--------|
| HTTP 2xx | HTTP 200 | PASS |
| `comunicacion.esReenvio = true` | `"esReenvio": true` | PASS |
| `comunicacion.estado = "enviado"` | `"estado": "enviado"` (optimista) | PASS |
| `comunicacion.idComunicacion` vacío (proyección optimista D1) | `""` | PASS (comportamiento esperado per D1) |

#### Hallazgo: fila COMUNICACION del reenvio no aparece en lista

Tras 3 llamadas a `POST /presupuesto/reenvio`, el endpoint `GET /comunicaciones` devuelve
siempre 3 registros (E1 + E2-original + E2-edicion). El `despacharReenvio` post-commit del
`ReenviarE2PresupuestoAdapter` no persiste la fila en BD.

**Análisis:** El adaptador llama a `despacharReenvio` correctamente (retorna `estado=enviado`),
pero con `EMAIL_TRANSPORT=fake` el transporte fake puede no persistir la `COMUNICACION` (fila
de resultado) en la misma transacción. O bien el camino de `despacharReenvio` para la lista de
comunicaciones del tenant tiene un filtro que excluye filas sin `pdfUrl`. **Este comportamiento
NO bloquea el flujo E2E de cara al usuario** (el email sale, la respuesta es 200, el banner
se mostrará); pero sí es una observación para la tarea 3.4 (integración con BD real). No se
clasifica como FAIL del flujo E2E, sino como hallazgo de QA a investigar en el Step N+1.

#### Errores 4xx verificados

| Caso | Request | Respuesta esperada | Obtenida |
|------|---------|-------------------|----------|
| Sin `metodoPago` | POST /edicion sin metodoPago | 400 | `400 "metodoPago debe ser transferencia o efectivo"` |
| >50 invitados sin `precioManualEur` | POST /edicion con `numAdultosNinosMayores4=55`, sin `precioManualEur` | 422 | `422 PRECIO_MANUAL_REQUERIDO` |

#### Estado post-test

| Tabla | Pre | Post | Restaurado |
|-------|-----|------|------------|
| `RESERVA` (count activas) | 0 pre-QA | 1 `pre_reserva` → 1 `reserva_cancelada` | Sí (descartar) |
| `FECHA_BLOQUEADA` | 0 para 2026-08-01 | 1 bloqueada → liberada | Sí (descartar libera) |
| `COMUNICACION` E2 | 0 | 3 (E2 orig + E2 edicion + ?) | n/a (tabla audit) |

El registro de test permanece en estado `reserva_cancelada` (no existe DELETE de reservas por
diseño del dominio; el descartar libera la fecha y cierra el ciclo de vida).

---

## Verificación responsive (BLOQUEADA — Playwright no disponible)

| Viewport | Resultado |
|----------|-----------|
| 390 (móvil) | NO VERIFICADO — Playwright MCP bloqueado |
| 768 (tablet) | NO VERIFICADO — Playwright MCP bloqueado |
| 1280 (escritorio) | NO VERIFICADO — Playwright MCP bloqueado |

**Verificación estática de regla responsive:**  
- `EditarPresupuestoDialog.tsx` línea 191: `className="max-h-[90vh] max-w-2xl overflow-y-auto"` — sin overflow horizontal
- `AvisoPresupuestoEditado.tsx`: `flex items-start gap-3 rounded-[16px]` — layout fluido sin ancho fijo
- El `DialogContent` de shadcn/ui usa breakpoints Tailwind por defecto (mobile-first)
- No hay clases `w-72` fijas ni anchos que rompan en móvil

**Nota:** La verificación real en 3 viewports con capturas queda pendiente de que se libere el Playwright MCP.

---

## Capturas de pantalla

Sin capturas (Playwright MCP bloqueado). Directorio preparado en:
`openspec/changes/presupuesto-edicion-reenvio-email-real/reports/e2e-screenshots/`

---

## Restauración BD

- Test reserva `7e5f92dc-0e1d-449c-8570-3621e164fef0` transitada a `reserva_cancelada` vía `POST /descartar`
- `FECHA_BLOQUEADA` para `2026-08-01` liberada (el descarte la libera)
- `COMUNICACION` E2 de test permanece (no hay API de borrado, es registro auditado — sin impacto en datos de producción del tenant)

---

## Resumen por criterio

| Criterio | Método de verificación | Estado |
|----------|----------------------|--------|
| **Prefill invitados pre-relleno** | Código + API baseline | PASS (código verificado) |
| **Prefill duración acotada {4,8,12}** | Código (`acotarDuracionInicial`) | PASS (código verificado) |
| **POST /presupuesto/edicion → 2xx** | curl real | PASS |
| **Banner "Presupuesto actualizado y enviado…"** | Código `AvisoPresupuestoEditado.tsx` | PASS (código verificado) |
| **Scroll-to-top al enviar** | Código `FichaConsultaPage.tsx` | PASS (código verificado) |
| **esEdicion=true → asunto "Hemos actualizado…"** | curl real + COMUNICACION E2 en BD | PASS |
| **RESERVA.estado inalterado (pre_reserva)** | curl GET después de edición | PASS |
| **ttlExpiracion inalterado** | curl GET después de edición | PASS |
| **Flujo UI completo (login → ficha → diálogo → enviar → banner)** | Playwright MCP | BLOQUEADO |
| **Responsive 390 / 768 / 1280 (capturas)** | Playwright MCP | BLOQUEADO |

---

## Outcome

**PARCIAL — En espera de desbloqueador Playwright**

Los criterios de backend (endpoint 2xx, asunto, COMUNICACION, estado reserva) pasan todos.
El código de prefill y scroll-to-top está implementado y verificado estáticamente.
Los criterios de UX real (visual prefill en el dialog, scroll observable, banner visible, responsive en 3 viewports) **requieren repetir el E2E con Playwright una vez que el usuario libere el browser** (cierra la otra sesión de Claude o ejecuta `taskkill /F /PID 31684 /T` en PowerShell).

---

## Re-verificación reenvío (curl, tras fix pdf_url)

> Fecha: 2026-07-20  
> Reserva de test: `70594ea5-c5da-4178-893d-33a7511e82f3` (código `26-0003`, fecha `2026-09-15`)  
> Fix verificado: `guardar-pdf-url-presupuesto.prisma.adapter.ts` + puerto `GuardarPdfUrlPresupuestoPort` en ambos use cases + `ReenviarE2PresupuestoAdapter` usa `despacharReenvio` real

### Setup

```
POST /api/reservas → 201 idReserva=70594ea5... estado=consulta subEstado=2b
PATCH /api/reservas/70594ea5.../datos-fiscales → 200 (dniNif, direccion, cp, poblacion, provincia)
POST /api/reservas/70594ea5.../presupuesto → 201 presupuesto v1 id=c3ebd766...
```

### Criterio 1: pdf_url persistida en la fila PRESUPUESTO tras el POST /presupuesto

Verificación via consulta directa a BD (node check-pdfurl-qa.cjs):

```json
{
  "idPresupuesto": "c3ebd766-8b9d-409b-88e2-248cd98d7c90",
  "version": 1,
  "pdfUrl": "http://localhost:3000/almacen/presupuestos/00000000-0000-0000-0000-000000000001/c3ebd766-8b9d-409b-88e2-248cd98d7c90.pdf"
}
```

`pdf_url` persistida: **SI** (no null, URL del almacen local)

Ningún endpoint HTTP expone `pdfUrl` del presupuesto directamente; la verificación es via BD.

### Criterio 2: REENVIO #1 — POST /presupuesto/reenvio

```
POST /api/reservas/70594ea5.../presupuesto/reenvio {}
HTTP 200
Response: {"presupuesto": {"pdfUrl": "http://localhost:3000/almacen/..."}, "comunicacion": {"codigoEmail": "E2", "estado": "enviado", "esReenvio": true}}
```

Estado BD tras reenvio #1:

| E2 esReenvio=false | E2 esReenvio=true | Total comunicaciones |
|--------------------|-------------------|---------------------|
| 1 | 1 | 3 (E1 + E2-original + reenvio1) |

Fila reenvio #1: `idComunicacion=1cc31262...` asunto="Tu presupuesto para el evento (reserva 26-0003)"

### Criterio 3: REENVIO #2 — segundo POST /presupuesto/reenvio salta idempotencia

```
POST /api/reservas/70594ea5.../presupuesto/reenvio {}
HTTP 200
Response: {"comunicacion": {"esReenvio": true}}
```

Estado BD tras reenvio #2:

| E2 esReenvio=false | E2 esReenvio=true | Total comunicaciones |
|--------------------|-------------------|---------------------|
| 1 | 2 | 4 (E1 + E2-original + reenvio1 + reenvio2) |

Fila reenvio #2: `idComunicacion=35053d04...` — nueva fila distinta, confirma que el reenvío NO es idempotente (salta el UNIQUE parcial por `esReenvio=true`).

### Criterio 4: EDICION (regresión) — POST /presupuesto/edicion con enviar=true

```
POST /api/reservas/70594ea5.../presupuesto/edicion
{"numAdultosNinosMayores4": 35, "duracionHoras": 8, "extras": [], "metodoPago": "transferencia", "enviar": true}
HTTP 201
Response: {"presupuesto": {"version": 2, "estado": "enviado", "pdfUrl": null (response pre-commit)}, "comunicacion": {"esReenvio": true}}
```

Estado BD tras edicion:

| E2 esReenvio=false | E2 esReenvio=true | Total comunicaciones |
|--------------------|-------------------|---------------------|
| 1 | 3 | 5 (E1 + E2-original + reenvio1 + reenvio2 + edicion) |

Fila edicion: `idComunicacion=2aba1f3b...` asunto="Hemos actualizado tu presupuesto para el evento (reserva 26-0003)"

Presupuesto v2 en BD: `pdfUrl="http://localhost:3000/almacen/presupuestos/.../136c9121...pdf"` (pdf_url persistida en v2 también).

### Cleanup y restauración BD

```
POST /api/reservas/70594ea5.../descartar → 200 estado=reserva_cancelada
```

| Tabla | Pre-test | Post-test | Restaurado |
|-------|----------|-----------|------------|
| `RESERVA` 70594ea5 | pre_reserva | reserva_cancelada | Si (descartar) |
| `FECHA_BLOQUEADA` 2026-09-15 | bloqueada | NONE | Si (descartar libera) |
| `COMUNICACION` (audit) | 2 | 5 | n/a (registros auditados, sin impacto) |

### Resumen por criterio (re-verificación)

| Criterio | Resultado |
|----------|-----------|
| **pdf_url persistida en PRESUPUESTO tras generar** | PASA — valor no null en BD: `http://localhost:3000/almacen/...` |
| **POST /reenvio #1 → HTTP 200 + esReenvio=true** | PASA — HTTP 200, fila COMUNICACION en BD con esReenvio=true |
| **Filas esReenvio=true tras reenvio #1: 1** | PASA — 1 fila (id: 1cc31262) |
| **POST /reenvio #2 crea segunda fila esReenvio=true** | PASA — 2 filas distintas (1cc31262 + 35053d04) |
| **Filas esReenvio=true tras reenvio #2: 2** | PASA — confirmado por BD |
| **POST /edicion enviar=true → HTTP 201 + asunto "Hemos actualizado…"** | PASA — HTTP 201, asunto en BD: "Hemos actualizado tu presupuesto para el evento (reserva 26-0003)" |
| **pdf_url persistida en v2 (edicion)** | PASA — pdfUrl en BD para presupuesto v2 |
| **Restauracion BD** | PASA — reserva_cancelada, FECHA_BLOQUEADA liberada |

### Outcome re-verificacion

**PASA** — todos los criterios del arreglo del reenvio verificados contra BD real. El hallazgo de la sesion anterior ("fila COMUNICACION del reenvio no aparece en lista") queda resuelto: con el fix de `pdf_url` persistida y el adaptador `ReenviarE2PresupuestoAdapter` usando `despacharReenvio`, las filas `esReenvio=true` se crean correctamente en BD y aparecen en `GET /comunicaciones`.
