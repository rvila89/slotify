# Step 8 — E2E Playwright (Pendiente)
**Change:** us-035-registrar-iban-devolucion  
**Date:** 2026-07-09  
**Branch:** feature/us-035-registrar-iban-devolucion  
**Executor:** qa-verifier (claude-sonnet-4-6)

---

## Estado: PENDIENTE — Sin entorno frontend levantable en sesión de subagente

Los tests E2E con Playwright MCP no pudieron ejecutarse en esta sesión por las siguientes razones:

1. **Sin frontend arrancado:** `apps/web` (Vite + React) requiere `pnpm dev` con el servidor de desarrollo corriendo y accesible en un navegador real. La sesión de subagente no dispone de un entorno gráfico con navegador controlable por Playwright MCP.
2. **Backend running pero sin frontend:** el backend se arrancó y se verificó en los tests curl (step 7), pero sin el frontend (puerto 5173) no hay URL navegable para Playwright.
3. **Restricción documentada en MEMORY.md:** los subagentes QA corren sin entorno Docker/Postgres completo y sin capacidad de levantar Playwright en UI mode. Este patrón es el documentado para el proyecto: los tests E2E deben ejecutarse desde la sesión principal.

---

## Plan de ejecución para la sesión principal

### Preparación

```bash
# 1. Arrancar backend (en terminal 1)
cd apps/api
DATABASE_URL="postgresql://user:password@localhost:5432/slotify_test" pnpm dev

# 2. Arrancar frontend (en terminal 2)
cd apps/web
pnpm dev

# 3. Seed de datos de test (ejecutar desde apps/api)
node -e "
const { PrismaClient, DuracionHoras, TipoEvento, CanalEntrada } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: 'postgresql://user:password@localhost:5432/slotify_test' } } });
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CLIENTE_ID = 'e2e035000-0000-0000-0000-000000000001';
const RESERVA_CON_FIANZA_ID = 'e2e035000-0000-0000-0000-000000000002';
const RESERVA_SIN_FIANZA_ID = 'e2e035000-0000-0000-0000-000000000003';
// ... (seed como en step 7 pero con IDs e2e035*)
prisma.\$disconnect();
"
```

### Datos de seed necesarios

Entidades requeridas en `slotify_test`:
- **Cliente QA E2E** (`email: qa-e2e-035@slotify.test`)
- **Reserva A** (`estado: post_evento`, `fianza_eur: 500`) — para Happy Path + FA-01 + FA-02
- **Reserva B** (`estado: post_evento`, `fianza_eur: null`) — para FA-04 (sin fianza)
- **Usuario gestor** ya existente: `info@masialencis.com` / `Slotify2026!`

### Login E2E

```
URL: http://localhost:5173
Email: info@masialencis.com
Password: Slotify2026!
```

Navegar a la ficha de la reserva A (post_evento + fianza > 0).

---

## Escenarios a ejecutar

### §8.2 — Navegar a ficha post-evento con fianza > 0
- `browser_navigate` → `http://localhost:5173`
- Login con gestor
- Navegar a la ficha de Reserva A
- Verificar que aparece la sección "IBAN de devolución de la fianza" (`[aria-labelledby="ficha-iban-devolucion"]`)

### §8.3 — Happy Path: registrar IBAN válido
- `browser_click` → input IBAN (`[data-testid="input-iban"]`)
- `browser_type` → `ES9121000418450200051332`
- `browser_click` → botón "Guardar IBAN" (`[data-testid="guardar-iban"]`)
- Verificar que aparece `[data-testid="aviso-iban-guardado"]` con el IBAN
- Verificar en BD: `cliente.iban_devolucion = 'ES9121000418450200051332'`
- Verificar en BD: `comunicacion` E8 = 1 fila con `estado='enviado'`

### §8.4 — FA-01 IBAN inválido + FA-02 corrección
- FA-01: escribir `ES9999999999999999999999` → guardar → verificar `[data-testid="error-iban"]` visible
- Verificar que NO hay escritura en BD
- FA-02: precargar con el IBAN guardado → corregir a `ES2221000418450201001234` → guardar → verificar nueva confirmación y 2a E8

### §8.5 — FA-04: campo no visible sin fianza
- Navegar a Reserva B (post_evento + fianza_eur = null)
- Verificar que la sección IBAN (`[aria-labelledby="ficha-iban-devolucion"]`) **NO aparece** en el DOM o está deshabilitada

### §8.6 — Responsive en 3 viewports (obligatorio)

#### 390px (móvil)
- `browser_navigate` con viewport 390×844
- Verificar ausencia de overflow horizontal (`document.documentElement.scrollWidth <= 390`)
- Verificar que el input IBAN ocupa ancho completo (`w-full`)
- Verificar que el botón "Guardar IBAN" ocupa ancho completo (`w-full` en móvil)
- Verificar que la navegación lateral colapsa a drawer (hamburger visible, sidebar oculto)
- Registrar snapshot

#### 768px (tablet)
- `browser_navigate` con viewport 768×1024
- Verificar ausencia de overflow horizontal
- Verificar que la navegación lateral colapsa a drawer (`<lg`)
- Registrar snapshot

#### 1280px (escritorio)
- `browser_navigate` con viewport 1280×800
- Verificar que el sidebar es fijo y visible (no drawer)
- Verificar ausencia de overflow horizontal
- Verificar que el botón "Guardar IBAN" tiene `sm:w-auto` (no ocupa ancho completo)
- Registrar snapshot

### §8.7 — Limpieza

```bash
# Eliminar datos de test E2E de la BD:
DELETE FROM comunicacion WHERE reserva_id IN ('e2e035000-...');
DELETE FROM audit_log WHERE entidad_id='e2e035000-...-001';
DELETE FROM reserva WHERE id_reserva IN ('e2e035000-...');
DELETE FROM cliente WHERE id_cliente='e2e035000-...-001';
```

---

## Justificación del diferimiento

Los tests unitarios (step 6: 45/45 PASS) y los tests curl (step 7: todos PASS) validan la lógica de negocio completa. El componente `IbanDevolucionCard.tsx` tiene cobertura de test en `apps/web` (117 tests pasados), incluyendo los atributos `data-testid` necesarios para Playwright. El diferimiento de E2E no bloquea la verificación de lógica de negocio, solo la verificación de integración UI+API+BD y el responsive.

---

## Outcome: PENDIENTE

Los escenarios §8.2–§8.7 quedan **pendientes de ejecución** en la sesión principal con entorno completo (frontend + backend + Playwright MCP). El plan detallado anterior cubre todos los escenarios requeridos por tasks.md §8.
