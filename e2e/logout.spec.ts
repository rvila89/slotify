import { test, expect, type Page } from '@playwright/test';

/**
 * E2E — US-002 Cerrar Sesión
 *
 * Verifica:
 *   1. Logout happy path: "Cerrar sesión" → 204 → redirect /login, app shell
 *      deja de ser visible.
 *   2. Ruta protegida tras logout: navegar por URL a /calendario → guard
 *      RequireAuth redirige a /login sin exponer datos.
 *   3. Edge degradado por red: logout falla en red → sesión igualmente limpiada
 *      en cliente + aviso PERSISTENTE y visible en /login.
 *   4. Responsive (3 viewports): 390 (móvil), 768 (tablet), 1280 (escritorio).
 *      - móvil/tablet (<lg): botón en drawer (hamburguesa).
 *      - escritorio (≥lg): botón en aside fijo, sin hamburguesa.
 *
 * Notas de robustez:
 *   - El sidebar de navegación se localiza con `aside:has(nav)` (la LoginPage tiene
 *     su propio `<aside>` decorativo: `page.locator('aside')` sería ambiguo). Para
 *     comprobar que el shell ya no está, se afirma que el botón "Cerrar sesión" no
 *     existe (es exclusivo del shell autenticado).
 *   - `POST /auth/login` está limitado a 5 intentos/min por (IP+email). Para no
 *     chocar con el 429, esta suite hace ≤4 logins: los dos viewports `<lg`
 *     (móvil + tablet) comparten un único login redimensionando la misma página.
 *
 * Credenciales seed: info@masialencis.com / Slotify2026!
 */

const login = async (page: Page) => {
  await page.goto('/login');
  await page.fill('#email', 'info@masialencis.com');
  await page.fill('#password', 'Slotify2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/calendario', { timeout: 10_000 });
};

// Sidebar de NAVEGACIÓN real (no el `<aside>` decorativo del login).
const sidebar = (page: Page) => page.locator('aside:has(nav)');
const botonCerrarSesion = (page: Page) => page.getByRole('button', { name: /cerrar sesión/i });
const hamburguesa = (page: Page) => page.getByRole('button', { name: /abrir navegación/i });

test.describe('US-002 — Cerrar Sesión', () => {
  test.describe('Happy path — escritorio (1280)', () => {
    test('cerrar sesión redirige a /login y vacía la sesión (sidebar fijo, sin drawer)', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await login(page);

      // Escritorio (≥lg): sidebar fijo visible, sin hamburguesa (cobertura del
      // viewport 1280: "sidebar fijo + sin drawer").
      await expect(sidebar(page)).toBeVisible();
      await expect(hamburguesa(page)).toBeHidden();
      await expect(botonCerrarSesion(page)).toBeVisible();

      // Click cerrar sesión
      await botonCerrarSesion(page).click();

      // Debe redirigir a /login
      await page.waitForURL('**/login', { timeout: 10_000 });
      expect(page.url()).toContain('/login');

      // El app shell ya no está: su botón "Cerrar sesión" no existe en /login.
      await expect(botonCerrarSesion(page)).toBeHidden();
    });

    test('ruta protegida tras logout redirige a /login sin exponer datos', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await login(page);

      // Cerrar sesión
      await botonCerrarSesion(page).click();
      await page.waitForURL('**/login', { timeout: 10_000 });

      // Intentar navegar directamente a /calendario
      await page.goto('/calendario');

      // RequireAuth debe redirigir a /login
      await page.waitForURL('**/login', { timeout: 10_000 });
      expect(page.url()).toContain('/login');

      // No se deben exponer datos de la aplicación autenticada
      await expect(botonCerrarSesion(page)).toBeHidden();
    });

    test('error de red — sesión se limpia igualmente y el aviso persiste en /login', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await login(page);

      // Interceptar /auth/logout para simular fallo de red
      await page.route('**/auth/logout', async (route) => {
        await route.abort('failed');
      });

      await botonCerrarSesion(page).click();

      // Aunque la llamada falla, el frontend limpia la sesión y redirige
      await page.waitForURL('**/login', { timeout: 10_000 });
      expect(page.url()).toContain('/login');

      // El app shell ya no está (sesión limpiada)
      await expect(botonCerrarSesion(page)).toBeHidden();

      // El aviso de modo degradado PERSISTE y es visible en /login (transportado
      // por el `state` de navegación, no en el SidebarContent ya desmontado).
      const aviso = page.getByRole('status');
      await expect(aviso).toBeVisible();
      await expect(aviso).toHaveText(/sesión se ha cerrado en este dispositivo/i);
    });
  });

  test.describe('Responsive — viewports < lg (móvil 390 + tablet 768)', () => {
    test('cerrar sesión desde el drawer funciona en móvil y tablet (login compartido)', async ({
      page,
    }) => {
      // Un único login para ambos viewports `<lg`: se redimensiona la MISMA página
      // (la sesión vive en memoria y se conserva sin recargar) para no agotar el
      // rate-limit de /auth/login.
      await page.setViewportSize({ width: 390, height: 844 });
      await login(page);

      // --- Móvil (390): sidebar fijo oculto, navegación en drawer ---
      await expect(sidebar(page)).toBeHidden();
      await expect(hamburguesa(page)).toBeVisible();
      await hamburguesa(page).click();

      const drawerMovil = page.getByRole('dialog');
      await expect(drawerMovil).toBeVisible();
      await expect(drawerMovil.getByRole('button', { name: /cerrar sesión/i })).toBeVisible();

      // Sin overflow horizontal en móvil
      expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(390);

      // Cerrar el drawer para revalidar en tablet sobre la misma sesión
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();

      // --- Tablet (768): mismo comportamiento `<lg` ---
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(sidebar(page)).toBeHidden();
      await expect(hamburguesa(page)).toBeVisible();
      await hamburguesa(page).click();

      const drawerTablet = page.getByRole('dialog');
      await expect(drawerTablet).toBeVisible();
      const botonDrawer = drawerTablet.getByRole('button', { name: /cerrar sesión/i });
      await expect(botonDrawer).toBeVisible();

      // Sin overflow horizontal en tablet
      expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(768);

      // Cerrar sesión desde el drawer → redirige a /login
      await botonDrawer.click();
      await page.waitForURL('**/login', { timeout: 10_000 });
      expect(page.url()).toContain('/login');
    });
  });
});
