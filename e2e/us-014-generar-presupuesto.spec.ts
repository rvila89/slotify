/**
 * E2E spec: US-014 — Generar presupuesto y activar pre-reserva
 *
 * Precondición: existe una RESERVA semilla en `2b` con cliente con datos
 * fiscales completos, fecha 2027-10-20 (temporada media, 4h, 25 invitados).
 * Tarifa esperada: media/4h/21-25 = 378 EUR.
 *
 * RESERVA E2E ID: e2e00001-0000-0000-0000-000000000002
 * CLIENTE E2E ID: e2e00001-0000-0000-0000-000000000001
 *
 * Viewports obligatorios (CLAUDE.md §Responsive):
 *   390 (móvil) / 768 (tablet) / 1280 (escritorio)
 *
 * Nota: el access token vive en memoria de React (no en localStorage). Se
 * autentica con page.goto('/login') en beforeAll y luego se navega via
 * window.history.pushState (React Router) para mantener el estado de sesión.
 * El mismo patrón usado en us-007-pendiente-invitados.spec.ts.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';

const RESERVA_ID = 'e2e00001-0000-0000-0000-000000000002';

/** Consulta la BD via docker exec (UUIDs fijos — sin riesgo de inyección). */
const queryDB = (sql: string): string =>
  execFileSync('docker', ['exec', 'slotify-postgres', 'psql', '-U', 'user', '-d', 'slotify_dev', '-t', '-c', sql])
    .toString()
    .trim();

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

test.describe('US-014 — Generar presupuesto y activar pre-reserva (E2E)', () => {
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
      '[data-testid="boton-generar-presupuesto"], [data-testid="boton-anadir-fecha"], section',
      { timeout: 10000 },
    );
  };

  // ---------------------------------------------------------------------------
  // desktop-1280: flujo completo + validaciones
  // ---------------------------------------------------------------------------
  test('desktop-1280 — boton-generar-presupuesto visible para reserva 2b', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RESERVA_ID);

    await expect(page.getByTestId('boton-generar-presupuesto')).toBeVisible({ timeout: 8000 });
    const btn = page.getByTestId('boton-generar-presupuesto');
    await expect(btn).not.toBeDisabled();
  });

  test('desktop-1280 — sin overflow horizontal en ficha 2b', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RESERVA_ID);

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);

    // Desktop: sidebar aside es visible
    await expect(page.locator('aside')).toBeVisible();
  });

  test('desktop-1280 — flujo completo: preview borrador → confirmar → pre_reserva', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RESERVA_ID);
    await expect(page.getByTestId('boton-generar-presupuesto')).toBeVisible({ timeout: 8000 });

    // Verificar estado inicial en BD
    const estadoPre = queryDB(
      `SELECT estado FROM reserva WHERE id_reserva = '${RESERVA_ID}'`,
    );
    expect(estadoPre.trim()).toBe('consulta');

    // Click en "Generar presupuesto"
    await page.getByTestId('boton-generar-presupuesto').click();

    // Dialog de borrador debe aparecer con desglose
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('dialog')).toContainText('378');

    // Click Confirmar
    await page.getByTestId('confirmar-presupuesto').click();

    // Confirmación visual (alerta/aviso de pre-reserva activada)
    await expect(page.getByTestId('aviso-presupuesto-confirmado')).toBeVisible({ timeout: 12000 });

    // Verificar persistencia en BD
    const estadoPost = queryDB(
      `SELECT estado FROM reserva WHERE id_reserva = '${RESERVA_ID}'`,
    );
    expect(estadoPost.trim()).toBe('pre_reserva');

    const presupuestoCount = queryDB(
      `SELECT count(*) FROM presupuesto WHERE reserva_id = '${RESERVA_ID}'`,
    );
    expect(parseInt(presupuestoCount)).toBeGreaterThanOrEqual(1);

    const fechaBloqueada = queryDB(
      `SELECT count(*) FROM fecha_bloqueada WHERE reserva_id = '${RESERVA_ID}'`,
    );
    expect(parseInt(fechaBloqueada)).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // mobile-390: responsive
  // ---------------------------------------------------------------------------
  test('mobile-390 — hamburguesa visible, sin overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navReact(page, '/calendario');
    await expect(page.locator('button[aria-label="Abrir navegación"]')).toBeVisible({
      timeout: 8000,
    });

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('mobile-390 — ficha post-pre_reserva sin overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await irAFicha(RESERVA_ID);

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  // ---------------------------------------------------------------------------
  // tablet-768: responsive
  // ---------------------------------------------------------------------------
  test('tablet-768 — hamburguesa visible, sin overflow', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await navReact(page, '/calendario');
    await expect(page.locator('button[aria-label="Abrir navegación"]')).toBeVisible({
      timeout: 8000,
    });

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('tablet-768 — ficha post-pre_reserva sin overflow', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await irAFicha(RESERVA_ID);

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });
});
