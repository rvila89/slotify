import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';

/**
 * E2E — US-025 Cumplimentar ficha operativa del evento
 *
 * Trazabilidad: US-025, UC-20, Módulo M7. data-testids:
 *   ficha-operativa-card, guardar-ficha, abrir-cerrar-ficha,
 *   confirmar-cerrar-ficha (dialog), ficha-guardado-ok,
 *   ficha-no-disponible, ficha-fecha-cierre.
 *
 * Flujos verificados:
 *   A.1 – Ficha operativa visible en reserva_confirmada (card renderiza)
 *   A.2 – Guardar campos parcialmente (preEventoStatus → en_curso)
 *   A.3 – Cerrar ficha (ficha_cerrada=true, fecha cierre visible, estado cerrado)
 *   A.4 – Editar tras cierre (formulario editable, estado sigue cerrado)
 *   A.5 – Reserva en pre_reserva: FichaOperativaCard NO renderiza (filtro parent)
 *   R.*  – Responsive en 3 viewports (390/768/1280) sin overflow
 */

// ---------------------------------------------------------------------------
// Helpers BD — usa execFileSync con docker exec (patrón us-027)
// ---------------------------------------------------------------------------
const queryDB = (sql: string): string =>
  execFileSync('docker', ['exec', 'slotify-postgres', 'psql', '-U', 'user', '-d', 'slotify_dev', '-t', '-c', sql])
    .toString()
    .trim();

const RESERVA_CONF_ID = 'e2e025r001000000000000000001a01';
const RESERVA_PREV_ID = 'e2e025r002000000000000000002b02';
const CLIENTE_ID = 'e2e025c001000000000000000001a01';

const limpiar = (): void => {
  try {
    queryDB(`DELETE FROM audit_log WHERE entidad = 'FICHA_OPERATIVA' AND entidad_id = '${RESERVA_CONF_ID}'`);
    queryDB(`DELETE FROM ficha_operativa WHERE reserva_id IN ('${RESERVA_CONF_ID}', '${RESERVA_PREV_ID}')`);
    queryDB(`DELETE FROM reserva WHERE id_reserva IN ('${RESERVA_CONF_ID}', '${RESERVA_PREV_ID}')`);
    queryDB(`DELETE FROM cliente WHERE id_cliente = '${CLIENTE_ID}'`);
  } catch {
    /* already cleaned */
  }
};

const sembrar = (): void => {
  limpiar();
  queryDB(`
    INSERT INTO cliente (id_cliente, tenant_id, nombre, apellidos, email, fecha_actualizacion)
    VALUES ('${CLIENTE_ID}', '00000000-0000-0000-0000-000000000001',
      'E2E', 'US025', 'e2e025qa@qa.test', NOW())
  `);
  queryDB(`
    INSERT INTO reserva (id_reserva, tenant_id, cliente_id, codigo, estado, canal_entrada,
      fecha_evento, duracion_horas, tipo_evento, num_adultos_ninos_mayores4,
      pre_evento_status, liquidacion_status, fianza_status,
      visita_realizada, cond_part_firmadas, activo, fecha_creacion, fecha_actualizacion)
    VALUES ('${RESERVA_CONF_ID}', '00000000-0000-0000-0000-000000000001', '${CLIENTE_ID}',
      'E2E025CONF01', 'reserva_confirmada', 'email', '2026-12-20', '8', 'boda', 80,
      'pendiente', 'pendiente', 'pendiente', false, false, true, NOW(), NOW())
  `);
  queryDB(`
    INSERT INTO ficha_operativa (id_ficha, reserva_id, ficha_cerrada, fecha_creacion, fecha_actualizacion)
    VALUES ('e2e025f00100000000000000001a01', '${RESERVA_CONF_ID}', false, NOW(), NOW())
  `);
  queryDB(`
    INSERT INTO reserva (id_reserva, tenant_id, cliente_id, codigo, estado, canal_entrada,
      pre_evento_status, liquidacion_status, fianza_status,
      visita_realizada, cond_part_firmadas, activo, fecha_creacion, fecha_actualizacion)
    VALUES ('${RESERVA_PREV_ID}', '00000000-0000-0000-0000-000000000001', '${CLIENTE_ID}',
      'E2E025PREV02', 'pre_reserva', 'email',
      'pendiente', 'pendiente', 'pendiente', false, false, true, NOW(), NOW())
  `);
};

// ---------------------------------------------------------------------------
// navReact — navega dentro de la SPA sin recargar (conserva token en memoria)
// ---------------------------------------------------------------------------
const navReact = async (p: Page, path: string): Promise<void> => {
  await p.evaluate((route) => window.history.pushState({}, '', route), path);
  await p.waitForFunction(
    (route) => window.location.pathname === route || window.location.pathname.startsWith(route),
    path,
    { timeout: 5_000 },
  );
  await p.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await p.waitForTimeout(600);
};

// ---------------------------------------------------------------------------
// Serial tests — shared login session (patrón us-027)
// ---------------------------------------------------------------------------
test.describe.configure({ mode: 'serial' });

test.describe('US-025 — Ficha operativa del evento', () => {
  let _browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    sembrar();

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
    limpiar();
    await context.close();
  });

  // =========================================================================
  // A.1 — Ficha operativa visible en reserva_confirmada
  // =========================================================================
  test('A.1 — ficha-operativa-card se muestra para reserva_confirmada', async () => {
    await navReact(page, `/reservas/${RESERVA_CONF_ID}`);

    const card = page.locator('[data-testid="ficha-operativa-card"]');
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Estado inicial: pendiente
    await expect(card).toHaveAttribute('data-estado', 'pendiente');
    await expect(page.locator('[data-testid="guardar-ficha"]')).toBeVisible();
    await expect(page.locator('[data-testid="abrir-cerrar-ficha"]')).toBeVisible();
  });

  // =========================================================================
  // A.2 — Guardar campos parcialmente → preEventoStatus pasa a en_curso
  // =========================================================================
  test('A.2 — guardar campos parciales dispara pendiente→en_curso', async () => {
    await navReact(page, `/reservas/${RESERVA_CONF_ID}`);
    await page.locator('[data-testid="ficha-operativa-card"]').waitFor({ timeout: 10_000 });

    // Fill invitados field
    const inputInvitados = page.locator('input[name="numInvitadosConfirmado"]');
    await expect(inputInvitados).toBeVisible({ timeout: 5_000 });
    await inputInvitados.fill('75');

    // Submit
    await page.locator('[data-testid="guardar-ficha"]').click();

    // Wait for success feedback
    await expect(page.locator('[data-testid="ficha-guardado-ok"]')).toBeVisible({ timeout: 10_000 });

    // Card data-estado should be en_curso
    const card = page.locator('[data-testid="ficha-operativa-card"]');
    await expect(card).toHaveAttribute('data-estado', 'en_curso', { timeout: 5_000 });

    // Verify DB
    const status = queryDB(`SELECT pre_evento_status FROM reserva WHERE id_reserva = '${RESERVA_CONF_ID}'`);
    expect(status.trim()).toContain('en_curso');
  });

  // =========================================================================
  // A.3 — Cerrar ficha (ficha_cerrada=true, fecha cierre visible, avisos)
  // =========================================================================
  test('A.3 — cerrar ficha muestra fecha de cierre y pasa a cerrado', async () => {
    await navReact(page, `/reservas/${RESERVA_CONF_ID}`);
    await page.locator('[data-testid="ficha-operativa-card"]').waitFor({ timeout: 10_000 });

    // Click "Cerrar ficha" button to open dialog
    const btnCerrar = page.locator('[data-testid="abrir-cerrar-ficha"]');
    await expect(btnCerrar).toBeVisible({ timeout: 10_000 });
    await btnCerrar.click();

    // Wait for dialog to open and click confirm button (data-testid="confirmar-cerrar-ficha")
    const btnConfirmar = page.locator('[data-testid="confirmar-cerrar-ficha"]');
    await expect(btnConfirmar).toBeVisible({ timeout: 5_000 });
    await btnConfirmar.click();

    // Wait for close date to appear
    await expect(page.locator('[data-testid="ficha-fecha-cierre"]')).toBeVisible({ timeout: 10_000 });

    // Card data-estado should be cerrado
    const card = page.locator('[data-testid="ficha-operativa-card"]');
    await expect(card).toHaveAttribute('data-estado', 'cerrado', { timeout: 5_000 });

    // Verify DB: ficha_cerrada=true
    const fichaRow = queryDB(`SELECT ficha_cerrada FROM ficha_operativa WHERE reserva_id = '${RESERVA_CONF_ID}'`);
    expect(fichaRow.trim()).toContain('t'); // true
    // Verify DB: pre_evento_status=cerrado
    const statusRow = queryDB(`SELECT pre_evento_status FROM reserva WHERE id_reserva = '${RESERVA_CONF_ID}'`);
    expect(statusRow.trim()).toContain('cerrado');
  });

  // =========================================================================
  // A.4 — Editar tras cierre (formulario editable, estado sigue cerrado)
  // =========================================================================
  test('A.4 — edición post-cierre persiste y estado sigue cerrado', async () => {
    await navReact(page, `/reservas/${RESERVA_CONF_ID}`);
    await page.locator('[data-testid="ficha-operativa-card"]').waitFor({ timeout: 10_000 });

    // The ficha should be closed from A.3
    const card = page.locator('[data-testid="ficha-operativa-card"]');
    await expect(card).toHaveAttribute('data-estado', 'cerrado', { timeout: 5_000 });

    // Edit a field (should still be editable even when closed)
    const inputInvitados = page.locator('input[name="numInvitadosConfirmado"]');
    await expect(inputInvitados).toBeVisible({ timeout: 5_000 });
    await inputInvitados.fill('95');

    await page.locator('[data-testid="guardar-ficha"]').click();
    await expect(page.locator('[data-testid="ficha-guardado-ok"]')).toBeVisible({ timeout: 10_000 });

    // State should still be cerrado (not reopened)
    await expect(card).toHaveAttribute('data-estado', 'cerrado', { timeout: 5_000 });

    // Verify DB: pre_evento_status still cerrado
    const dbStatus = queryDB(`SELECT pre_evento_status FROM reserva WHERE id_reserva = '${RESERVA_CONF_ID}'`);
    expect(dbStatus.trim()).toContain('cerrado');

    // Verify num_invitados updated to 95
    const fichaRow = queryDB(`SELECT num_invitados_confirmado FROM ficha_operativa WHERE reserva_id = '${RESERVA_CONF_ID}'`);
    expect(fichaRow.trim()).toContain('95');
  });

  // =========================================================================
  // A.5 — Reserva en pre_reserva: FichaOperativaCard NO renderiza
  // =========================================================================
  test('A.5 — pre_reserva: FichaOperativaCard no renderiza (filtro en FichaConsultaPage)', async () => {
    await navReact(page, `/reservas/${RESERVA_PREV_ID}`);
    await page.waitForTimeout(2000);

    // For pre_reserva, the parent (FichaConsultaPage) guards the render:
    // reserva.estado must be in {reserva_confirmada, evento_en_curso, post_evento}
    // So FichaOperativaCard is NOT rendered at all for pre_reserva.
    const fichaCard = page.locator('[data-testid="ficha-operativa-card"]');
    await expect(fichaCard).not.toBeVisible({ timeout: 5_000 });

    // The guardar button should not be present either
    const guardarBtn = page.locator('[data-testid="guardar-ficha"]');
    await expect(guardarBtn).not.toBeVisible({ timeout: 3_000 });
  });

  // =========================================================================
  // R.* — Responsive en 3 viewports (390/768/1280) sin overflow
  // =========================================================================
  const viewports = [
    { nombre: 'movil-390', width: 390, height: 844 },
    { nombre: 'tablet-768', width: 768, height: 1024 },
    { nombre: 'escritorio-1280', width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    test(`R.${vp.nombre} — ficha-operativa-card visible, sin overflow horizontal`, async () => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await navReact(page, `/reservas/${RESERVA_CONF_ID}`);

      const card = page.locator('[data-testid="ficha-operativa-card"]');
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Sin overflow horizontal (tolerancia 2px — patrón us-027)
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);

      // Botón Guardar siempre visible
      await expect(page.locator('[data-testid="guardar-ficha"]')).toBeVisible();

      // En lg+ (≥1024) sidebar visible; en <lg puede estar en drawer
      if (vp.width >= 1024) {
        const sidebar = page.locator('aside');
        await expect(sidebar).toBeVisible();
      }
    });
  }
});
