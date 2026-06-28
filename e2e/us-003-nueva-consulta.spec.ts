import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * E2E — US-003 Alta de consulta exploratoria sin fecha
 *
 * Estrategia de sesión: el access token vive solo en memoria React.
 * `page.goto()` recarga la SPA y pierde la sesión → se usa solo para el
 * login inicial. El resto de la navegación es CLIENT-SIDE (click de links
 * React Router) para mantener el token en memoria.
 *
 * Cubre:
 *   8.2 — Navegación a /reservas/nueva vía botón Nueva Reserva del header
 *   8.3 — Flujo feliz sin comentarios → alerta-e1-enviado + persistencia BD
 *   8.4 — Flujo con comentarios → alerta-e1-borrador + persistencia BD
 *   8.5 — Validación cliente: campos obligatorios, email inválido, canal vacío
 *   8.6 — Responsive en 3 viewports (390/768/1280) sin overflow horizontal
 */

// ---------------------------------------------------------------------------
// Helpers BD (restauración vía docker exec)
// ---------------------------------------------------------------------------
const queryDB = (sql: string): string =>
  execSync(`docker exec slotify-postgres psql -U user -d slotify_dev -t -c "${sql}"`).toString().trim();

const limpiarReserva = (reservaId: string): void => {
  try {
    const row = queryDB(
      `SELECT cliente_id FROM reserva WHERE id_reserva = '${reservaId}'`,
    ).trim();
    queryDB(`DELETE FROM audit_log WHERE entidad_id = '${reservaId}'`);
    queryDB(`DELETE FROM comunicacion WHERE reserva_id = '${reservaId}'`);
    queryDB(`DELETE FROM reserva WHERE id_reserva = '${reservaId}'`);
    if (row) {
      const otras = queryDB(
        `SELECT count(*) FROM reserva WHERE cliente_id = '${row}'`,
      ).trim();
      if (otras === '0') queryDB(`DELETE FROM cliente WHERE id_cliente = '${row}'`);
    }
  } catch {
    /* registro ya eliminado */
  }
};

// ---------------------------------------------------------------------------
// Modo serial + contexto compartido: login único, sesión en memoria React
// ---------------------------------------------------------------------------
test.describe.configure({ mode: 'serial' });

test.describe('US-003 — Alta de consulta exploratoria', () => {
  let _browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const reservasCreadas: string[] = [];

  // Login único — NO usar page.goto() en tests (recarga la SPA y pierde sesión)
  test.beforeAll(async ({ browser }) => {
    _browser = browser;
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();

    // Viewport por defecto: 1280x720 (escritorio)
    await page.setViewportSize({ width: 1280, height: 720 });

    // Unico page.goto: login inicial
    await page.goto('/login');
    await page.fill('#email', 'info@masialencis.com');
    await page.fill('#password', 'Slotify2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/calendario', { timeout: 15_000 });
    // Ahora la sesión vive en memoria React de este contexto.
  });

  test.afterAll(async () => {
    for (const id of reservasCreadas) limpiarReserva(id);
    await context.close();
  });

  // ---------------------------------------------------------------------------
  // Helpers de navegación SPA-interna (sin recarga de página)
  // ---------------------------------------------------------------------------

  /**
   * Navega a /calendario dentro de la SPA sin recargar.
   * En escritorio (≥lg): click en el NavLink "Calendario" del aside.
   * En móvil/tablet (<lg): abre el drawer y hace click en "Calendario".
   */
  const irACalendario = async () => {
    const ancho = await page.evaluate(() => window.innerWidth);
    if (ancho >= 1024) {
      await page.locator('aside').getByRole('link', { name: 'Calendario' }).click();
    } else {
      const btn = page.locator('button[aria-label="Abrir navegación"]');
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForSelector('[role="dialog"]');
      }
      await page.locator('[role="dialog"]').getByRole('link', { name: 'Calendario' }).click();
    }
    await page.waitForURL('**/calendario', { timeout: 5_000 });
  };

  /**
   * Navega a /reservas/nueva dentro de la SPA:
   * 1. Si ya estamos ahí, navega primero a /calendario (para re-montar el form).
   * 2. Click en el botón "Nueva Reserva" del header.
   */
  const irANuevaConsulta = async () => {
    if (page.url().includes('/reservas/nueva')) {
      await irACalendario();
    }
    await page.locator('a[aria-label="Nueva Reserva"]').click();
    await page.waitForURL('**/reservas/nueva', { timeout: 5_000 });
    await page.waitForSelector('[data-testid="form-nueva-consulta"]');
  };

  /** Captura el idReserva de la próxima respuesta 201 de POST /reservas. */
  const capturarIdReserva = (): Promise<string> =>
    new Promise((resolve) => {
      const handler = async (response: Parameters<typeof page.on<'response'>>[1] extends (r: infer R) => void ? R : never) => {
        if (response.url().includes('/api/reservas') && response.status() === 201) {
          const body = await response.json().catch(() => ({} as { idReserva?: string }));
          if (body.idReserva) {
            page.off('response', handler);
            resolve(body.idReserva);
          }
        }
      };
      page.on('response', handler);
    });

  // ---------------------------------------------------------------------------
  // 8.2 — Navegación al formulario vía botón "+ Nueva Reserva" del header
  // ---------------------------------------------------------------------------
  test('8.2 — navega a /reservas/nueva via botón Nueva Reserva del header', async () => {
    // Ya estamos en /calendario tras el beforeAll
    const btnNuevaReserva = page.locator('a[aria-label="Nueva Reserva"]');
    await expect(btnNuevaReserva).toBeVisible({ timeout: 5_000 });
    await btnNuevaReserva.click();
    await page.waitForURL('**/reservas/nueva', { timeout: 5_000 });

    expect(page.url()).toContain('/reservas/nueva');
    await expect(page.locator('[data-testid="form-nueva-consulta"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nueva consulta' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Panel' })).toBeVisible(); // AppShell header
  });

  // ---------------------------------------------------------------------------
  // 8.3 — Flujo feliz SIN comentarios → alerta-e1-enviado + persistencia BD
  // ---------------------------------------------------------------------------
  test('8.3 — flujo feliz sin comentarios → alerta E1 enviado + BD verificada', async () => {
    await irANuevaConsulta();

    const idReservaPromise = capturarIdReserva();

    await page.fill('#nombre', 'Eva');
    await page.fill('#apellidos', 'Martínez Fonts');
    await page.fill('#email', 'eva.martinez@e2e-test.com');
    await page.fill('#telefono', '622000001');
    await page.selectOption('#canalEntrada', 'web');
    // Sin comentarios
    await page.click('button[type="submit"]');

    // Alerta E1 enviado visible
    const alertaEnviado = page.locator('[data-testid="alerta-e1-enviado"]');
    await expect(alertaEnviado).toBeVisible({ timeout: 10_000 });
    await expect(alertaEnviado).toContainText('enviado automáticamente');
    await expect(alertaEnviado).toContainText(/26-\d{4}/);

    // Formulario resetado tras submit exitoso
    await expect(page.locator('#nombre')).toHaveValue('', { timeout: 3_000 });

    // Persistencia BD
    const reservaId = await idReservaPromise;
    reservasCreadas.push(reservaId);

    // RESERVA en consulta/s2a con ttl=NULL
    const estadoRow = queryDB(
      `SELECT estado || '/' || sub_estado FROM reserva WHERE id_reserva = '${reservaId}'`,
    );
    expect(estadoRow.trim()).toBe('consulta/s2a');

    const ttlNull = queryDB(
      `SELECT ttl_expiracion IS NULL FROM reserva WHERE id_reserva = '${reservaId}'`,
    );
    expect(ttlNull.trim()).toBe('t');

    // COMUNICACION E1/enviado
    const comRow = queryDB(
      `SELECT estado FROM comunicacion WHERE reserva_id = '${reservaId}'`,
    );
    expect(comRow.trim()).toBe('enviado');

    // AUDIT_LOG crear/RESERVA
    const auditRow = queryDB(
      `SELECT accion || '/' || entidad FROM audit_log WHERE entidad_id = '${reservaId}'`,
    );
    expect(auditRow.trim()).toBe('crear/RESERVA');

    // NO fecha_bloqueada
    const fbCount = queryDB(
      `SELECT count(*) FROM fecha_bloqueada WHERE tenant_id = '00000000-0000-0000-0000-000000000001'`,
    );
    expect(fbCount.trim()).toBe('0');
  });

  // ---------------------------------------------------------------------------
  // 8.4 — Flujo CON comentarios → alerta-e1-borrador + COMUNICACION borrador
  // ---------------------------------------------------------------------------
  test('8.4 — flujo con comentarios → alerta E1 borrador + BD verificada', async () => {
    await irANuevaConsulta();

    const idReservaPromise = capturarIdReserva();

    await page.fill('#nombre', 'Lluc');
    await page.fill('#apellidos', 'Ferrer Puig');
    await page.fill('#email', 'lluc.ferrer@e2e-test.com');
    await page.fill('#telefono', '633000002');
    await page.selectOption('#canalEntrada', 'whatsapp');
    await page.fill('#comentarios', 'Lead muy caliente, llamar el lunes por la mañana.');
    await page.click('button[type="submit"]');

    // Alerta borrador visible
    const alertaBorrador = page.locator('[data-testid="alerta-e1-borrador"]');
    await expect(alertaBorrador).toBeVisible({ timeout: 10_000 });
    await expect(alertaBorrador).toContainText('borrador');
    await expect(alertaBorrador).toContainText('no se ha enviado');

    // COMUNICACION en borrador
    const reservaId = await idReservaPromise;
    reservasCreadas.push(reservaId);

    const comRow = queryDB(
      `SELECT estado FROM comunicacion WHERE reserva_id = '${reservaId}'`,
    );
    expect(comRow.trim()).toBe('borrador');
  });

  // ---------------------------------------------------------------------------
  // 8.5a — Campos obligatorios vacíos → errores visibles, sin llamada a la API
  // ---------------------------------------------------------------------------
  test('8.5a — campos obligatorios vacíos → errores de validación, API no invocada', async () => {
    await irANuevaConsulta();

    let apiCalled = false;
    await page.route('**/api/reservas', async (route) => {
      if (route.request().method() === 'POST') {
        apiCalled = true;
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.click('button[type="submit"]');

    await expect(page.getByText('El nombre es obligatorio')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('Los apellidos son obligatorios')).toBeVisible();
    await expect(page.getByText('El email es obligatorio')).toBeVisible();
    await expect(page.getByText('El teléfono es obligatorio')).toBeVisible();
    await expect(page.getByText('Selecciona un canal de entrada')).toBeVisible();
    expect(apiCalled).toBe(false);

    await page.unrouteAll();
  });

  // ---------------------------------------------------------------------------
  // 8.5b — Email con formato inválido → error de formato
  // ---------------------------------------------------------------------------
  test('8.5b — email inválido → error de formato, API no invocada', async () => {
    await irANuevaConsulta();

    let apiCalled = false;
    await page.route('**/api/reservas', async (route) => {
      if (route.request().method() === 'POST') {
        apiCalled = true;
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.fill('#nombre', 'Test');
    await page.fill('#apellidos', 'User');
    await page.fill('#email', 'correo-sin-arroba');
    await page.fill('#telefono', '600111222');
    await page.selectOption('#canalEntrada', 'email');
    await page.click('button[type="submit"]');

    await expect(page.getByText('Introduce un email válido')).toBeVisible({ timeout: 3_000 });
    expect(apiCalled).toBe(false);

    await page.unrouteAll();
  });

  // ---------------------------------------------------------------------------
  // 8.5c — Canal de entrada no seleccionado → error, sin llamada a la API
  // ---------------------------------------------------------------------------
  test('8.5c — canal no seleccionado → error de validación, API no invocada', async () => {
    await irANuevaConsulta();

    let apiCalled = false;
    await page.route('**/api/reservas', async (route) => {
      if (route.request().method() === 'POST') {
        apiCalled = true;
        await route.abort();
      } else {
        await route.continue();
      }
    });

    await page.fill('#nombre', 'Test');
    await page.fill('#apellidos', 'User');
    await page.fill('#email', 'test@example.com');
    await page.fill('#telefono', '600111222');
    // canal NO seleccionado (valor vacío '')
    await page.click('button[type="submit"]');

    await expect(page.getByText('Selecciona un canal de entrada')).toBeVisible({ timeout: 3_000 });
    expect(apiCalled).toBe(false);

    await page.unrouteAll();
  });

  // ---------------------------------------------------------------------------
  // 8.6a — Responsive: viewport 390 (móvil)
  // ---------------------------------------------------------------------------
  test('8.6a — viewport 390 (móvil): sin overflow, drawer hamburguesa visible', async () => {
    // Cambiar viewport a móvil
    await page.setViewportSize({ width: 390, height: 844 });
    await irANuevaConsulta();

    // Sin overflow horizontal
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(392);

    // Sidebar colapsado a drawer en <lg
    await expect(page.locator('aside')).not.toBeVisible();
    await expect(page.locator('button[aria-label="Abrir navegación"]')).toBeVisible();

    // Formulario accesible
    await expect(page.locator('[data-testid="form-nueva-consulta"]')).toBeVisible();
    await expect(page.locator('#nombre')).toBeVisible();
    await expect(page.locator('#canalEntrada')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    // Restaurar viewport para los siguientes tests
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  // ---------------------------------------------------------------------------
  // 8.6b — Responsive: viewport 768 (tablet)
  // ---------------------------------------------------------------------------
  test('8.6b — viewport 768 (tablet): sin overflow, drawer visible', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await irANuevaConsulta();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(770);

    // <lg → sidebar colapsado, hamburgesa visible
    await expect(page.locator('aside')).not.toBeVisible();
    await expect(page.locator('button[aria-label="Abrir navegación"]')).toBeVisible();

    await expect(page.locator('[data-testid="form-nueva-consulta"]')).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  // ---------------------------------------------------------------------------
  // 8.6c — Responsive: viewport 1280 (escritorio)
  // ---------------------------------------------------------------------------
  test('8.6c — viewport 1280 (escritorio): sidebar fijo, sin hamburguesa', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irANuevaConsulta();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1282);

    // ≥lg → sidebar fijo visible
    await expect(page.locator('aside')).toBeVisible();
    // Hamburguesa oculta en escritorio
    await expect(page.locator('button[aria-label="Abrir navegación"]')).not.toBeVisible();

    await expect(page.locator('[data-testid="form-nueva-consulta"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
