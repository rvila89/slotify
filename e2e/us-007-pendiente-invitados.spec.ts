/**
 * E2E spec: US-007 — transición 2b → 2c "Marcar como pendiente de invitados"
 *
 * Precondición: existe una RESERVA semilla en `2b` con FECHA_BLOQUEADA activa
 * y 1 RESERVA en cola (2d) apuntando a ella. Creada por el qa-verifier antes de
 * ejecutar este spec y limpiada por el qa-verifier en afterAll.
 *
 * BLOQUEANTE_ID: 9e8b1384-db02-47d0-a82d-af80217d1dcb
 *   (RESERVA en s2b, fecha 2027-09-20, TTL vigente, 1 entrada en cola s2d)
 *
 * Viewports obligatorios (CLAUDE.md §Responsive):
 *   390 (móvil) / 768 (tablet) / 1280 (escritorio)
 *
 * Nota: el access token vive en memoria de React (no en localStorage). Se
 * autentica con page.goto('/login') en beforeAll y luego se navega via
 * window.history.pushState (React Router) para mantener el estado de sesión.
 * El mismo patrón usado en us-004-alta-consulta-con-fecha.spec.ts.
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';

const BLOQUEANTE_ID = '9e8b1384-db02-47d0-a82d-af80217d1dcb';
const RES_2A_ID = '1abe5647-b5dd-46d5-a824-6a800f57c2fe';

/** Consulta la BD via docker exec (sin shell, UUIDs fijos — sin riesgo de inyección). */
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

test.describe('US-007 — Marcar como pendiente de invitados (E2E)', () => {
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
      '[data-testid="boton-pendiente-invitados"], [data-testid="boton-anadir-fecha"], section',
      { timeout: 10000 },
    );
  };

  // ---------------------------------------------------------------------------
  // desktop-1280
  // ---------------------------------------------------------------------------
  test('desktop-1280 — 2a no muestra boton-pendiente-invitados (guarda visual)', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(RES_2A_ID);

    await expect(page.getByTestId('boton-anadir-fecha')).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('boton-pendiente-invitados')).not.toBeVisible();
  });

  test('desktop-1280 — no horizontal overflow en ficha 2b', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(BLOQUEANTE_ID);

    await expect(page.getByTestId('boton-pendiente-invitados')).toBeVisible({ timeout: 8000 });

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);

    // Desktop: sidebar aside is visible (not hidden)
    await expect(page.locator('aside')).toBeVisible();
  });

  test('desktop-1280 — flujo completo 2b→2c con cola activa, feedback y persistencia', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irAFicha(BLOQUEANTE_ID);
    await expect(page.getByTestId('boton-pendiente-invitados')).toBeVisible({ timeout: 8000 });

    const subEstadoPre = queryDB(
      `SELECT sub_estado FROM reserva WHERE id_reserva = '${BLOQUEANTE_ID}'`,
    );
    expect(subEstadoPre).toBe('s2b');

    await page.getByTestId('boton-pendiente-invitados').click();
    await expect(page.getByTestId('dialog-pendiente-invitados')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('dialog-pendiente-invitados')).toContainText('cola');

    await page.getByTestId('confirmar-pendiente-invitados').click();

    await expect(page.getByTestId('alerta-pendiente-invitados')).toBeVisible({ timeout: 12000 });
    await expect(page.getByTestId('alerta-pendiente-invitados')).toContainText('vigente');
    await expect(page.getByTestId('alerta-pendiente-invitados')).toContainText('1 consulta');

    await expect(page.getByTestId('boton-pendiente-invitados')).not.toBeVisible();

    // BD verification
    const subEstadoPost = queryDB(
      `SELECT sub_estado FROM reserva WHERE id_reserva = '${BLOQUEANTE_ID}'`,
    );
    expect(subEstadoPost).toBe('s2c');

    const colaVaciada = queryDB(
      `SELECT count(*) FROM reserva WHERE consulta_bloqueante_id = '${BLOQUEANTE_ID}' AND sub_estado = 's2d'`,
    );
    expect(colaVaciada).toBe('0');

    const comunicaciones = queryDB(
      `SELECT count(*) FROM comunicacion WHERE reserva_id = '${BLOQUEANTE_ID}'`,
    );
    expect(comunicaciones).toBe('0');

    const auditCount = queryDB(
      `SELECT count(*) FROM audit_log WHERE entidad_id = '${BLOQUEANTE_ID}' AND accion = 'transicion'`,
    );
    expect(parseInt(auditCount)).toBeGreaterThanOrEqual(1);

    // Persistencia: volver a la ficha → sigue en 2c (sin boton-pendiente-invitados)
    await irAFicha(BLOQUEANTE_ID);
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('boton-pendiente-invitados')).not.toBeVisible({ timeout: 6000 });
    await expect(page.locator('section').filter({ hasText: 'Acciones' })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // mobile-390: responsive — navReact mantiene la sesión en memoria
  // ---------------------------------------------------------------------------
  test('mobile-390 — hamburguesa visible, sin overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navReact(page, '/calendario');
    // Hamburger is shown at <lg with lg:hidden; wait for it directly
    await expect(page.locator('button[aria-label="Abrir navegación"]')).toBeVisible({
      timeout: 8000,
    });

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('mobile-390 — ficha 2a sin overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await irAFicha(RES_2A_ID);

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('mobile-390 — ficha 2c post-transicion sin overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await irAFicha(BLOQUEANTE_ID);
    // After transition to 2c, section "Acciones" should be visible with "no actions" message
    await expect(page.locator('section').filter({ hasText: 'Acciones' })).toBeVisible({
      timeout: 8000,
    });

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  // ---------------------------------------------------------------------------
  // tablet-768: responsive — navReact mantiene la sesión en memoria
  // ---------------------------------------------------------------------------
  test('tablet-768 — hamburguesa visible, sin overflow', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await navReact(page, '/calendario');
    // Hamburger is shown at <lg with lg:hidden; wait for it directly
    await expect(page.locator('button[aria-label="Abrir navegación"]')).toBeVisible({
      timeout: 8000,
    });

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('tablet-768 — ficha 2a sin overflow', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await irAFicha(RES_2A_ID);

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.body.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });
});
