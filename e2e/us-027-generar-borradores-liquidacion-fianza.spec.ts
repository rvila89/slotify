import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';

/**
 * E2E — US-027 Generar borradores de liquidación y fianza
 *
 * Trazabilidad: US-027, UC-21, UC-22, A7. data-testids: documentos-liquidacion-fianza,
 * alerta-documentos-pendientes, factura-borrador-card (data-tipo/data-estado),
 * borrador-numero, borrador-base, borrador-iva, borrador-total,
 * documentos-en-preparacion, documentos-error.
 *
 * El beforeAll siembra datos frescos en slotify_dev (reserva_confirmada + borradores).
 * El afterAll los limpia. Patrón de sesión: access token en memoria React; solo
 * page.goto en el login inicial; resto navReact (history.pushState + popstate).
 * Mismo patrón que us-014-generar-presupuesto.spec.ts.
 *
 * Importes: formatearEuros usa es-ES pero Playwright/Chromium puede no añadir
 * separadores de miles → se valida la parte entera y el signo € para robustez.
 * El invariante contable (base + iva = total) se valida en tests unitarios.
 *
 * Verifica:
 *   A.1–A.6 — Happy path: sección visible + alerta + 2 cards borrador (liq + fianza)
 *   R.*     — Responsive sin overflow en 3 viewports (390/768/1280)
 */

// ---------------------------------------------------------------------------
// Helpers BD — usa execFileSync para evitar inyección de comandos
// ---------------------------------------------------------------------------
const queryDB = (sql: string): string =>
  execFileSync('docker', ['exec', 'slotify-postgres', 'psql', '-U', 'user', '-d', 'slotify_dev', '-t', '-c', sql])
    .toString()
    .trim();

const E2E_RESERVA_ID = 'e2e027res000000000000000000000001';
const E2E_CLIENTE_ID = 'e2e027cli000000000000000000000001';

const limpiarE2E027 = (): void => {
  try {
    queryDB(`DELETE FROM audit_log WHERE entidad = 'FACTURA' AND entidad_id IN (SELECT id_factura FROM factura WHERE reserva_id = '${E2E_RESERVA_ID}')`);
    queryDB(`DELETE FROM audit_log WHERE entidad_id = '${E2E_RESERVA_ID}'`);
    queryDB(`DELETE FROM pago WHERE factura_id IN (SELECT id_factura FROM factura WHERE reserva_id = '${E2E_RESERVA_ID}')`);
    queryDB(`DELETE FROM factura WHERE reserva_id = '${E2E_RESERVA_ID}'`);
    queryDB(`DELETE FROM documento WHERE reserva_id = '${E2E_RESERVA_ID}'`);
    queryDB(`DELETE FROM ficha_operativa WHERE reserva_id = '${E2E_RESERVA_ID}'`);
    queryDB(`DELETE FROM fecha_bloqueada WHERE reserva_id = '${E2E_RESERVA_ID}'`);
    queryDB(`DELETE FROM reserva WHERE id_reserva = '${E2E_RESERVA_ID}'`);
    queryDB(`DELETE FROM cliente WHERE id_cliente = '${E2E_CLIENTE_ID}'`);
  } catch {
    /* already cleaned */
  }
};

const sembrarE2E027 = (): void => {
  limpiarE2E027();
  queryDB(`
    INSERT INTO cliente (id_cliente, tenant_id, nombre, apellidos, email, dni_nif,
      direccion, codigo_postal, poblacion, provincia, fecha_actualizacion)
    VALUES ('${E2E_CLIENTE_ID}', '00000000-0000-0000-0000-000000000001',
      'E2E Test', 'US027 Cliente', 'e2e027@qa.test', '12345678E',
      'C/ E2E 27', '08001', 'Barcelona', 'Barcelona', NOW())
    ON CONFLICT DO NOTHING
  `);
  queryDB(`
    INSERT INTO reserva (id_reserva, tenant_id, cliente_id, codigo, estado, sub_estado,
      canal_entrada, fecha_evento, duracion_horas, tipo_evento,
      num_adultos_ninos_mayores4, num_ninos_menores4,
      importe_total, importe_senal, importe_liquidacion,
      liquidacion_status, fianza_status, pre_evento_status, fecha_actualizacion)
    VALUES ('${E2E_RESERVA_ID}', '00000000-0000-0000-0000-000000000001',
      '${E2E_CLIENTE_ID}', 'E2E-027-001', 'reserva_confirmada', null,
      'web', '2028-09-10', '8', 'boda', 80, 5,
      '6000.00', '2400.00', '3600.00',
      'pendiente', 'pendiente', 'pendiente', NOW())
    ON CONFLICT DO NOTHING
  `);
  queryDB(`
    INSERT INTO fecha_bloqueada (id_bloqueo, tenant_id, fecha, reserva_id, tipo_bloqueo, ttl_expiracion)
    VALUES ('e2e027fb0000000000000000000000001', '00000000-0000-0000-0000-000000000001',
      '2028-09-10', '${E2E_RESERVA_ID}', 'firme', null)
    ON CONFLICT DO NOTHING
  `);
  queryDB(`
    INSERT INTO factura (id_factura, tenant_id, reserva_id, numero_factura, tipo,
      base_imponible, iva_porcentaje, iva_importe, total, concepto, estado,
      fecha_emision, fecha_actualizacion)
    VALUES
      ('e2e027fac0000000000000000000000001', '00000000-0000-0000-0000-000000000001',
       '${E2E_RESERVA_ID}', NULL, 'liquidacion',
       2975.21, 21.00, 624.79, 3600.00, 'Liquidacion reserva E2E-027-001',
       'borrador', NULL, NOW()),
      ('e2e027fac0000000000000000000000002', '00000000-0000-0000-0000-000000000001',
       '${E2E_RESERVA_ID}', NULL, 'fianza',
       413.22, 21.00, 86.78, 500.00, 'Fianza reserva E2E-027-001',
       'borrador', NULL, NOW())
    ON CONFLICT DO NOTHING
  `);
};

// ---------------------------------------------------------------------------
// Navega dentro de la SPA sin recargar (conserva token en memoria React).
// Mismo patrón que us-014-generar-presupuesto.spec.ts.
// ---------------------------------------------------------------------------
const navReact = async (p: Page, path: string): Promise<void> => {
  await p.evaluate((route) => window.history.pushState({}, '', route), path);
  await p.waitForFunction(
    (route) => window.location.pathname === route || window.location.pathname.startsWith(route),
    path,
    { timeout: 5_000 },
  );
  await p.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await p.waitForTimeout(500);
};

// ---------------------------------------------------------------------------
// Serial tests — shared login session
// ---------------------------------------------------------------------------
test.describe.configure({ mode: 'serial' });

test.describe('US-027 — Borradores de liquidación y fianza en ficha de reserva confirmada', () => {
  let _browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    sembrarE2E027();

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
    limpiarE2E027();
    await context.close();
  });

  // ---------------------------------------------------------------------------
  // Escenario A — Happy path: liquidación + fianza
  // ---------------------------------------------------------------------------

  test('A.1 — navega a ficha de reserva confirmada y la sección Documentos de liquidación y fianza es visible', async () => {
    await navReact(page, `/reservas/${E2E_RESERVA_ID}`);
    const seccion = page.getByTestId('documentos-liquidacion-fianza');
    await expect(seccion).toBeVisible({ timeout: 10_000 });
  });

  test('A.2 — muestra la alerta Documentos de liquidación y fianza pendientes de revisión', async () => {
    const alerta = page.getByTestId('alerta-documentos-pendientes');
    await expect(alerta).toBeVisible();
    await expect(alerta).toContainText(/liquidaci/i);
  });

  test('A.3 — muestra exactamente 2 cards de borrador (liquidación y fianza)', async () => {
    const cards = page.getByTestId('factura-borrador-card');
    await expect(cards).toHaveCount(2);
  });

  test('A.4 — card de liquidación tiene data-tipo=liquidacion, data-estado=borrador, numero pendiente', async () => {
    const liqCard = page.locator('[data-testid="factura-borrador-card"][data-tipo="liquidacion"]');
    await expect(liqCard).toBeVisible();
    await expect(liqCard).toHaveAttribute('data-estado', 'borrador');
    const numero = liqCard.getByTestId('borrador-numero');
    await expect(numero).toContainText(/sin número|pendiente de emisión/i);
  });

  test('A.5 — card de liquidación muestra total 3600 y desglose fiscal (base 2975, iva 624)', async () => {
    // Validamos la parte entera y el símbolo € independientemente del formato de miles
    // que use el Chromium de Playwright (puede diferir del sistema host).
    // Invariante contable (base + iva = total) está garantizado por los tests unitarios.
    const liqCard = page.locator('[data-testid="factura-borrador-card"][data-tipo="liquidacion"]');
    const total = liqCard.getByTestId('borrador-total');
    await expect(total).toContainText('3600');
    await expect(total).toContainText('€');
    const base = liqCard.getByTestId('borrador-base');
    await expect(base).toContainText('2975');
    await expect(base).toContainText('€');
    const iva = liqCard.getByTestId('borrador-iva');
    await expect(iva).toContainText('624');
    await expect(iva).toContainText('€');
  });

  test('A.6 — card de fianza tiene data-tipo=fianza, data-estado=borrador, total 500', async () => {
    const fianzaCard = page.locator('[data-testid="factura-borrador-card"][data-tipo="fianza"]');
    await expect(fianzaCard).toBeVisible();
    await expect(fianzaCard).toHaveAttribute('data-estado', 'borrador');
    const total = fianzaCard.getByTestId('borrador-total');
    await expect(total).toContainText('500');
    await expect(total).toContainText('€');
  });

  // ---------------------------------------------------------------------------
  // Responsive — 3 viewports sin overflow horizontal
  // ---------------------------------------------------------------------------

  const viewports = [
    { nombre: 'movil-390', width: 390, height: 844 },
    { nombre: 'tablet-768', width: 768, height: 1024 },
    { nombre: 'escritorio-1280', width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    test(`R.${vp.nombre} — sin overflow horizontal y sección visible`, async () => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await navReact(page, `/reservas/${E2E_RESERVA_ID}`);

      const seccion = page.getByTestId('documentos-liquidacion-fianza');
      await expect(seccion).toBeVisible({ timeout: 10_000 });

      // Sin overflow horizontal (tolerancia 2px)
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    });
  }
});
