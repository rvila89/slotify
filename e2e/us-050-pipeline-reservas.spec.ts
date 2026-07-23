import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/**
 * E2E — US-050 Visualizar Pipeline de Reservas (Kanban + Listado)
 *
 * Flujo real contra la API NestJS (puerto 3000) y la SPA Vite (puerto 5173).
 * Credenciales seed: info@masialencis.com / Slotify2026!
 *
 * SESIÓN: el access token vive solo en memoria React. Cada test usa un contexto
 * de browser propio (login fresco) para evitar problemas de caché de TanStack
 * Query entre tests (staleTime: 30_000). Se mantiene el total de logins en ≤5
 * para no agotar el throttle (5 intentos/minuto).
 *
 * Tests y logins:
 *   Login 1 → 8.2 — FA-01: estado vacío (datos reales)
 *   Login 2 → 8.3 + 8.7 — Kanban (mocked) + Responsive 1280/768/390
 *   Login 3 → 8.5 — Tab Listado (mocked)
 *   Login 4 → 8.6a — FA-02: skeleton (hold neverRespond)
 *   Login 5 → 8.6b — FA-03: error + reintento (mocked)
 *
 * Cubre (tasks.md §8):
 *   8.2 — Tab "Flujo de Reserva" activo por defecto; estado vacío FA-01 (datos reales)
 *   8.3 — Tarjetas Kanban: 5 columnas, nombre+fecha+aforo+barras+nota, clic navega
 *   8.5 — Tab "Listado": columnas Nombre·Estado·Fecha·Aforo·Acciones, clic navega
 *   8.6a — FA-02 skeleton de carga
 *   8.6b — FA-03 error + reintento
 *   8.7 — Responsive 390 / 768 / 1280: sin overflow horizontal
 */

const EMAIL = 'info@masialencis.com';
const PASSWORD = 'Slotify2026!';

// ─────────────────────────────────────────────────────────────────────────────
// Helper: crea un contexto con login + opcional mock + navega a /reservas
// ─────────────────────────────────────────────────────────────────────────────

type MockRouteOpts = {
  responseBody?: object;
  failFirst?: boolean;
  neverRespond?: boolean;
};

type ContextResult = {
  ctx: BrowserContext;
  page: Page;
  releaseHold: () => void;
  cleanup: () => Promise<void>;
};

const crearContexto = async (
  browser: Browser,
  opts: {
    viewport?: { width: number; height: number };
    mock?: MockRouteOpts;
  } = {},
): Promise<ContextResult> => {
  const viewport = opts.viewport ?? { width: 1280, height: 800 };
  const ctx = await browser.newContext({ baseURL: 'http://localhost:5173', viewport });
  const pg = await ctx.newPage();

  let releaseHold: () => void = () => {};

  if (opts.mock) {
    let requestCount = 0;
    const holdPromise = opts.mock.neverRespond
      ? new Promise<void>((r) => { releaseHold = r; })
      : Promise.resolve();

    await ctx.route('**/api/reservas', async (route) => {
      // Dejar pasar peticiones con segmento de id (GET /reservas/:id)
      if (route.request().url().match(/\/api\/reservas\/[^?]+/)) {
        await route.continue();
        return;
      }
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      requestCount++;

      if (opts.mock!.neverRespond) {
        await holdPromise;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"data":[],"metadata":{"total":0,"page":1,"limit":20,"totalPages":0}}',
        });
        return;
      }
      if (opts.mock!.failFirst && requestCount <= 2) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          opts.mock!.responseBody ?? {
            data: [],
            metadata: { total: 0, page: 1, limit: 20, totalPages: 0 },
          },
        ),
      });
    });
  }

  // Login inicial (única page.goto que permite conservar token en RAM)
  await pg.goto('/login');
  await pg.fill('#email', EMAIL);
  await pg.fill('#password', PASSWORD);
  await pg.click('button[type="submit"]');
  await pg.waitForURL('**/calendario', { timeout: 15_000 });

  // Navegar a /reservas client-side (sin recargar → token en RAM se mantiene)
  if (viewport.width >= 1024) {
    await pg.locator('aside').getByRole('link', { name: 'Reservas' }).click();
  } else {
    const hamburger = pg.locator('button[aria-label="Abrir navegación"]');
    const visible = await hamburger.isVisible({ timeout: 3_000 }).catch(() => false);
    if (visible) {
      await hamburger.click();
      await pg.waitForSelector('[role="dialog"]');
    }
    await pg.locator('[role="dialog"]').getByRole('link', { name: 'Reservas' }).click();
  }
  await pg.waitForURL('**/reservas', { timeout: 8_000 });

  return { ctx, page: pg, releaseHold, cleanup: () => ctx.close() };
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN 1 — 8.2 — FA-01: estado vacío con datos reales del seed
// ─────────────────────────────────────────────────────────────────────────────
test('8.2 — Tab Flujo de Reserva activo por defecto; FA-01 estado vacío con CTA Nueva Reserva', async ({ browser }) => {
  const { page, cleanup } = await crearContexto(browser);
  try {
    // API real → data:[] (la única reserva del seed es 2x = terminal, excluida)
    await expect(page.locator('#panel-pipeline').getByRole('link', { name: /nueva reserva/i })).toBeVisible({ timeout: 8_000 });

    // Tab "Flujo de Reserva" activo por defecto
    const tabFlujo = page.getByRole('tab', { name: /flujo de reserva/i });
    await expect(tabFlujo).toBeVisible();
    await expect(tabFlujo).toHaveAttribute('aria-selected', 'true');

    const tabListado = page.getByRole('tab', { name: /listado/i });
    await expect(tabListado).toBeVisible();
    await expect(tabListado).toHaveAttribute('aria-selected', 'false');

    // FA-01: texto descriptivo del estado vacío
    await expect(page.getByText(/aún no hay reservas activas/i)).toBeVisible();
  } finally {
    await cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN 2 — 8.3 + 8.7 — Kanban mockeado + Responsive (mismo contexto)
// ─────────────────────────────────────────────────────────────────────────────
const MOCK_RESERVA_8_3 = {
  idReserva: 'aaaaaaaa-0000-0000-0000-000000000001',
  codigo: 'SLO-2026-TEST1',
  clienteId: 'cccccccc-0000-0000-0000-000000000001',
  estado: 'reserva_confirmada',
  subEstado: null,
  canalEntrada: 'email',
  fechaEvento: '2026-09-15',
  numInvitadosFinal: 80,
  progressLogistica: 50,
  progressLiquidacion: 25,
  notas: 'Test nota de estado E2E',
  nombreEvento: 'Boda de Prueba E2E',
  fechaCreacion: '2026-07-01T10:00:00.000Z',
};

test('8.3 + 8.7 — Kanban: 5 cols, tarjeta, clic navega; Responsive 1280/768/390 sin overflow', async ({ browser }) => {
  const TEST_ID = MOCK_RESERVA_8_3.idReserva;

  const { page, cleanup } = await crearContexto(browser, {
    mock: {
      responseBody: {
        data: [MOCK_RESERVA_8_3],
        metadata: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
    },
  });

  try {
    // ── 8.3 — Kanban ──────────────────────────────────────────────────────────
    await expect(page.getByText('Boda de Prueba E2E')).toBeVisible({ timeout: 8_000 });

    // 5 columnas del Kanban
    for (const col of ['Consulta', 'Pre-reserva', 'Confirmada', 'En Curso', 'Post-evento']) {
      await expect(page.getByText(col)).toBeVisible({ timeout: 5_000 });
    }

    // Fecha en español y aforo
    await expect(page.getByText(/septiembre/i)).toBeVisible();
    await expect(page.getByText(/80/)).toBeVisible();

    // Barras de progreso con porcentajes
    await expect(page.getByText(/log[íi]stica/i).first()).toBeVisible();
    await expect(page.getByText(/liquidaci[óo]n/i).first()).toBeVisible();
    await expect(page.getByText('50%')).toBeVisible();
    await expect(page.getByText('25%')).toBeVisible();

    // Nota visible en la tarjeta
    await expect(page.getByText('Test nota de estado E2E')).toBeVisible();

    // Clic en tarjeta → navega a /reservas/{idReserva}
    await page.getByText('Boda de Prueba E2E').click();
    await expect(page).toHaveURL(new RegExp(`/reservas/${TEST_ID}`), { timeout: 7_000 });

    // Volver atrás → recupera el pipeline
    await page.goBack();
    await expect(page).toHaveURL(/\/reservas$/, { timeout: 5_000 });
    await expect(page.getByRole('tab', { name: /flujo de reserva/i })).toHaveAttribute('aria-selected', 'true');

    // ── 8.7 — Responsive (mismo contexto, token en RAM) ───────────────────────
    // El cache TanStack sigue válido (staleTime 30s); datos desde caché sin re-fetch.

    // -- 1280 (desktop ≥lg): sidebar fijo visible, sin overflow --
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.getByText('Boda de Prueba E2E')).toBeVisible({ timeout: 5_000 });
    let bsw = await page.evaluate(() => document.body.scrollWidth);
    expect(bsw, `scrollWidth Kanban en 1280 = ${bsw}`).toBeLessThanOrEqual(1282);

    // Listado en 1280: cabeceras <th> visibles (lg:not-sr-only aplicado)
    await page.getByRole('tab', { name: /listado/i }).click();
    await expect(page.getByRole('columnheader', { name: /nombre/i })).toBeVisible({ timeout: 5_000 });
    bsw = await page.evaluate(() => document.body.scrollWidth);
    expect(bsw, `scrollWidth Listado en 1280 = ${bsw}`).toBeLessThanOrEqual(1282);

    // -- 768 (tablet <lg): sin overflow en Kanban y Listado --
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.getByRole('tab', { name: /flujo de reserva/i }).click();
    await expect(page.getByText('Boda de Prueba E2E')).toBeVisible({ timeout: 5_000 });
    bsw = await page.evaluate(() => document.body.scrollWidth);
    expect(bsw, `scrollWidth Kanban en 768 = ${bsw}`).toBeLessThanOrEqual(770);

    await page.getByRole('tab', { name: /listado/i }).click();
    await expect(page.getByText('Boda de Prueba E2E')).toBeVisible({ timeout: 5_000 });
    bsw = await page.evaluate(() => document.body.scrollWidth);
    expect(bsw, `scrollWidth Listado en 768 = ${bsw}`).toBeLessThanOrEqual(770);

    // -- 390 (móvil <lg): sin overflow, thead con clase sr-only --
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: /flujo de reserva/i }).click();
    await expect(page.getByText('Boda de Prueba E2E')).toBeVisible({ timeout: 5_000 });
    bsw = await page.evaluate(() => document.body.scrollWidth);
    expect(bsw, `scrollWidth Kanban en 390 = ${bsw}`).toBeLessThanOrEqual(392);

    await page.getByRole('tab', { name: /listado/i }).click();
    await expect(page.getByText('Boda de Prueba E2E')).toBeVisible({ timeout: 5_000 });
    bsw = await page.evaluate(() => document.body.scrollWidth);
    expect(bsw, `scrollWidth Listado en 390 = ${bsw}`).toBeLessThanOrEqual(392);

    // En móvil (<lg), el <thead> debe tener clase sr-only (cabeceras visualmente ocultas).
    // Tailwind sr-only usa position:absolute; width:1px; height:1px; overflow:hidden.
    // Playwright no considera esto "not visible" (no es display:none), por lo que
    // verificamos la clase CSS en lugar de visibilidad DOM.
    const theadHasSrOnly = await page.evaluate(() => {
      const thead = document.querySelector('thead');
      return thead?.classList.contains('sr-only') ?? false;
    });
    expect(theadHasSrOnly, 'thead debe tener clase sr-only en viewport 390px').toBe(true);
  } finally {
    await cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN 3 — 8.5 — Tab "Listado"
// ─────────────────────────────────────────────────────────────────────────────
test('8.5 — Listado: columnas Nombre·Estado·Fecha·Aforo·Acciones; clic en fila navega a la ficha', async ({ browser }) => {
  const TEST_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

  const { page, cleanup } = await crearContexto(browser, {
    mock: {
      responseBody: {
        data: [
          {
            idReserva: TEST_ID,
            codigo: 'SLO-2026-LISTA',
            clienteId: 'cccccccc-0000-0000-0000-000000000002',
            estado: 'evento_en_curso',
            subEstado: null,
            canalEntrada: 'email',
            fechaEvento: '2026-08-20',
            numInvitadosFinal: 45,
            progressLogistica: 100,
            progressLiquidacion: 50,
            notas: null,
            nombreEvento: 'Evento Listado E2E',
            fechaCreacion: '2026-06-15T10:00:00.000Z',
          },
        ],
        metadata: { total: 1, page: 1, limit: 20, totalPages: 1 },
      },
    },
  });

  try {
    await expect(page.getByText('Evento Listado E2E')).toBeVisible({ timeout: 8_000 });

    // Cambiar al tab "Listado"
    await page.getByRole('tab', { name: /listado/i }).click();
    await expect(page.getByRole('tab', { name: /listado/i })).toHaveAttribute('aria-selected', 'true');

    // En desktop (1280) las cabeceras son visibles como tabla
    await expect(page.getByRole('columnheader', { name: /nombre/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('columnheader', { name: /estado/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /fecha/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /aforo/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /acciones/i })).toBeVisible();

    await expect(page.getByText('Evento Listado E2E')).toBeVisible();

    // Clic en la fila → navega a /reservas/{id}
    await page.getByText('Evento Listado E2E').click();
    await expect(page).toHaveURL(new RegExp(`/reservas/${TEST_ID}`), { timeout: 7_000 });
  } finally {
    await cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN 4 — 8.6a — FA-02: skeleton de carga
// ─────────────────────────────────────────────────────────────────────────────
test('8.6a — FA-02: skeleton de carga visible mientras GET /reservas está en curso', async ({ browser }) => {
  const { page, releaseHold, cleanup } = await crearContexto(browser, {
    mock: { neverRespond: true },
  });

  try {
    await expect(page.getByTestId('pipeline-skeleton')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#panel-pipeline').getByRole('link', { name: /nueva reserva/i })).not.toBeVisible();
    await expect(page.getByRole('alert')).not.toBeVisible();
  } finally {
    releaseHold();
    await cleanup();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN 5 — 8.6b — FA-03: error + reintento
// ─────────────────────────────────────────────────────────────────────────────
test('8.6b — FA-03: estado de error con botón Reintentar que reejecuta GET /reservas', async ({ browser }) => {
  const { page, cleanup } = await crearContexto(browser, {
    mock: {
      failFirst: true,
      responseBody: { data: [], metadata: { total: 0, page: 1, limit: 20, totalPages: 0 } },
    },
  });

  try {
    const botonReintentar = page.getByRole('button', { name: /reintentar/i });
    await expect(botonReintentar).toBeVisible({ timeout: 10_000 });

    // Clic en "Reintentar" → 3ª petición devuelve data:[] → FA-01
    await botonReintentar.click();
    await expect(botonReintentar).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#panel-pipeline').getByRole('link', { name: /nueva reserva/i })).toBeVisible({ timeout: 5_000 });
  } finally {
    await cleanup();
  }
});
