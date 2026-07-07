/**
 * E2E QA — US-030 Registrar cobro de fianza
 * Ejecutado por qa-verifier. Reserva E2E: e2e00030-0000-0000-0000-000000000002
 * Requiere backend (3000) y frontend (5173) activos y datos sembrados en slotify_dev.
 *
 * Patrón de sesión: login en beforeAll con contexto compartido, navReact para
 * navegación sin reload (igual que us-027 / us-014).
 *
 * Importe: el form usa notación europea (coma decimal). '1500,00' → aImporte → '1500.00'.
 * data-testids importantes:
 *   - dialog-registrar-cobro-fianza: el diálogo
 *   - input-importe-fianza: campo importe
 *   - input-fecha-cobro: campo fecha
 *   - confirmar-cobro-fianza: botón submit del formulario
 *   - cancelar-cobro-fianza: botón cancelar del formulario
 *   - confirmacion-negociable: panel de confirmación Negociable
 *   - cancelar-negociable: cancelar en vista Negociable
 *   - confirmar-negociable: confirmar en vista Negociable
 *   - accion-registrar-cobro-fianza: botón en AccionesFacturacion
 */
import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';

// ---------------------------------------------------------------------------
// Helpers BD
// ---------------------------------------------------------------------------
const queryDB = (sql: string): string =>
  execFileSync('docker', ['exec', 'slotify-postgres', 'psql', '-U', 'user', '-d', 'slotify_dev', '-t', '-c', sql])
    .toString()
    .trim();

const E2E_RESERVA_ID = 'e2e00030-0000-0000-0000-000000000002';
const E2E_FACTURA_ID = 'e2e00030-0000-0000-0000-000000000003';
const E2E_CLIENTE_ID = 'e2e00030-0000-0000-0000-000000000001';

const resetearEstadoReserva = (): void => {
  try {
    queryDB(`DELETE FROM pago WHERE factura_id = '${E2E_FACTURA_ID}'`);
    queryDB(`DELETE FROM audit_log WHERE entidad_id IN ('${E2E_RESERVA_ID}', '${E2E_FACTURA_ID}')`);
    queryDB(`UPDATE factura SET estado = 'enviada' WHERE id_factura = '${E2E_FACTURA_ID}'`);
    queryDB(`UPDATE reserva SET fianza_status = 'recibo_enviado', fianza_eur = NULL, fianza_cobrada_fecha = NULL WHERE id_reserva = '${E2E_RESERVA_ID}'`);
  } catch {
    /* ignore */
  }
};

const limpiarTodo = (): void => {
  try {
    queryDB(`DELETE FROM pago WHERE factura_id = '${E2E_FACTURA_ID}'`);
    queryDB(`DELETE FROM audit_log WHERE entidad_id IN ('${E2E_RESERVA_ID}', '${E2E_FACTURA_ID}')`);
    queryDB(`DELETE FROM documento WHERE reserva_id = '${E2E_RESERVA_ID}'`);
    queryDB(`DELETE FROM factura WHERE id_factura = '${E2E_FACTURA_ID}'`);
    queryDB(`DELETE FROM reserva WHERE id_reserva = '${E2E_RESERVA_ID}'`);
    queryDB(`DELETE FROM cliente WHERE id_cliente = '${E2E_CLIENTE_ID}'`);
  } catch {
    /* ignore */
  }
};

const sembrarDatos = (): void => {
  limpiarTodo();
  queryDB(`
    INSERT INTO cliente (id_cliente, tenant_id, nombre, apellidos, email, telefono, dni_nif,
      direccion, codigo_postal, poblacion, provincia, fecha_actualizacion)
    VALUES ('${E2E_CLIENTE_ID}', '00000000-0000-0000-0000-000000000001',
      'Ana', 'Martínez', 'ana.martinez@e2e030.test', '611222333', '22222222B',
      'Av. Test 100', '08010', 'Barcelona', 'Barcelona', NOW())`);
  queryDB(`
    INSERT INTO reserva (id_reserva, tenant_id, cliente_id, codigo, estado, canal_entrada,
      fecha_evento, duracion_horas, tipo_evento, num_adultos_ninos_mayores4,
      importe_total, importe_senal, importe_liquidacion, liquidacion_status, fianza_status, fecha_actualizacion)
    VALUES ('${E2E_RESERVA_ID}', '00000000-0000-0000-0000-000000000001',
      '${E2E_CLIENTE_ID}', 'E2E-030-TEST', 'reserva_confirmada', 'web',
      '2032-05-20', '8', 'boda', 40, '7000.00', '2800.00', '4200.00',
      'cobrada', 'recibo_enviado', NOW())`);
  queryDB(`
    INSERT INTO factura (id_factura, tenant_id, reserva_id, numero_factura, tipo, estado,
      total, base_imponible, iva_porcentaje, iva_importe, pdf_url, fecha_emision, fecha_actualizacion)
    VALUES ('${E2E_FACTURA_ID}', '00000000-0000-0000-0000-000000000001',
      '${E2E_RESERVA_ID}', 'FZ-E2E-030', 'fianza', 'enviada',
      '1500.00', '1500.00', '0.00', '0.00',
      'https://storage.local/facturas/fianza-e2e030.pdf', '2032-01-10', NOW())`);
};

// ---------------------------------------------------------------------------
// navReact helper (token en memoria React — sin reload)
// ---------------------------------------------------------------------------
const navReact = async (p: Page, path: string): Promise<void> => {
  await p.evaluate((route) => window.history.pushState({}, '', route), path);
  await p.waitForFunction(
    (route) => window.location.pathname === route || window.location.pathname.startsWith(route),
    path,
    { timeout: 5_000 },
  );
  await p.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await p.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {/* ok */});
};

/**
 * Navega a /reservas y de vuelta a la ficha para forzar re-fetch del estado.
 * Necesario cuando cambiamos la BD por fuera de la UI (TanStack Query cache).
 */
const renavigar = async (p: Page): Promise<void> => {
  await navReact(p, '/reservas');
  await p.waitForTimeout(400);
  await navReact(p, `/reservas/${E2E_RESERVA_ID}`);
};

/** Rellena y envía el formulario de cobro de fianza con notación europea (coma decimal) */
const rellenarYEnviarFormulario = async (
  p: Page,
  opts: { importe: string; fecha: string },
): Promise<void> => {
  await p.getByTestId('input-importe-fianza').fill(opts.importe);
  await p.getByTestId('input-fecha-cobro').fill(opts.fecha);
  await p.getByTestId('confirmar-cobro-fianza').click();
};

// ---------------------------------------------------------------------------
// Suite E2E
// ---------------------------------------------------------------------------
test.describe.configure({ mode: 'serial' });

test.describe('US-030 QA — Registrar cobro de fianza (E2E)', () => {
  let _browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    sembrarDatos();

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
    limpiarTodo();
    await context.close();
  });

  // ---------------------------------------------------------------------------
  // 8.1 — Navegar a ficha de reserva y verificar botón presente
  // ---------------------------------------------------------------------------
  test('8.1 — ficha de reserva confirmada carga la sección de facturación con botón de cobro', async () => {
    await navReact(page, `/reservas/${E2E_RESERVA_ID}`);

    // Section DocumentosLiquidacionFianza visible
    const seccion = page.locator(
      '[data-testid="documentos-liquidacion-fianza"], [data-testid="documentos-en-preparacion"]',
    );
    await expect(seccion.first()).toBeVisible({ timeout: 10_000 });

    // "Registrar cobro de fianza" button present and enabled
    const btnCobro = page.getByTestId('accion-registrar-cobro-fianza');
    await expect(btnCobro).toBeVisible({ timeout: 7_000 });
    await expect(btnCobro).toBeEnabled();
  });

  // ---------------------------------------------------------------------------
  // 8.2 — Happy path: registrar cobro, verificar estado cobrada en UI + BD
  // ---------------------------------------------------------------------------
  test('8.2 — happy path: abrir formulario, registrar cobro, verificar cobrada en UI y BD', async () => {
    const btnCobro = page.getByTestId('accion-registrar-cobro-fianza');
    await expect(btnCobro).toBeVisible();
    await btnCobro.click();

    // Dialog opens with correct testid
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).toBeVisible({ timeout: 5_000 });

    // Fill form — importe in European format (coma = comma decimal), fecha <= fechaEvento (2032-05-20)
    await rellenarYEnviarFormulario(page, { importe: '1500,00', fecha: '2032-04-10' });

    // After successful submit: dialog closes and button disappears (fianzaStatus=cobrada)
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).not.toBeVisible({
      timeout: 10_000,
    });
    await expect(btnCobro).not.toBeVisible({ timeout: 5_000 });

    // Verify DB persistence
    const dbFianzaStatus = queryDB(
      `SELECT fianza_status FROM reserva WHERE id_reserva = '${E2E_RESERVA_ID}'`,
    ).replace(/\s+/g, '');
    expect(dbFianzaStatus).toBe('cobrada');

    const dbPagoCount = queryDB(
      `SELECT COUNT(*) FROM pago WHERE factura_id = '${E2E_FACTURA_ID}'`,
    ).replace(/\s+/g, '');
    expect(parseInt(dbPagoCount)).toBe(1);

    const dbFacturaEstado = queryDB(
      `SELECT estado FROM factura WHERE id_factura = '${E2E_FACTURA_ID}'`,
    ).replace(/\s+/g, '');
    expect(dbFacturaEstado).toBe('cobrada');

    // Restore DB — navigate away and back to bust TanStack Query cache
    resetearEstadoReserva();
    await renavigar(page);
    await expect(page.getByTestId('accion-registrar-cobro-fianza')).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // 8.3 — Escenario Negociable: pendiente → diálogo confirmación → cancelar
  // ---------------------------------------------------------------------------
  test('8.3 — escenario negociable: fianza=pendiente → diálogo confirmación → cancelar → sin acción', async () => {
    // Set fianza_status to pendiente to trigger Negociable policy
    queryDB(`UPDATE reserva SET fianza_status = 'pendiente' WHERE id_reserva = '${E2E_RESERVA_ID}'`);
    queryDB(`UPDATE factura SET estado = 'borrador' WHERE id_factura = '${E2E_FACTURA_ID}'`);

    await renavigar(page);

    const btnCobro = page.getByTestId('accion-registrar-cobro-fianza');
    await expect(btnCobro).toBeVisible({ timeout: 8_000 });
    await btnCobro.click();

    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).toBeVisible({ timeout: 5_000 });

    // Submit → server returns confirmacion_requerida → ConfirmacionCobroNegociable shown
    await rellenarYEnviarFormulario(page, { importe: '1500,00', fecha: '2032-04-10' });

    // Wait for Negociable confirmation step (data-testid="confirmacion-negociable")
    await expect(page.getByTestId('confirmacion-negociable')).toBeVisible({ timeout: 5_000 });

    // Cancelar → no action, dialog closes (cancelar-negociable button)
    await page.getByTestId('cancelar-negociable').click();
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).not.toBeVisible({
      timeout: 5_000,
    });

    // DB: fianza still pendiente, no PAGO
    const statusAfterCancel = queryDB(
      `SELECT fianza_status FROM reserva WHERE id_reserva = '${E2E_RESERVA_ID}'`,
    ).replace(/\s+/g, '');
    expect(statusAfterCancel).toBe('pendiente');

    const pagoCountAfterCancel = queryDB(
      `SELECT COUNT(*) FROM pago WHERE factura_id = '${E2E_FACTURA_ID}'`,
    ).replace(/\s+/g, '');
    expect(parseInt(pagoCountAfterCancel)).toBe(0);

    // Now confirm → cobro registrado
    await btnCobro.click();
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).toBeVisible({ timeout: 5_000 });
    await rellenarYEnviarFormulario(page, { importe: '1500,00', fecha: '2032-04-10' });

    // Negociable panel appears again
    await expect(page.getByTestId('confirmacion-negociable')).toBeVisible({ timeout: 5_000 });

    // Click confirmar-negociable
    await page.getByTestId('confirmar-negociable').click();

    // Dialog closes after confirmation
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).not.toBeVisible({
      timeout: 10_000,
    });

    // DB: fianza cobrada
    const statusAfterConfirm = queryDB(
      `SELECT fianza_status FROM reserva WHERE id_reserva = '${E2E_RESERVA_ID}'`,
    ).replace(/\s+/g, '');
    expect(statusAfterConfirm).toBe('cobrada');

    // Restore
    resetearEstadoReserva();
    await renavigar(page);
  });

  // ---------------------------------------------------------------------------
  // 8.4a — Doble cobro: acción oculta cuando fianza cobrada
  // ---------------------------------------------------------------------------
  test('8.4a — doble cobro: acción deshabilitada/oculta cuando fianza=cobrada', async () => {
    queryDB(
      `UPDATE reserva SET fianza_status = 'cobrada', fianza_eur = '1500.00', fianza_cobrada_fecha = NOW() WHERE id_reserva = '${E2E_RESERVA_ID}'`,
    );
    await renavigar(page);
    await page.waitForTimeout(500);

    // Button hidden (AccionesFacturacion renders FianzaCobradaResumen instead)
    await expect(page.getByTestId('accion-registrar-cobro-fianza')).not.toBeVisible({
      timeout: 5_000,
    });

    // Restore
    resetearEstadoReserva();
    await renavigar(page);
    await expect(page.getByTestId('accion-registrar-cobro-fianza')).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // 8.4b — Validación UI: importe <= 0 → error inline sin enviar
  // ---------------------------------------------------------------------------
  test('8.4b — validación UI: importe <= 0 muestra error inline sin enviar', async () => {
    const btnCobro = page.getByTestId('accion-registrar-cobro-fianza');
    await expect(btnCobro).toBeVisible({ timeout: 5_000 });
    await btnCobro.click();
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).toBeVisible({ timeout: 5_000 });

    // Fill importe = 0 (nota: '0' no pasa la validación RHF pero '0.00' tampoco)
    await page.getByTestId('input-importe-fianza').fill('0');
    await page.getByTestId('input-fecha-cobro').fill('2032-04-10');
    await page.getByTestId('confirmar-cobro-fianza').click();

    // Validation error appears inline (data-testid="error-importe")
    const errorImporte = page.getByTestId('error-importe');
    await expect(errorImporte).toBeVisible({ timeout: 3_000 });

    // Dialog stays open (no PAGO created)
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).toBeVisible();
    const pagoCount = queryDB(
      `SELECT COUNT(*) FROM pago WHERE factura_id = '${E2E_FACTURA_ID}'`,
    ).replace(/\s+/g, '');
    expect(parseInt(pagoCount)).toBe(0);

    // Close dialog (cancelar-cobro-fianza = cancel button in form view)
    await page.getByTestId('cancelar-cobro-fianza').click();
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).not.toBeVisible({
      timeout: 3_000,
    });
  });

  // ---------------------------------------------------------------------------
  // 8.4c — Validación: fechaCobro posterior al evento → error
  // ---------------------------------------------------------------------------
  test('8.4c — validación UI: fecha posterior al evento muestra error sin enviar', async () => {
    const btnCobro = page.getByTestId('accion-registrar-cobro-fianza');
    await expect(btnCobro).toBeVisible({ timeout: 5_000 });
    await btnCobro.click();
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).toBeVisible({ timeout: 5_000 });

    // Fill fecha posterior al evento (fechaEvento=2032-05-20)
    await page.getByTestId('input-importe-fianza').fill('1500,00');
    await page.getByTestId('input-fecha-cobro').fill('2032-06-01');
    await page.getByTestId('confirmar-cobro-fianza').click();

    // Validation error for fecha (data-testid="error-fecha-cobro")
    const errorFecha = page.getByTestId('error-fecha-cobro');
    await expect(errorFecha).toBeVisible({ timeout: 3_000 });

    // Dialog stays open
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).toBeVisible();
    const pagoCount = queryDB(
      `SELECT COUNT(*) FROM pago WHERE factura_id = '${E2E_FACTURA_ID}'`,
    ).replace(/\s+/g, '');
    expect(parseInt(pagoCount)).toBe(0);

    await page.getByTestId('cancelar-cobro-fianza').click();
    await expect(page.getByTestId('dialog-registrar-cobro-fianza')).not.toBeVisible({
      timeout: 3_000,
    });
  });

  // ---------------------------------------------------------------------------
  // Responsive tests — 3 viewports (regla dura)
  // ---------------------------------------------------------------------------
  test('R.1 — 390px móvil: sección visible sin overflow horizontal, nav como drawer', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navReact(page, `/reservas/${E2E_RESERVA_ID}`);
    await page.waitForTimeout(1000);

    // No horizontal overflow
    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.body.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);

    // Cobro button visible (stacks in column in mobile)
    const btnCobro = page.getByTestId('accion-registrar-cobro-fianza');
    await expect(btnCobro).toBeVisible({ timeout: 5_000 });

    // Nav collapses to drawer (<lg=1024): aside NOT visible
    const asideVisible = await page.locator('aside').isVisible().catch(() => false);
    expect(asideVisible).toBe(false);
  });

  test('R.2 — 768px tablet: sección visible sin overflow horizontal', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await navReact(page, `/reservas/${E2E_RESERVA_ID}`);
    await page.waitForTimeout(1000);

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.body.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);

    const btnCobro = page.getByTestId('accion-registrar-cobro-fianza');
    await expect(btnCobro).toBeVisible({ timeout: 5_000 });

    // Tablet (<lg=1024): nav as drawer, not sidebar
    const asideVisible = await page.locator('aside').isVisible().catch(() => false);
    expect(asideVisible).toBe(false);
  });

  test('R.3 — 1280px escritorio: sección visible, sidebar fijo visible', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navReact(page, `/reservas/${E2E_RESERVA_ID}`);
    await page.waitForTimeout(1000);

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.body.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);

    const btnCobro = page.getByTestId('accion-registrar-cobro-fianza');
    await expect(btnCobro).toBeVisible({ timeout: 5_000 });

    // Desktop (>=lg): sidebar visible
    await expect(page.locator('aside')).toBeVisible();
  });
});
