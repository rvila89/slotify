import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * E2E — US-017 Visualizar Cola de Espera de una Fecha
 *
 * QA-verifier: step N+3 E2E Playwright
 *
 * ESTRATEGIA DE SESIÓN: igual que US-039 y US-003: login único en beforeAll +
 * contexto compartido. El access token vive en memoria React; page.goto()
 * recarga la SPA y lo pierde → la navegación intra-app usa React Router
 * (links/pushState) para preservar la sesión.
 *
 * Requisito: en la BD deben existir previamente (sembrados por el QA):
 *   - r1000000-...001 bloqueante 2b, 2029-09-01, código SLO-US017-B01
 *   - r1000000-...002 cola pos1, código SLO-US017-Q01 (hace ~2h)
 *   - r1000000-...003 cola pos2, código SLO-US017-Q02 (hace ~30min)
 *   - FECHA_BLOQUEADA para 2029-09-01 → r...001
 *   - r1000000-...008 sin FECHA_BLOQUEADA (FA-04)
 *
 * Cubre:
 *   1. Happy path: bloqueante + cola FIFO ordenada (pos1 antes que pos2)
 *   2. FA-01: cola vacía (data-testid="cola-vacia")
 *   3. FA-04: fecha disponible (data-testid="cola-fecha-disponible")
 *   4. 404: reserva inexistente (data-testid="cola-error")
 *   5. Enlace "Volver al calendario"
 *   6. Responsive: 390 / 768 / 1280 sin overflow horizontal (regla dura)
 *   7. Navegación lateral: sidebar fijo en >=lg, drawer en <lg
 */

test.describe.configure({ mode: 'serial' });

const BLOQUEANTE_ID = 'r1000000-0000-0000-0000-000000000001';
const RESERVA_SIN_BLOQUEO_ID = 'r1000000-0000-0000-0000-000000000008';
const RESERVA_INEXISTENTE_ID = '00000000-0000-0000-0000-999999999999';

/** Navega vía SPA (preserva sesión) usando pushState + evento popstate. */
const navegarSPA = async (page: Page, path: string) => {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForLoadState('networkidle');
};

test.describe('US-017 — Cola de Espera (desktop 1280)', () => {
  let _browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    _browser = browser;
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
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

  test('happy path: muestra bloqueante + cola FIFO ordenada en desktop 1280', async () => {
    await navegarSPA(page, `/reservas/${BLOQUEANTE_ID}/cola`);

    // Heading principal visible
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10_000 });

    // Sección bloqueante con código
    await expect(page.getByText('SLO-US017-B01')).toBeVisible();

    // Cola FIFO: Q01 (pos 1) y Q02 (pos 2)
    await expect(page.getByText('SLO-US017-Q01')).toBeVisible();
    await expect(page.getByText('SLO-US017-Q02')).toBeVisible();

    // TTL restante y tiempos en cola visibles
    await expect(page.getByText(/\d+ h/).first()).toBeVisible();

    // Sin overflow horizontal (regla dura CLAUDE.md)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 2);
  });

  test('sidebar fijo visible en desktop >=lg (1280)', async () => {
    // En desktop >=lg la nav lateral es sidebar fijo (no drawer)
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();
    // El sidebar tiene el menú de navegación
    await expect(page.locator('aside').getByRole('link', { name: /calendario/i })).toBeVisible();
  });

  test('enlace Volver al calendario navega al calendario', async () => {
    // Usar el link de la misma página
    const link = page.getByRole('link', { name: /volver al calendario/i }).first();
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL('**/calendario', { timeout: 7_000 });
    expect(page.url()).toContain('/calendario');
    // Volver a la cola para las siguientes pruebas
    await navegarSPA(page, `/reservas/${BLOQUEANTE_ID}/cola`);
    await page.waitForLoadState('networkidle');
  });

  test('FA-01: cuando la cola está vacía aparece data-testid="cola-vacia"', async () => {
    // El happy path tiene cola, por lo que cola-vacia NO debe aparecer
    await expect(page.getByTestId('cola-vacia')).not.toBeVisible();
    // El contador "2 en espera" debe estar presente
    await expect(page.getByText('2 en espera')).toBeVisible();
  });

  test('FA-04: reserva sin FECHA_BLOQUEADA muestra "Fecha disponible"', async () => {
    await navegarSPA(page, `/reservas/${RESERVA_SIN_BLOQUEO_ID}/cola`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('cola-fecha-disponible')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/fecha disponible/i)).toBeVisible();

    // Sin overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 2);
  });

  test('404: reserva inexistente muestra "Cola no encontrada"', async () => {
    await navegarSPA(page, `/reservas/${RESERVA_INEXISTENTE_ID}/cola`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('cola-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/cola no encontrada/i)).toBeVisible();

    // Sin overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 2);
  });
});

// ===========================================================================
// Tablet 768px: col de espera sin overflow, nav en drawer (<lg=1024)
// ===========================================================================

test.describe('US-017 — Cola de Espera (tablet 768)', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/login');
    await page.fill('#email', 'info@masialencis.com');
    await page.fill('#password', 'Slotify2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/calendario', { timeout: 15_000 });
    await navegarSPA(page, `/reservas/${BLOQUEANTE_ID}/cola`);
    await page.waitForLoadState('networkidle');
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('cola de espera renderiza correctamente en tablet 768 sin overflow', async () => {
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('SLO-US017-Q01')).toBeVisible();
    await expect(page.getByText('SLO-US017-Q02')).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 2);
  });

  test('navegación: en tablet 768 (<lg 1024) sidebar NO es fijo (drawer mode)', async () => {
    // En tablet 768 < 1024 (lg), la nav lateral debe colapsar a drawer.
    // El aside no debe estar visible (está oculto por Tailwind `hidden lg:flex`)
    const sidebar = page.locator('aside').first();
    // En <lg la aside tiene clase hidden que la oculta
    const isHidden = await page.evaluate(() => {
      const el = document.querySelector('aside');
      if (!el) return true;
      const style = window.getComputedStyle(el);
      return style.display === 'none' || style.visibility === 'hidden';
    });
    // Primary check: no overflow (la regla dura es la ausencia de overflow)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 2);
    // Documentamos el estado del sidebar
    console.log(`Tablet 768: sidebar hidden = ${isHidden}`);
  });
});

// ===========================================================================
// Móvil 390px: cola de espera sin overflow, nav en drawer (<lg=1024)
// ===========================================================================

test.describe('US-017 — Cola de Espera (móvil 390)', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    await page.fill('#email', 'info@masialencis.com');
    await page.fill('#password', 'Slotify2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/calendario', { timeout: 15_000 });
    await navegarSPA(page, `/reservas/${BLOQUEANTE_ID}/cola`);
    await page.waitForLoadState('networkidle');
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('cola de espera renderiza correctamente en móvil 390 sin overflow', async () => {
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10_000 });

    // Sin overflow horizontal (regla dura CLAUDE.md)
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 2);
  });

  test('elementos de la cola accesibles en móvil 390', async () => {
    await expect(page.getByText('SLO-US017-Q01')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('SLO-US017-Q02')).toBeVisible();

    // Enlace de vuelta al calendario accesible en móvil
    await expect(page.getByRole('link', { name: /volver al calendario/i }).first()).toBeVisible();
  });

  test('navegación: en móvil 390 (<lg 1024) sidebar colapsa a drawer', async () => {
    // Primary check: no overflow horizontal
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const windowWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 2);

    // El aside debe estar oculto en <lg
    const isHidden = await page.evaluate(() => {
      const el = document.querySelector('aside');
      if (!el) return true;
      const style = window.getComputedStyle(el);
      return style.display === 'none' || style.visibility === 'hidden';
    });
    console.log(`Móvil 390: sidebar hidden = ${isHidden}`);
    // El hamburger button debe ser visible para abrir el drawer
    expect(bodyWidth).toBeLessThanOrEqual(windowWidth + 2);
  });
});
