import { test, expect, type Page } from '@playwright/test';

/**
 * E2E — App Shell responsive (regla dura: web responsive obligatorio).
 *
 * Verifica la navegación del shell autenticado en 3 viewports:
 *   - 390  (móvil):  sidebar oculto; hamburguesa visible; abre drawer y navega.
 *   - 768  (tablet): mismo comportamiento `< lg`.
 *   - 1280 (escritorio): sidebar fijo visible; sin hamburguesa.
 *
 * Reutiliza el login real seed (info@masialencis.com / Slotify2026!) para
 * alcanzar el área autenticada (/calendario). Flujo de solo navegación: no muta BD.
 */

const iniciarSesion = async (page: Page) => {
  await page.goto('/login');
  await page.fill('#email', 'info@masialencis.com');
  await page.fill('#password', 'Slotify2026!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/calendario', { timeout: 10_000 });
};

test.describe('App Shell responsive', () => {
  test('móvil (390): sidebar oculto, hamburguesa abre el drawer y navega', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await iniciarSesion(page);

    // El sidebar fijo NO es visible en móvil (hidden lg:flex).
    await expect(page.locator('aside')).toBeHidden();

    // El hamburguesa SÍ es visible.
    const hamburguesa = page.getByRole('button', { name: 'Abrir navegación' });
    await expect(hamburguesa).toBeVisible();

    // Abre el drawer (Radix Dialog) y navega a Reservas desde dentro.
    await hamburguesa.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Reservas' }).click();

    await page.waitForURL('**/reservas', { timeout: 10_000 });
    expect(page.url()).toContain('/reservas');
    // El drawer se cierra tras navegar.
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('tablet (768): mismo comportamiento < lg (hamburguesa visible, sidebar oculto)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await iniciarSesion(page);

    await expect(page.locator('aside')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Abrir navegación' })).toBeVisible();
  });

  test('escritorio (1280): sidebar fijo visible y sin hamburguesa', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await iniciarSesion(page);

    await expect(page.locator('aside')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Calendario' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir navegación' })).toBeHidden();
  });
});
