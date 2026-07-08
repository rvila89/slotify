/**
 * Scheduler del barrido de INICIO AUTOMÁTICO de evento en T-0 (US-031 / UC-23, §D-1).
 *
 * Patrón obligatorio "estado en fila + barrido periódico" (skill `async-jobs`;
 * `CLAUDE.md §Jobs asíncronos`): un cron DIARIO de `@nestjs/schedule` INVOCA el endpoint
 * interno protegido `POST /cron/barrido-eventos` con la cabecera `X-Cron-Token`. El
 * scheduler NO ejecuta lógica de negocio: solo dispara el endpoint HTTP (para que el
 * barrido sea invocable también manualmente/por un scheduler externo y testeable como
 * HTTP). NADA de Lambda/EventBridge ni timers exactos.
 *
 * Registro DINÁMICO (no decorador `@Cron`): el job se crea y arranca en `onModuleInit`
 * a través del `SchedulerRegistry`, leyendo la frecuencia del `ConfigService` en tiempo
 * de arranque (el decorador `@Cron` se evalúa en carga de módulo, antes de poder
 * consultar configuración). Frecuencia: `CRON_BARRIDO_EVENTOS` del entorno (expresión
 * cron) o, por defecto, `'0 0 * * *'` (00:00 diario, una vez al día en T-0 — §D-1). No se
 * depende de la precisión del timer: el barrido es idempotente (D-4) y la candidatura se
 * decide por FECHA DE CALENDARIO (el filtro `date(fecha_evento) = date(hoy)` tolera que el
 * pase corra a cualquier hora del día), así que un disparo perdido se recupera.
 *
 * Desactivación: sin `CRON_TOKEN` configurado, el disparo automático queda efectivamente
 * desactivado (el callback sale con log de advertencia); el endpoint sigue disponible
 * para disparo manual.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

const CRON_POR_DEFECTO = '0 0 * * *';
const NOMBRE_JOB = 'barrido-inicio-eventos-t0';

@Injectable()
export class BarridoEventosScheduler implements OnModuleInit {
  private readonly logger = new Logger(BarridoEventosScheduler.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /**
   * Registra y arranca el cron DIARIO del barrido de inicio de eventos con la frecuencia
   * configurada (`CRON_BARRIDO_EVENTOS` o el default 00:00). El callback es
   * `dispararBarrido`.
   */
  onModuleInit(): void {
    const expresionCron =
      this.configService.get<string>('CRON_BARRIDO_EVENTOS') ?? CRON_POR_DEFECTO;

    const job = CronJob.from({
      cronTime: expresionCron,
      onTick: () => {
        void this.dispararBarrido();
      },
    });

    this.schedulerRegistry.addCronJob(NOMBRE_JOB, job);
    job.start();

    this.logger.log(
      `Barrido de inicio de eventos registrado (${NOMBRE_JOB}) con frecuencia cron "${expresionCron}".`,
    );
  }

  /**
   * Disparo periódico: llama al endpoint interno protegido con `X-Cron-Token`. Sin
   * `CRON_TOKEN` configurado, el disparo automático se desactiva (log de advertencia) y
   * el endpoint queda disponible para disparo manual.
   */
  async dispararBarrido(): Promise<void> {
    const token = this.configService.get<string>('CRON_TOKEN');
    if (!token) {
      this.logger.warn(
        'CRON_TOKEN no configurado: barrido de inicio de eventos automático desactivado (endpoint disponible para disparo manual).',
      );
      return;
    }
    const puerto = this.configService.get<number>('API_PORT') ?? 3000;
    const url = `http://localhost:${puerto}/api/cron/barrido-eventos`;
    try {
      const respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'X-Cron-Token': token },
      });
      if (!respuesta.ok) {
        this.logger.error(`Barrido de inicio de eventos: respuesta HTTP ${respuesta.status}`);
        return;
      }
      const resumen = await respuesta.json();
      this.logger.log(`Barrido de inicio de eventos ejecutado: ${JSON.stringify(resumen)}`);
    } catch (error) {
      this.logger.error(`Fallo al invocar el barrido de inicio de eventos: ${String(error)}`);
    }
  }
}
