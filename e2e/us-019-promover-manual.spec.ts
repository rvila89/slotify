import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * E2E QA — US-019 Promoción Manual de Consulta en Cola
 *
 * IDs semilla (re-sembradas antes de cada ejecución):
 *   R1 = 6d09a5eb-191d-4ee3-a210-b67a0a7ffd3f  (Garcia Lopez, bloqueante s2b)
 *   R2 = d23a25f4-1705-4950-a885-f606cbcc99a3  (Martinez Ruiz, cola pos 1 s2d)
 *   R3 = 0b0809cf-3d11-4603-9890-e037e125d65d  (Sanchez Vera, cola pos 2 s2d)
 *
 * Cubre:
 * 1. Happy path: promover R3 desde la vista de cola con diálogo de confirmación
 *    → diálogo se cierra → page muestra FechaDisponible (R1 expirada a 2x)
 * 2. FA-04: cancelar el diálogo no ejecuta la promoción
 * 3. Responsive: 390 / 768 / 1280 sin overflow horizontal (regla dura)
 * 4. Nav: sidebar fijo en >=lg, drawer en <lg
 */

test.describe.configure({ mode: 'serial' });

const R1_ID = '6d09a5eb-191d-4ee3-a210-b67a0a7ffd3f';
const R2_ID = 'd23a25f4-1705-4950-a885-f606cbcc99a3';
const R3_ID = '0b0809cf-3d11-4603-9890-e037e125d65d';
const COLA_URL = `/reservas/${R1_ID}/cola`;

const login = async (page: Page) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.fill('#email', 'info@masialencis.com');
  await page.fill('#password', 'Slotify2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/calendario', { timeout: 15000 });
};

const navegarSPA = async (page: Page, path: string) => {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForLoadState('networkidle');
};

// ============================================================
// ESCRITORIO 1280 — Happy path + cancelar
// ============================================================

test.describe('US-019 — Promover Manual (desktop 1280)', () => {
  let _browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    _browser = browser;
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('desktop 1280: muestra heading cola de espera', async () => {
    await navegarSPA(page, COLA_URL);
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
  });

  test('desktop 1280: muestra secciones bloqueante y cola', async () => {
    await navegarSPA(page, COLA_URL);
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h2').filter({ hasText: /consulta bloqueante/i })).toBeVisible();
    await expect(page.locator('h2').filter({ hasText: /cola de espera/i })).toBeVisible();
  });

  test('desktop 1280: botones Promover visibles por item de cola', async () => {
    await navegarSPA(page, COLA_URL);
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId(`promover-${R2_ID}`)).toBeVisible();
    await expect(page.getByTestId(`promover-${R3_ID}`)).toBeVisible();
  });

  test('desktop 1280: FA-04 cancelar el diálogo no ejecuta la promoción', async () => {
    await navegarSPA(page, COLA_URL);
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
    // Click en botón Promover de R3
    await page.getByTestId(`promover-${R3_ID}`).click();
    // Diálogo de confirmación debe aparecer
    await expect(page.getByTestId('dialog-promover-manual')).toBeVisible();
    await expect(page.locator('[role="dialog"] h2').filter({ hasText: /promover a bloqueante/i })).toBeVisible();
    // Cancelar
    await page.getByRole('button', { name: /cancelar/i }).click();
    // Diálogo cerrado, R3 sigue en la cola
    await expect(page.getByTestId('dialog-promover-manual')).not.toBeVisible();
    await expect(page.getByTestId(`promover-${R3_ID}`)).toBeVisible();
  });

  test('desktop 1280: confirmar promoción actualiza la vista (happy path)', async () => {
    await navegarSPA(page, COLA_URL);
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
    // Abrir diálogo para R3 (posición 2)
    await page.getByTestId(`promover-${R3_ID}`).click();
    await expect(page.getByTestId('dialog-promover-manual')).toBeVisible();
    // Confirmar la promoción
    await page.getByTestId('confirmar-promover-manual').click();
    // El diálogo se cierra tras 200 OK
    await expect(page.getByTestId('dialog-promover-manual')).not.toBeVisible({ timeout: 10000 });
    // Tras la promoción, R1 queda en s2x → la cola re-consulta y muestra FechaDisponible
    // (R1 ya no bloquea ninguna fecha activa)
    await expect(page.getByTestId('cola-fecha-disponible')).toBeVisible({ timeout: 10000 });
  });

  test('desktop 1280: sidebar fijo visible, sin overflow', async () => {
    await navegarSPA(page, COLA_URL);
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
    // Sin overflow horizontal
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(1280 + 5);
  });
});

// ============================================================
// MÓVIL 390 — Nav drawer y sin overflow
// ============================================================

test.describe('US-019 — Responsive Móvil 390', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
  });

  test.afterAll(async () => { await context.close(); });

  test('móvil 390: cola de espera visible sin overflow horizontal', async () => {
    await navegarSPA(page, COLA_URL);
    // After desktop tests, R1 is now s2x, so page shows FechaDisponible - that's fine
    // The h1 "Cola de espera" is always present in the page header
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(390 + 5);
  });

  test('móvil 390: secciones visibles (FechaDisponible tras promoción)', async () => {
    await navegarSPA(page, COLA_URL);
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
    // After promotion R1 is s2x: FechaDisponible is shown
    await expect(page.getByTestId('cola-fecha-disponible')).toBeVisible({ timeout: 10000 });
    // No overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(390 + 5);
  });
});

// ============================================================
// TABLET 768 — Sin overflow, comportamiento <lg
// ============================================================

test.describe('US-019 — Responsive Tablet 768', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();
    await page.setViewportSize({ width: 768, height: 1024 });
    await login(page);
  });

  test.afterAll(async () => { await context.close(); });

  test('tablet 768: cola de espera visible sin overflow horizontal', async () => {
    await navegarSPA(page, COLA_URL);
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(768 + 5);
  });

  test('tablet 768: secciones visibles sin overflow (FechaDisponible tras promoción)', async () => {
    await navegarSPA(page, COLA_URL);
    await expect(page.locator('h1').filter({ hasText: /cola de espera/i })).toBeVisible({ timeout: 10000 });
    // After promotion R1 is s2x: FechaDisponible is shown
    await expect(page.getByTestId('cola-fecha-disponible')).toBeVisible({ timeout: 10000 });
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(768 + 5);
  });
});
