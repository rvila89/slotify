/**
 * Scheduler del barrido de CIERRE AUTOMÁTICO de ficha operativa en T-1d (US-026 /
 * UC-20 FA-01, §D-1).
 *
 * Patrón obligatorio "estado en fila + barrido periódico" (skill `async-jobs`;
 * `CLAUDE.md §Jobs asíncronos`): un cron DIARIO de `@nestjs/schedule` INVOCA el endpoint
 * interno protegido `POST /cron/barrido?tarea=fichas` con la cabecera `X-Cron-Token`. El
 * scheduler NO ejecuta lógica de negocio: solo dispara el endpoint HTTP (para que el
 * barrido sea invocable también manualmente/por un scheduler externo y testeable como
 * HTTP). NADA de Lambda/EventBridge ni timers exactos.
 *
 * Registro DINÁMICO (no decorador `@Cron`): el job se crea y arranca en `onModuleInit`
 * a través del `SchedulerRegistry`, leyendo la frecuencia del `ConfigService` en tiempo
 * de arranque. Frecuencia: `CRON_BARRIDO_FICHAS` del entorno (expresión cron) o, por
 * defecto, `'1 0 * * *'` (00:01 diario, una vez al día — US-026 §Supuestos). No se
 * depende de la precisión del timer: el barrido es idempotente (D-4), un disparo perdido
 * se recupera en la siguiente pasada.
 *
 * Desactivación: sin `CRON_TOKEN` configurado, el disparo automático queda efectivamente
 * desactivado (el callback sale con log de advertencia); el endpoint sigue disponible
 * para disparo manual.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

const CRON_POR_DEFECTO = '1 0 * * *';
const NOMBRE_JOB = 'barrido-cierre-fichas-t1d';

@Injectable()
export class BarridoFichasScheduler implements OnModuleInit {
  private readonly logger = new Logger(BarridoFichasScheduler.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /**
   * Registra y arranca el cron DIARIO del barrido de cierre de fichas con la frecuencia
   * configurada (`CRON_BARRIDO_FICHAS` o el default 00:01). El callback es
   * `dispararBarrido`.
   */
  onModuleInit(): void {
    const expresionCron =
      this.configService.get<string>('CRON_BARRIDO_FICHAS') ?? CRON_POR_DEFECTO;

    const job = CronJob.from({
      cronTime: expresionCron,
      onTick: () => {
        void this.dispararBarrido();
      },
    });

    this.schedulerRegistry.addCronJob(NOMBRE_JOB, job);
    job.start();

    this.logger.log(
      `Barrido de cierre de fichas registrado (${NOMBRE_JOB}) con frecuencia cron "${expresionCron}".`,
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
        'CRON_TOKEN no configurado: barrido de cierre de fichas automático desactivado (endpoint disponible para disparo manual).',
      );
      return;
    }
    const puerto = this.configService.get<number>('API_PORT') ?? 3000;
    const url = `http://localhost:${puerto}/api/cron/barrido?tarea=fichas`;
    try {
      const respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'X-Cron-Token': token },
      });
      if (!respuesta.ok) {
        this.logger.error(`Barrido de cierre de fichas: respuesta HTTP ${respuesta.status}`);
        return;
      }
      const resumen = await respuesta.json();
      this.logger.log(`Barrido de cierre de fichas ejecutado: ${JSON.stringify(resumen)}`);
    } catch (error) {
      this.logger.error(`Fallo al invocar el barrido de cierre de fichas: ${String(error)}`);
    }
  }
}
