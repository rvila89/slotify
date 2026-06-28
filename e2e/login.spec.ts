import { test, expect } from '@playwright/test';

/**
 * E2E — US-001 Iniciar Sesión
 *
 * Flujo real contra la API NestJS y la SPA Vite.
 * Credenciales seed: info@masialencis.com / Slotify2026!
 *
 * Cubre los tres casos requeridos:
 *   1. Login OK → redirect a /calendario, AppShell activo.
 *   2. Credenciales inválidas → error genérico anti-enumeración, permanece en /login.
 *   3. Validación cliente → campos vacíos / email inválido NO llaman a la API.
 */

test.describe('US-001 — Iniciar Sesión', () => {
  test('login correcto redirige a /calendario con sesión activa', async ({ page }) => {
    await page.goto('/login');

    // Rellenar credenciales seed válidas
    await page.fill('#email', 'info@masialencis.com');
    await page.fill('#password', 'Slotify2026!');
    await page.click('button[type="submit"]');

    // Esperar la navegación al calendario
    await page.waitForURL('**/calendario', { timeout: 10_000 });
    expect(page.url()).toContain('/calendario');

    // AppShell activo: sidebar con marca + al menos un nav link protegido
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Calendario' })).toBeVisible();
  });

  test('credenciales inválidas muestran error genérico y permanecen en /login', async ({
    page,
  }) => {
    await page.goto('/login');

    await page.fill('#email', 'info@masialencis.com');
    await page.fill('#password', 'ContraseñaIncorrecta123!');
    await page.click('button[type="submit"]');

    // Esperar el bloque de alerta de error (role=alert)
    const alerta = page.getByRole('alert');
    await expect(alerta).toBeVisible({ timeout: 10_000 });

    // El mensaje debe ser genérico (anti-enumeración: REQ 3 / FA-01)
    const texto = await alerta.textContent();
    expect(texto).toContain('Credenciales incorrectas');

    // No debe revelar si la cuenta existe o está inactiva
    expect(texto?.toLowerCase()).not.toContain('cuenta no existe');
    expect(texto?.toLowerCase()).not.toContain('email no registrado');
    expect(texto?.toLowerCase()).not.toContain('inactiv');

    // Sigue en /login: sin redirección
    expect(page.url()).toContain('/login');
  });

  test('validación de formulario en cliente — campos vacíos y email inválido no llaman a la API', async ({
    page,
  }) => {
    let apiCalled = false;

    // Interceptar cualquier llamada a /auth/login para detectar si la API es invocada
    await page.route('**/auth/login', async (route) => {
      apiCalled = true;
      // Abortar para que el test falle rápido si la validación no se aplicase
      await route.abort();
    });

    await page.goto('/login');

    // Sub-caso A: enviar formulario vacío
    await page.click('button[type="submit"]');

    await expect(page.getByText('El email es obligatorio')).toBeVisible();
    await expect(page.getByText('La contraseña es obligatoria')).toBeVisible();
    expect(page.url()).toContain('/login');

    // Sub-caso B: email con formato inválido (validación Zod en cliente)
    await page.fill('#email', 'esto-no-es-un-email');
    await page.fill('#password', 'algunacontraseña');
    await page.click('button[type="submit"]');

    await expect(page.getByText('Introduce un email válido')).toBeVisible();
    expect(page.url()).toContain('/login');

    // Confirmar que ningún sub-caso llegó a la API
    expect(apiCalled).toBe(false);
  });
});
