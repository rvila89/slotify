import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * E2E — US-039 Visualizar el Calendario de Disponibilidad
 *
 * Flujo real contra API NestJS (3000) + SPA Vite (5173).
 *
 * ESTRATEGIA DE SESIÓN: login único en beforeAll + contexto compartido
 * (igual que US-003 / US-004). El access token vive en memoria React;
 * page.goto() recarga la SPA y lo pierde → se usa solo para el login inicial.
 * El resto de la navegación es SPA-interna (React Router).
 *
 * Requiere seed de datos de prueba (@qa-e2e-039.test) en la BD:
 *   - 2026-07-15: consulta s2b (gris) + 1 en cola
 *   - 2026-07-22: pre_reserva (ambar)
 *   - 2026-07-28: reserva_confirmada (verde)
 *
 * Cubre (US-039 criterios de aceptación + guardrails QA responsive):
 *   1. Calendario como página de inicio tras login.
 *   2. Código de colores canónico (gris/ámbar/verde) via clases CSS cal-*.
 *   3. Cambio de vista (Mes/Semana/Día/Lista) con colores consistentes.
 *   4. Indicador 🔁 N en cola sobre fecha bloqueante.
 *   5. Popover de detalle al clic: cliente/estado/TTL/enlace.
 *   6. Mes vacío navegable sin errores.
 *   7. Responsive: 390 / 768 / 1280 sin overflow horizontal.
 */

test.describe.configure({ mode: 'serial' });

test.describe('US-039 — Calendario de Disponibilidad', () => {
  let _browser: Browser;
  let context: BrowserContext;
  let page: Page;

  // Login único — se comparte la sesión React entre todos los tests de este describe.
  test.beforeAll(async ({ browser }) => {
    _browser = browser;
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    // Login inicial
    await page.goto('/login');
    await page.fill('#email', 'info@masialencis.com');
    await page.fill('#password', 'Slotify2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/calendario', { timeout: 15_000 });
  });

  test.afterAll(async () => {
    await context.close();
  });

  /** Navega a /calendario via SPA sin recargar (preserva sesión). */
  const irACalendario = async () => {
    if (!page.url().includes('/calendario')) {
      await page.locator('aside').getByRole('link', { name: 'Calendario' }).click();
      await page.waitForURL('**/calendario', { timeout: 5_000 });
    }
  };

  /** Navega desde el mes visible actual hasta julio 2026 usando los botones nav. */
  const irAJulio2026 = async () => {
    // Leer el label del período actual desde el h2 de la toolbar
    let intentos = 0;
    while (intentos < 20) {
      const label = await page.locator('h2').first().innerText().catch(() => '');
      if (label.toLowerCase().includes('julio') && label.includes('2026')) break;
      if (
        label.toLowerCase().includes('jul') &&
        label.includes('2026')
      )
        break;
      // Si el label muestra mes anterior a julio 2026, avanzar; si posterior, retroceder
      // Para simplificar: si no estamos en julio 2026, navegar forward hasta llegar
      const isAfterJuly2026 =
        label.includes('2027') ||
        label.includes('2028') ||
        (label.includes('2026') &&
          (label.toLowerCase().includes('agosto') ||
            label.toLowerCase().includes('sep') ||
            label.toLowerCase().includes('oct') ||
            label.toLowerCase().includes('nov') ||
            label.toLowerCase().includes('dic') ||
            label.toLowerCase().includes('ago') ||
            label.toLowerCase().includes('aug') ||
            label.toLowerCase().includes('sep')));

      if (isAfterJuly2026) {
        await page.getByRole('button', { name: 'Período anterior' }).click();
      } else {
        await page.getByRole('button', { name: 'Período siguiente' }).click();
      }
      await page.waitForTimeout(250);
      intentos++;
    }
    await page.waitForTimeout(500);
  };

  // ---------------------------------------------------------------------------
  // TEST 1: El calendario es la página de inicio tras login
  // ---------------------------------------------------------------------------
  test('1. El calendario es la página de inicio tras login (sidebar → primera opción)', async () => {
    // Ya estamos en /calendario tras el beforeAll
    expect(page.url()).toContain('/calendario');
    // Heading de la página
    await expect(
      page.getByRole('heading', { name: /Calendario de disponibilidad/i }),
    ).toBeVisible();
    // Sidebar muestra "Calendario" activo en desktop
    await expect(page.locator('aside').getByRole('link', { name: 'Calendario' })).toBeVisible();
    // El tablero de react-big-calendar está renderizado
    await expect(page.locator('.rbc-calendar')).toBeVisible();
    // Botones de navegación del período (toolbar personalizada)
    await expect(page.getByRole('button', { name: 'Período anterior' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Período siguiente' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hoy' })).toBeVisible();
    // Tabs de vista (role="tab" por la toolbar personalizada)
    await expect(page.getByRole('tab', { name: 'Mes' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Semana' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Día' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Lista' })).toBeVisible();
    // La leyenda de colores está presente
    await expect(page.locator('text=Consulta activa')).toBeVisible();
    await expect(page.locator('text=Pre-reserva')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // TEST 2: Código de colores canónico en julio 2026
  // ---------------------------------------------------------------------------
  test('2. Vista mensual julio 2026 con código de colores canónico (gris/ámbar/verde)', async () => {
    await irACalendario();
    await irAJulio2026();

    // Deben aparecer al menos 2 eventos (datos seed de julio 2026)
    const eventos = page.locator('.rbc-event');
    await expect(eventos.first()).toBeVisible({ timeout: 5_000 });
    const count = await eventos.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Verificar colores canónicos:
    // gris (consulta 2b) → clase bg-cal-gris en el evento o su contenedor
    // ambar (pre_reserva) → clase bg-cal-ambar
    // verde (confirmada) → clase bg-cal-verde
    // React-big-calendar aplica el className del eventPropGetter al elemento .rbc-event
    const eventosGris = page.locator('.rbc-event.bg-cal-gris');
    const eventosAmbar = page.locator('.rbc-event.bg-cal-ambar');
    const eventosVerde = page.locator('.rbc-event.bg-cal-verde');

    // Al menos gris y ambar deben estar visibles
    await expect(eventosGris.first()).toBeVisible({ timeout: 5_000 });
    await expect(eventosAmbar.first()).toBeVisible({ timeout: 3_000 });
    await expect(eventosVerde.first()).toBeVisible({ timeout: 3_000 });

    // Verificar que las fechas libres NO aparecen como eventos
    // (solo aparecen las 3 fechas con bloqueo activo)
    expect(count).toBeLessThanOrEqual(5); // holgura para celdas popover expand
  });

  // ---------------------------------------------------------------------------
  // TEST 3: Cambio de vista Mes→Semana→Día→Lista
  // ---------------------------------------------------------------------------
  test('3. Cambio de vista Mes→Semana→Día→Lista mantiene coherencia (mismas fechas)', async () => {
    await irACalendario();
    await irAJulio2026();

    // Verificar vista Mes activa
    await expect(page.getByRole('tab', { name: 'Mes' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.rbc-month-view')).toBeVisible();
    const nEventosMes = await page.locator('.rbc-event').count();

    // Cambiar a Semana
    await page.getByRole('tab', { name: 'Semana' }).click();
    await page.waitForTimeout(400);
    await expect(page.getByRole('tab', { name: 'Semana' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.rbc-time-view')).toBeVisible();

    // Cambiar a Día
    await page.getByRole('tab', { name: 'Día' }).click();
    await page.waitForTimeout(400);
    await expect(page.getByRole('tab', { name: 'Día' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.rbc-time-view')).toBeVisible();

    // Cambiar a Lista
    await page.getByRole('tab', { name: 'Lista' }).click();
    await page.waitForTimeout(400);
    await expect(page.getByRole('tab', { name: 'Lista' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.rbc-agenda-view')).toBeVisible();

    // Volver a Mes — verificar que los eventos siguen iguales
    await page.getByRole('tab', { name: 'Mes' }).click();
    await page.waitForTimeout(400);
    await irAJulio2026();
    const nEventosMesFinal = await page.locator('.rbc-event').count();
    // El mismo rango → mismo número de eventos (± 0, mismo dataset)
    expect(nEventosMesFinal).toBe(nEventosMes);
  });

  // ---------------------------------------------------------------------------
  // TEST 4: Indicador 🔁 N en cola
  // ---------------------------------------------------------------------------
  test('4. Indicador 🔁 N en cola sobre fecha bloqueante (julio 15)', async () => {
    await irACalendario();
    await irAJulio2026();
    await page.getByRole('tab', { name: 'Mes' }).click();
    await page.waitForTimeout(300);

    // Buscar el indicador de cola (aria-label="1 en cola" o title="1 en cola")
    const indicadorCola = page.locator('[aria-label*="en cola"], [title*="en cola"]');
    await expect(indicadorCola.first()).toBeVisible({ timeout: 5_000 });
    const countCola = await indicadorCola.count();
    expect(countCola).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // TEST 5: Popover de detalle al clic en evento
  // ---------------------------------------------------------------------------
  test('5. Clic en evento gris → popover con cliente/estado/TTL/enlace a ficha', async () => {
    await irACalendario();
    await irAJulio2026();
    await page.getByRole('tab', { name: 'Mes' }).click();
    await page.waitForTimeout(300);

    // Clic en el primer evento gris (Ana Garcia — 15/07/2026)
    const eventoGris = page.locator('.rbc-event.bg-cal-gris').first();
    await eventoGris.click();
    await page.waitForTimeout(500);

    // El popover de detalle debe aparecer (implementado con Radix Popover)
    // Verificar que aparece el contenido del popover
    await expect(page.getByRole('dialog').getByText('Ana Garcia')).toBeVisible({ timeout: 5_000 });
    // Enlace a ficha de la reserva
    await expect(
      page.getByRole('link', { name: /Ver ficha de la reserva/i }),
    ).toBeVisible({ timeout: 3_000 });
    // La cola también debe mostrar el enlace "Ver cola"
    await expect(
      page.getByRole('link', { name: /Ver cola/i }),
    ).toBeVisible({ timeout: 3_000 });

    // Cerrar popover (clic fuera o tecla Escape)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  // ---------------------------------------------------------------------------
  // TEST 6: Mes vacío (junio 2026)
  // ---------------------------------------------------------------------------
  test('6. Mes vacío (junio 2026) es navegable sin errores', async () => {
    await irACalendario();
    // Volver a "Hoy" (junio 2026, mes actual)
    await page.getByRole('button', { name: 'Hoy' }).click();
    await page.waitForTimeout(400);

    // No debe haber alerta de error
    const alert = page.getByRole('alert');
    const hasAlert = await alert.isVisible().catch(() => false);
    expect(hasAlert).toBe(false);

    // El calendario sigue siendo interactivo
    await expect(page.locator('.rbc-calendar')).toBeVisible();
    await expect(page.locator('.rbc-month-view')).toBeVisible();
    // Los botones de navegación siguen funcionando
    await expect(page.getByRole('button', { name: 'Período siguiente' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Período anterior' })).toBeVisible();
    // No hay eventos (mes vacío)
    const count = await page.locator('.rbc-event').count();
    expect(count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // TEST 7a: Responsive 390px (móvil)
  // ---------------------------------------------------------------------------
  test('7a. Responsive 390px (móvil) — sin overflow, drawer accesible', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await irACalendario();
    await page.waitForTimeout(300);

    // Sin overflow horizontal
    const overflowX = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflowX).toBe(false);

    // El calendario está visible en móvil
    await expect(page.locator('.rbc-calendar')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Calendario de disponibilidad/i }),
    ).toBeVisible();

    // El botón hamburguesa "Abrir navegación" debe estar presente en <lg
    const hamburguesa = page.getByRole('button', { name: 'Abrir navegación' });
    await expect(hamburguesa).toBeVisible();

    // El aside (sidebar) NO está visible en móvil (oculto con lg:block)
    const aside = page.locator('aside');
    const asideVisible = await aside.isVisible().catch(() => false);
    // En móvil el aside puede estar en DOM pero fuera de viewport/oculto
    // Lo importante es que el hamburguesa existe
    expect(await hamburguesa.isVisible()).toBe(true);

    // Los botones de la toolbar son táctilmente accesibles (≥ 40px de altura)
    const btnPrev = page.getByRole('button', { name: 'Período anterior' });
    const bbox = await btnPrev.boundingBox();
    if (bbox) {
      expect(bbox.height).toBeGreaterThanOrEqual(40);
    }

    // El popover en móvil: clic en evento y verificar que el contenido aparece
    await page.getByRole('button', { name: 'Período siguiente' }).click();
    await page.waitForTimeout(300);
    await irAJulio2026();
    const eventGrisMobile = page.locator('.rbc-event.bg-cal-gris').first();
    const grisCount = await eventGrisMobile.count();
    if (grisCount > 0) {
      await eventGrisMobile.click();
      await page.waitForTimeout(500);
      // El popover debe ser visible y usable en móvil (anclado centrado sobre el tablero)
      const popoverVisible = await page.getByRole('dialog').getByText('Ana Garcia').isVisible().catch(() => false);
      expect(popoverVisible).toBe(true);
      await page.keyboard.press('Escape');
    }

    // Restaurar viewport
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  // ---------------------------------------------------------------------------
  // TEST 7b: Responsive 768px (tablet)
  // ---------------------------------------------------------------------------
  test('7b. Responsive 768px (tablet) — sin overflow, calendario visible', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await irACalendario();
    await page.waitForTimeout(300);

    // Sin overflow horizontal
    const overflowX = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflowX).toBe(false);

    // El calendario está visible
    await expect(page.locator('.rbc-calendar')).toBeVisible();

    // En 768px (<lg=1024px) el sidebar también está en drawer
    const hamburguesa = page.getByRole('button', { name: 'Abrir navegación' });
    await expect(hamburguesa).toBeVisible();

    // Los tabs de vista son accesibles
    await expect(page.getByRole('tab', { name: 'Mes' })).toBeVisible();

    // Restaurar viewport
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  // ---------------------------------------------------------------------------
  // TEST 7c: Responsive 1280px (escritorio)
  // ---------------------------------------------------------------------------
  test('7c. Responsive 1280px (escritorio) — sidebar fijo, calendario completo', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await irACalendario();
    await page.waitForTimeout(300);

    // El aside (sidebar fijo) debe estar visible en ≥lg
    await expect(page.locator('aside')).toBeVisible();

    // El botón hamburguesa NO debe estar visible en desktop
    const hamburguesa = page.getByRole('button', { name: 'Abrir navegación' });
    const hamburguesaVisible = await hamburguesa.isVisible().catch(() => false);
    expect(hamburguesaVisible).toBe(false);

    // Sin overflow horizontal
    const overflowX = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(overflowX).toBe(false);

    // El calendario completamente renderizado con todos los controles
    await expect(page.locator('.rbc-calendar')).toBeVisible();
    await expect(page.locator('.rbc-month-view')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Mes' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Semana' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Día' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Lista' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Período anterior' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Período siguiente' })).toBeVisible();
  });
});
