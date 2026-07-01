/**
 * TESTS del `BarridoExpiracionScheduler` (US-012 / UC-09, §D-1).
 *
 * Trazabilidad: US-012, design.md §D-1 (patrón "estado en fila + barrido
 * periódico": el scheduler INVOCA el endpoint interno protegido
 * `POST /cron/barrido-expiracion` con `X-Cron-Token`; NADA de lógica de negocio
 * aquí). CLAUDE.md §Jobs asíncronos (`@nestjs/schedule`, idempotente, sin
 * Lambda/EventBridge ni timers exactos).
 *
 * Cambio acotado (gate final): la frecuencia se REGISTRA DINÁMICAMENTE en
 * `onModuleInit` vía `SchedulerRegistry` (no `@Cron` decorador, que se evalúa en
 * carga y no puede leer `ConfigService`). Default horario `'0 * * * *'` (minuto
 * 0 de cada hora), sobrescribible por `CRON_BARRIDO_EXPIRACION`. Sin `CRON_TOKEN`
 * el disparo queda efectivamente desactivado (WARN), como hasta ahora.
 *
 * Se instancia el provider con un `ConfigService` mockeado y un
 * `SchedulerRegistry` real, se invoca `onModuleInit()` y se asertan la expresión
 * cron registrada y el comportamiento del disparo.
 */
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BarridoExpiracionScheduler } from '../interface/barrido-expiracion.scheduler';

const NOMBRE_JOB = 'barrido-expiracion-ttl';
const DEFAULT_CRON = '0 * * * *';

const crearConfig = (valores: Record<string, unknown>): ConfigService =>
  ({
    get: jest.fn((clave: string) => valores[clave]),
  }) as unknown as ConfigService;

const registrosActivos: SchedulerRegistry[] = [];

const crearScheduler = (
  valores: Record<string, unknown>,
): { scheduler: BarridoExpiracionScheduler; registry: SchedulerRegistry } => {
  const registry = new SchedulerRegistry();
  registrosActivos.push(registry);
  const scheduler = new BarridoExpiracionScheduler(crearConfig(valores), registry);
  return { scheduler, registry };
};

describe('BarridoExpiracionScheduler — registro dinámico (US-012, D-1)', () => {
  afterEach(() => {
    // Detiene los timers de los CronJob arrancados para no dejar handles abiertos.
    registrosActivos.forEach((registry) => {
      registry.getCronJobs().forEach((job) => job.stop());
    });
    registrosActivos.length = 0;
    jest.restoreAllMocks();
  });

  it('debe_registrar_el_job_con_la_expresion_de_CRON_BARRIDO_EXPIRACION_cuando_esta_definida', () => {
    const cronPersonalizado = '*/10 * * * *';
    const { scheduler, registry } = crearScheduler({
      CRON_TOKEN: 'dev-cron-token',
      CRON_BARRIDO_EXPIRACION: cronPersonalizado,
    });

    scheduler.onModuleInit();

    const job = registry.getCronJob(NOMBRE_JOB);
    expect(job).toBeDefined();
    // cronTime.source expone la expresión cron con la que se creó el job.
    expect(String(job.cronTime.source)).toBe(cronPersonalizado);
  });

  it('debe_registrar_el_job_con_el_default_horario_0_x_x_x_x_cuando_no_hay_override', () => {
    const { scheduler, registry } = crearScheduler({ CRON_TOKEN: 'dev-cron-token' });

    scheduler.onModuleInit();

    const job = registry.getCronJob(NOMBRE_JOB);
    expect(job).toBeDefined();
    expect(String(job.cronTime.source)).toBe(DEFAULT_CRON);
  });

  it('debe_arrancar_el_job_registrado', () => {
    const { scheduler, registry } = crearScheduler({ CRON_TOKEN: 'dev-cron-token' });

    scheduler.onModuleInit();

    const job = registry.getCronJob(NOMBRE_JOB);
    expect(job.running).toBe(true);
  });

  it('sin_CRON_TOKEN_no_dispara_el_fetch_y_emite_WARN', async () => {
    const { scheduler } = crearScheduler({});
    const warnSpy = jest
      .spyOn(scheduler['logger'], 'warn')
      .mockImplementation(() => undefined);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await scheduler.dispararBarrido();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('con_CRON_TOKEN_dispara_el_fetch_POST_con_la_cabecera_X_Cron_Token', async () => {
    const { scheduler } = crearScheduler({ CRON_TOKEN: 'dev-cron-token', API_PORT: 3000 });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidatas: 0, expiradas: 0, promocionesDisparadas: 0, fallos: 0 }),
    } as Response);

    await scheduler.dispararBarrido();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/cron/barrido-expiracion');
    expect(opciones).toMatchObject({
      method: 'POST',
      headers: { 'X-Cron-Token': 'dev-cron-token' },
    });
  });
});
