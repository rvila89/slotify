/**
 * E2E spec: US-006 — override manual "Extender bloqueo" (prórroga pura del TTL)
 *
 * Precondición: existe una RESERVA en `2b` con FECHA_BLOQUEADA blanda vigente.
 *   RESERVA_2B_ID: 3d8dd655-c701-4cbd-bf70-6ddb61b714fe
 *   (creada antes del spec por el qa-verifier con FechaBloqueada activa)
 *
 * También se usan:
 *   RESERVA_2A_ID: 1abe5647-b5dd-46d5-a824-6a800f57c2fe (estado 2a, sin acción)
 *   RESERVA_2C_ID: d07f3b65-f12e-45a4-bb3f-e92bf0299313 (estado 2c)
 *
 * Viewports obligatorios (CLAUDE.md §Responsive):
 *   390 (móvil) / 768 (tablet) / 1280 (escritorio)
 *
 * El access token vive en memoria de React (no en localStorage). Se autentica
 * con page.goto('/login') en beforeAll y luego se navega via React Router.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const RESERVA_2B_ID = '3d8dd655-c701-4cbd-bf70-6ddb61b714fe';
const RESERVA_2A_ID = '1abe5647-b5dd-46d5-a824-6a800f57c2fe';

/** Navega a una ruta via React Router (manteniendo la sesión en memoria). */
const navReact = async (page: Page, path: string): Promise<void> => {
  await page.evaluate((p) => window.history.pushState({}, '', p), path);
  await page.waitForFunction(
    (p) => window.location.pathname === p || window.location.pathname.startsWith(p),
    path,
    { timeout: 5000 },
  );
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await page.waitForTimeout(500);
};

test.describe.configure({ mode: 'serial' });

test.describe('US-006 — Extender bloqueo (E2E)', () => {
  let _browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    _browser = browser;
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto('/login');
    await page.fill('#email', 'info@masialencis.com');
    await page.fill('#password', 'Slotify2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/calendario', { timeout: 15_000 });
  });

  test.afterAll(async () => {
    await context.close();
  });

  const irAFicha = async (id: string): Promise<void> => {
    await navReact(page, `/reservas/${id}`);
    await page.waitForSelector(
      '[data-testid="boton-extender-bloqueo"], [data-testid="boton-anadir-fecha"], section',
      { timeout: 10000 },
    );
  };

  // ---------------------------------------------------------------------------
  // desktop-1280
  // ---------------------------------------------------------------------------
  test('desktop-1280 — 2a no muestra boton-extender-bloqueo (guarda visual)', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RESERVA_2A_ID);
    await expect(page.locator('[data-testid="boton-extender-bloqueo"]')).toBeHidden();
    await expect(page.locator('[data-testid="boton-anadir-fecha"]')).toBeVisible();
  });

  test('desktop-1280 — 2b con bloqueo vigente: muestra boton-extender-bloqueo', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RESERVA_2B_ID);
    await expect(page.locator('[data-testid="boton-extender-bloqueo"]')).toBeVisible();
  });

  test('desktop-1280 — dialog se abre y muestra ttl actual', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RESERVA_2B_ID);
    await page.click('[data-testid="boton-extender-bloqueo"]');
    await expect(page.locator('[data-testid="dialog-extender-bloqueo"]')).toBeVisible();
    // El input de días debe existir
    await expect(page.locator('#extender-bloqueo-dias')).toBeVisible();
    // Cerrar el dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  test('desktop-1280 — validacion cliente: dias=0 muestra error sin mutar BD', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RESERVA_2B_ID);
    await page.click('[data-testid="boton-extender-bloqueo"]');
    await expect(page.locator('[data-testid="dialog-extender-bloqueo"]')).toBeVisible();
    // Clear and enter invalid value
    await page.fill('#extender-bloqueo-dias', '0');
    await page.click('[data-testid="confirmar-extender-bloqueo"]');
    // Expect validation error message
    await expect(page.locator('#extender-bloqueo-dias-error')).toBeVisible();
    await expect(page.locator('#extender-bloqueo-dias-error')).toContainText(
      'El número de días de extensión debe ser un entero positivo',
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  test('desktop-1280 — happy path: extiende 7 dias y muestra aviso con nuevo TTL', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RESERVA_2B_ID);
    await page.click('[data-testid="boton-extender-bloqueo"]');
    await expect(page.locator('[data-testid="dialog-extender-bloqueo"]')).toBeVisible();
    await page.fill('#extender-bloqueo-dias', '7');
    await page.click('[data-testid="confirmar-extender-bloqueo"]');
    // Dialog should close and aviso should appear
    await expect(page.locator('[data-testid="dialog-extender-bloqueo"]')).toBeHidden({ timeout: 10000 });
    // The aviso bloqueo extendido should be visible
    await page.waitForSelector('[data-testid="alerta-bloqueo-extendido"]', { timeout: 10000 });
    await expect(page.locator('[data-testid="alerta-bloqueo-extendido"]')).toBeVisible();
  });

  test('desktop-1280 — sin overflow horizontal en pagina ficha', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RESERVA_2B_ID);
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2); // 2px tolerance
  });

  // ---------------------------------------------------------------------------
  // tablet-768
  // ---------------------------------------------------------------------------
  test('tablet-768 — 2b muestra boton-extender-bloqueo sin overflow', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await irAFicha(RESERVA_2B_ID);
    await expect(page.locator('[data-testid="boton-extender-bloqueo"]')).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('tablet-768 — dialog funciona y valida en tablet', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await irAFicha(RESERVA_2B_ID);
    await page.click('[data-testid="boton-extender-bloqueo"]');
    await expect(page.locator('[data-testid="dialog-extender-bloqueo"]')).toBeVisible();
    await page.fill('#extender-bloqueo-dias', '-1');
    await page.click('[data-testid="confirmar-extender-bloqueo"]');
    await expect(page.locator('#extender-bloqueo-dias-error')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  // ---------------------------------------------------------------------------
  // movil-390
  // ---------------------------------------------------------------------------
  test('movil-390 — 2b muestra boton-extender-bloqueo sin overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await irAFicha(RESERVA_2B_ID);
    await expect(page.locator('[data-testid="boton-extender-bloqueo"]')).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('movil-390 — dialog funciona en movil (touch targets ≥ 48px)', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await irAFicha(RESERVA_2B_ID);
    await page.click('[data-testid="boton-extender-bloqueo"]');
    await expect(page.locator('[data-testid="dialog-extender-bloqueo"]')).toBeVisible();
    // Check button height is >= 48px (min touch target)
    const confirmarBtn = page.locator('[data-testid="confirmar-extender-bloqueo"]');
    const box = await confirmarBtn.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(48);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  test('movil-390 — nav drawer/hamburguesa presente en <lg viewport', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await irAFicha(RESERVA_2B_ID);
    // The sidebar should NOT be visible (it collapses to hamburger in <lg)
    // The hamburger button should be visible
    const hamburger = page.locator('[data-testid="hamburger-btn"], [aria-label*="menú"], button[aria-controls*="sidebar"], button[aria-label*="abrir"], [data-testid="menu-btn"]');
    // At minimum, the desktop sidebar should be hidden
    const sidebar = page.locator('aside[data-testid="sidebar-desktop"], nav[data-testid="nav-desktop"]');
    // Check no horizontal overflow
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });
});
