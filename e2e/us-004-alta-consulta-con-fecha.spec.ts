import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execSync } from 'child_process';

/**
 * E2E — US-004 Alta de consulta con fecha
 *
 * Cubre:
 *   8.2 — Navegación al formulario "Nueva consulta"
 *   8.3 — Alta con fecha libre + invitados/horas → alerta-fecha-bloqueada (2b) + tarifa estimada
 *         visible en aviso 2b + BD verificada
 *   8.4a — Alta sobre fecha bloqueada por 2b → alerta-cola (2d) + BD verificada
 *   8.4b — Alta sobre fecha bloqueada por pre_reserva → alerta-fecha-no-disponible (2a)
 *   8.5 — Validación: selector no permite fechas pasadas ni hoy; borrador E1
 *   8.6 — Responsive en 3 viewports (390 / 768 / 1280)
 *   8.7 — Verificación de persistencia BD + restauración
 */

const queryDB = (sql: string): string =>
  execSync(`docker exec slotify-postgres psql -U user -d slotify_dev -t -c "${sql}"`).toString().trim();

const limpiarReserva = (reservaId: string): void => {
  try {
    const clienteRow = queryDB(
      `SELECT cliente_id FROM reserva WHERE id_reserva = '${reservaId}'`,
    ).trim();
    queryDB(`DELETE FROM fecha_bloqueada WHERE reserva_id = '${reservaId}'`);
    queryDB(`DELETE FROM comunicacion WHERE reserva_id = '${reservaId}'`);
    queryDB(`DELETE FROM audit_log WHERE entidad_id = '${reservaId}'`);
    queryDB(`DELETE FROM reserva WHERE id_reserva = '${reservaId}'`);
    if (clienteRow) {
      const otras = queryDB(
        `SELECT count(*) FROM reserva WHERE cliente_id = '${clienteRow}'`,
      ).trim();
      if (otras === '0') queryDB(`DELETE FROM cliente WHERE id_cliente = '${clienteRow}'`);
    }
  } catch {
    /* already deleted */
  }
};

/** Fecha futura estrictamente > hoy — aislada para US-004 E2E. Agosto = temporada alta → tarifa calculada. */
const FECHA_LIBRE = '2026-08-12';
/** Segunda fecha futura para tests de cola/exploratoria. */
const FECHA_LIBRE_2 = '2026-08-27';
/** Fecha de hoy en ISO — debe ser rechazada. */
const HOY = '2026-06-28';
/** Fecha pasada — debe ser rechazada. */
const PASADA = '2026-01-15';

test.describe.configure({ mode: 'serial' });

test.describe('US-004 — Alta de consulta con fecha', () => {
  let _browser: Browser;
  let context: BrowserContext;
  let page: Page;
  const reservasCreadas: string[] = [];

  // Login único — contexto compartido para mantener la sesión en memoria React
  test.beforeAll(async ({ browser }) => {
    _browser = browser;
    context = await browser.newContext({ baseURL: 'http://localhost:5173' });
    page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto('/login');
    await page.fill('#email', 'info@masialencis.com');
    await page.fill('#password', 'Slotify2026!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/calendario', { timeout: 15_000 });
  });

  test.afterAll(async () => {
    for (const id of reservasCreadas) limpiarReserva(id);
    await context.close();
  });

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------
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

  const irANuevaConsulta = async () => {
    if (page.url().includes('/reservas/nueva')) {
      await irACalendario();
    }
    await page.locator('a[aria-label="Nueva Reserva"]').click();
    await page.waitForURL('**/reservas/nueva', { timeout: 5_000 });
    await page.waitForSelector('[data-testid="form-nueva-consulta"]');
  };

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
  // 8.2 — Navegación al formulario "Nueva consulta"
  // ---------------------------------------------------------------------------
  test('8.2 — navega a /reservas/nueva con el campo fechaEvento visible', async () => {
    await irANuevaConsulta();
    await expect(page.locator('[data-testid="form-nueva-consulta"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nueva consulta' })).toBeVisible();
    await expect(page.locator('#fechaEvento')).toBeVisible();
    // El atributo min debe ser mañana (no permite hoy ni pasado)
    const minAttr = await page.locator('#fechaEvento').getAttribute('min');
    expect(minAttr).toBeDefined();
    expect(minAttr! >= HOY).toBe(true); // mañana >= hoy
    expect(minAttr! > HOY).toBe(true);  // mañana > hoy (no permite hoy)
  });

  // ---------------------------------------------------------------------------
  // 8.3 — Alta con fecha libre + invitados/horas → alerta-fecha-bloqueada (2b)
  //        + IMPORTE de tarifa estimada visible en aviso 2b + BD verificada
  // ---------------------------------------------------------------------------
  test('8.3 — alta con fecha libre → alerta fecha bloqueada (2b) + tarifa estimada visible + BD verificada', async () => {
    await irANuevaConsulta();

    const idReservaPromise = capturarIdReserva();

    await page.fill('#nombre', 'Marta');
    await page.fill('#apellidos', 'Soler Roca');
    await page.fill('#email', 'marta.soler@e2e-us004.test');
    await page.fill('#telefono', '611000001');
    await page.selectOption('#canalEntrada', 'web');
    // Seleccionar fecha futura agosto (temporada alta → motor calcula tarifa)
    await page.fill('#fechaEvento', FECHA_LIBRE);
    // Rellenar invitados + tipo + duración para que el motor calcule precio
    // 40 invitados + 8h + agosto (alta) → PRECIOS[alta][3][1] = 1.076 €
    await page.fill('#invitados', '40');
    await page.selectOption('#tipoEvento', 'boda');
    await page.getByRole('group', { name: 'Horas de duración' }).getByRole('button', { name: '8h' }).click();
    await page.click('button[type="submit"]');

    // Alerta fecha bloqueada (2b) visible
    const alertaFechaBloqueada = page.locator('[data-testid="alerta-fecha-bloqueada"]');
    await expect(alertaFechaBloqueada).toBeVisible({ timeout: 10_000 });

    // Capturar ID y registrar para limpieza en afterAll en cuanto HTTP 201 está confirmado
    // (la alerta sólo aparece tras el 201, así que el promise ya estará resuelto aquí)
    const reservaId = await idReservaPromise;
    reservasCreadas.push(reservaId);

    await expect(alertaFechaBloqueada).toContainText('fecha reservada');
    await expect(alertaFechaBloqueada).toContainText(/26-\d{4}/);

    // NUEVA ASERCIÓN: importe de tarifa estimada visible dentro del aviso 2b
    // El motor calcula 1.076 € (alta, 40 inv, 8h). El aviso muestra el importe en EUR.
    const tarifaImporte = alertaFechaBloqueada.locator('[data-testid="tarifa-estimada-importe"]');
    await expect(tarifaImporte).toBeVisible({ timeout: 5_000 });
    await expect(tarifaImporte).toContainText('€'); // contiene símbolo EUR
    const tarifaText = (await tarifaImporte.textContent()) ?? '';
    expect(tarifaText).toMatch(/\d/); // importe no vacío: contiene al menos un dígito
    // Verificar el importe concreto: 40 inv + 8h + agosto (alta) = 1076€ (seed PRECIOS[alta][3][1])
    expect(tarifaText).toMatch(/1[.,]?076/); // locale-agnostic: acepta 1076 o 1.076

    // También debería aparecer la alerta E1 enviado (sin comentarios)
    const alertaE1 = page.locator('[data-testid="alerta-e1-enviado"]');
    await expect(alertaE1).toBeVisible({ timeout: 5_000 });
    await expect(alertaE1).toContainText('enviado automáticamente');

    // Formulario reseteado
    await expect(page.locator('#nombre')).toHaveValue('', { timeout: 3_000 });

    // Persistencia BD (reservaId ya capturado y registrado arriba)

    // RESERVA en consulta/s2b con ttlExpiracion != NULL
    const estadoRow = queryDB(
      `SELECT estado || '/' || sub_estado FROM reserva WHERE id_reserva = '${reservaId}'`,
    );
    expect(estadoRow.trim()).toBe('consulta/s2b');

    const ttlNull = queryDB(
      `SELECT ttl_expiracion IS NULL FROM reserva WHERE id_reserva = '${reservaId}'`,
    );
    expect(ttlNull.trim()).toBe('f'); // NOT null

    // FECHA_BLOQUEADA blando existe
    const fbRow = queryDB(
      `SELECT tipo_bloqueo FROM fecha_bloqueada WHERE reserva_id = '${reservaId}'`,
    );
    expect(fbRow.trim()).toBe('blando');

    // COMUNICACION E1 enviado
    const comRow = queryDB(
      `SELECT estado FROM comunicacion WHERE reserva_id = '${reservaId}'`,
    );
    expect(comRow.trim()).toBe('enviado');

    // AUDIT_LOG
    const auditRow = queryDB(
      `SELECT accion FROM audit_log WHERE entidad_id = '${reservaId}' AND entidad = 'RESERVA'`,
    );
    expect(auditRow.trim()).toBe('crear');
  });

  // ---------------------------------------------------------------------------
  // 8.4a — Alta sobre misma fecha (ahora bloqueada por 2b) → cola (2d)
  // ---------------------------------------------------------------------------
  test('8.4a — alta sobre fecha bloqueada (2b) → alerta cola (2d) + BD verificada', async () => {
    // FECHA_LIBRE ya está bloqueada por la reserva del test 8.3
    await irANuevaConsulta();

    const idReservaPromise = capturarIdReserva();

    await page.fill('#nombre', 'Joan');
    await page.fill('#apellidos', 'Puig Valls');
    await page.fill('#email', 'joan.puig@e2e-us004.test');
    await page.fill('#telefono', '611000002');
    await page.selectOption('#canalEntrada', 'instagram');
    await page.fill('#fechaEvento', FECHA_LIBRE); // misma fecha bloqueada
    await page.click('button[type="submit"]');

    // Alerta cola (2d) visible
    const alertaCola = page.locator('[data-testid="alerta-cola"]');
    await expect(alertaCola).toBeVisible({ timeout: 10_000 });
    await expect(alertaCola).toContainText('cola de espera');
    await expect(alertaCola).toContainText('posición 1');

    // Persistencia BD
    const reservaId = await idReservaPromise;
    reservasCreadas.push(reservaId);

    const estadoRow = queryDB(
      `SELECT estado || '/' || sub_estado FROM reserva WHERE id_reserva = '${reservaId}'`,
    );
    expect(estadoRow.trim()).toBe('consulta/s2d');

    const posRow = queryDB(
      `SELECT posicion_cola FROM reserva WHERE id_reserva = '${reservaId}'`,
    );
    expect(posRow.trim()).toBe('1');

    // NO se creó nueva FECHA_BLOQUEADA para esta reserva
    const fbCount = queryDB(
      `SELECT count(*) FROM fecha_bloqueada WHERE reserva_id = '${reservaId}'`,
    );
    expect(fbCount.trim()).toBe('0');
  });

  // ---------------------------------------------------------------------------
  // 8.4b — Alta sobre fecha bloqueada por pre_reserva → exploratoria (2a)
  // ---------------------------------------------------------------------------
  test('8.4b — alta sobre fecha pre_reserva → alerta no disponible (2a) + BD verificada', async () => {
    // Crear una 2b para FECHA_LIBRE_2, avanzarla a pre_reserva, luego intentar alta
    // Paso 1: crear la bloqueante (a través de la API curl directo)
    const { execSync: exec } = await import('child_process');
    const tokenResult = exec(
      `curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"info@masialencis.com","password":"Slotify2026!"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])"`,
    ).toString().trim();

    const setupResult = exec(
      `curl -s -X POST http://localhost:3000/api/reservas -H "Content-Type: application/json" -H "Authorization: Bearer ${tokenResult}" -d '{"canalEntrada":"email","fechaEvento":"${FECHA_LIBRE_2}","tipoEvento":"boda","duracionHoras":8,"numAdultosNinosMayores4":40,"cliente":{"nombre":"Setup","apellidos":"PreR","email":"setup.preR@e2e-us004.test","telefono":"611099099"}}'`,
    ).toString().trim();
    const setupData = JSON.parse(setupResult);
    const blocanteId = setupData.idReserva;
    reservasCreadas.push(blocanteId);

    // Paso 2: avanzar a pre_reserva via SQL
    execSync(
      `docker exec slotify-postgres psql -U user -d slotify_dev -c "UPDATE reserva SET estado='pre_reserva', sub_estado=NULL WHERE id_reserva='${blocanteId}'"`,
    );

    // Paso 3: crear nueva consulta con la misma fecha
    await irANuevaConsulta();

    const idReservaPromise = capturarIdReserva();

    await page.fill('#nombre', 'Rosa');
    await page.fill('#apellidos', 'Llopis Vila');
    await page.fill('#email', 'rosa.llopis@e2e-us004.test');
    await page.fill('#telefono', '611000003');
    await page.selectOption('#canalEntrada', 'telefono');
    await page.fill('#fechaEvento', FECHA_LIBRE_2);
    await page.click('button[type="submit"]');

    // Alerta fecha no disponible (2a) visible
    const alertaNoDis = page.locator('[data-testid="alerta-fecha-no-disponible"]');
    await expect(alertaNoDis).toBeVisible({ timeout: 10_000 });
    await expect(alertaNoDis).toContainText('exploratoria');

    // Persistencia BD
    const reservaId = await idReservaPromise;
    reservasCreadas.push(reservaId);

    const estadoRow = queryDB(
      `SELECT estado || '/' || sub_estado FROM reserva WHERE id_reserva = '${reservaId}'`,
    );
    expect(estadoRow.trim()).toBe('consulta/s2a');

    // Sin bloqueo ni cola
    const fbCount = queryDB(
      `SELECT count(*) FROM fecha_bloqueada WHERE reserva_id = '${reservaId}'`,
    );
    expect(fbCount.trim()).toBe('0');

    const posRow = queryDB(
      `SELECT posicion_cola IS NULL FROM reserva WHERE id_reserva = '${reservaId}'`,
    );
    expect(posRow.trim()).toBe('t');
  });

  // ---------------------------------------------------------------------------
  // 8.5a — Validación: fecha = hoy se rechaza en cliente (min=mañana)
  // ---------------------------------------------------------------------------
  test('8.5a — fecha de hoy no es seleccionable (min=mañana en el picker)', async () => {
    await irANuevaConsulta();

    const minAttr = await page.locator('#fechaEvento').getAttribute('min');
    // El min debe ser estrictamente mayor que hoy
    expect(minAttr).toBeDefined();
    expect(minAttr! > HOY).toBe(true);

    // Intentar forzar fecha de hoy (bypass del picker) → error Zod
    await page.fill('#nombre', 'Bypass');
    await page.fill('#apellidos', 'Today');
    await page.fill('#email', 'bypass.today@e2e-us004.test');
    await page.fill('#telefono', '611000010');
    await page.selectOption('#canalEntrada', 'web');
    // Forzar fecha de hoy mediante native setter (bypassa el min del input y React detecta el cambio)
    await page.evaluate((today) => {
      const input = document.getElementById('fechaEvento') as HTMLInputElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      input.removeAttribute('min');
      nativeSetter.call(input, today);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, HOY);
    await page.waitForTimeout(100);

    // Hacer click en submit para disparar la validación Zod
    let apiCalled = false;
    await page.route('**/api/reservas', async (route) => {
      if (route.request().method() === 'POST') {
        apiCalled = true;
        await route.abort();
      } else await route.continue();
    });
    await page.click('button[type="submit"]');

    // Debe aparecer el error de fecha
    await expect(
      page.locator('#fechaEvento-error'),
    ).toBeVisible({ timeout: 3_000 });
    expect(apiCalled).toBe(false); // No llamó a la API
    await page.unrouteAll();
  });

  // ---------------------------------------------------------------------------
  // 8.5b — Alta con fecha + comentarios → E1 borrador visible
  // ---------------------------------------------------------------------------
  test('8.5b — fecha + comentarios → alerta E1 borrador visible', async () => {
    await irANuevaConsulta();

    const idReservaPromise = capturarIdReserva();

    await page.fill('#nombre', 'Marc');
    await page.fill('#apellidos', 'Boix Mas');
    await page.fill('#email', 'marc.boix@e2e-us004.test');
    await page.fill('#telefono', '611000005');
    await page.selectOption('#canalEntrada', 'whatsapp');
    // Usar fecha distinta aún libre
    const future3 = '2026-09-10';
    await page.fill('#fechaEvento', future3);
    await page.fill('#comentarios', 'Lead caliente — boda en septiembre');
    await page.click('button[type="submit"]');

    // Alerta borrador E1 visible
    const alertaBorrador = page.locator('[data-testid="alerta-e1-borrador"]');
    await expect(alertaBorrador).toBeVisible({ timeout: 10_000 });
    await expect(alertaBorrador).toContainText('borrador');
    await expect(alertaBorrador).toContainText('no se ha enviado');

    // Persistencia BD
    const reservaId = await idReservaPromise;
    reservasCreadas.push(reservaId);

    const comRow = queryDB(
      `SELECT estado FROM comunicacion WHERE reserva_id = '${reservaId}'`,
    );
    expect(comRow.trim()).toBe('borrador');

    // Es 2b (fecha libre)
    const estadoRow = queryDB(
      `SELECT sub_estado FROM reserva WHERE id_reserva = '${reservaId}'`,
    );
    expect(estadoRow.trim()).toBe('s2b');
  });

  // ---------------------------------------------------------------------------
  // 8.6 — Responsive en 3 viewports
  // ---------------------------------------------------------------------------
  test('8.6a — viewport 390 (móvil): sin overflow, drawer, fechaEvento visible', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await irANuevaConsulta();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(392);

    // Sidebar colapsado — hamburguesa visible
    await expect(page.locator('aside')).not.toBeVisible();
    await expect(page.locator('button[aria-label="Abrir navegación"]')).toBeVisible();

    // Formulario y campo fechaEvento accesibles
    await expect(page.locator('[data-testid="form-nueva-consulta"]')).toBeVisible();
    await expect(page.locator('#fechaEvento')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('8.6b — viewport 768 (tablet): sin overflow, drawer visible, fechaEvento accesible', async () => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await irANuevaConsulta();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(770);

    await expect(page.locator('aside')).not.toBeVisible();
    await expect(page.locator('button[aria-label="Abrir navegación"]')).toBeVisible();
    await expect(page.locator('#fechaEvento')).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('8.6c — viewport 1280 (escritorio): sidebar fijo, sin hamburguesa, fechaEvento visible', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await irANuevaConsulta();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1282);

    await expect(page.locator('aside')).toBeVisible();
    await expect(page.locator('button[aria-label="Abrir navegación"]')).not.toBeVisible();
    await expect(page.locator('#fechaEvento')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });
});
