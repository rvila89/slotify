/**
 * Scheduler del barrido de ARCHIVADO AUTOMÁTICO en T+7d (US-037 / UC-28, §D-1).
 *
 * Patrón obligatorio "estado en fila + barrido periódico" (skill `async-jobs`;
 * `CLAUDE.md §Jobs asíncronos`): un cron DIARIO de `@nestjs/schedule` INVOCA el endpoint
 * interno protegido `POST /cron/barrido-completadas` con la cabecera `X-Cron-Token`. El
 * scheduler NO ejecuta lógica de negocio: solo dispara el endpoint HTTP (para que el barrido
 * sea invocable también manualmente/por un scheduler externo y testeable como HTTP). NADA de
 * Lambda/EventBridge ni timers exactos.
 *
 * Registro DINÁMICO (no decorador `@Cron`): el job se crea y arranca en `onModuleInit` a
 * través del `SchedulerRegistry`, leyendo la frecuencia del `ConfigService` en tiempo de
 * arranque. Frecuencia: `CRON_BARRIDO_COMPLETADAS` del entorno (expresión cron) o, por
 * defecto, `'0 3 * * *'` (03:00 diario, una vez al día — §D-1). No se depende de la
 * precisión del timer: el barrido es idempotente y la candidatura se decide por FECHA DE
 * CALENDARIO (el filtro `date(fecha_post_evento) <= hoy - 7` tolera que el pase corra a
 * cualquier hora del día), así que un disparo perdido se recupera.
 *
 * Desactivación: sin `CRON_TOKEN` configurado, el disparo automático queda efectivamente
 * desactivado (el callback sale con log de advertencia); el endpoint sigue disponible para
 * disparo manual.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

const CRON_POR_DEFECTO = '0 3 * * *';
const NOMBRE_JOB = 'barrido-archivado-completadas-t7d';

@Injectable()
export class BarridoCompletadasScheduler implements OnModuleInit {
  private readonly logger = new Logger(BarridoCompletadasScheduler.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /**
   * Registra y arranca el cron DIARIO del barrido de archivado con la frecuencia configurada
   * (`CRON_BARRIDO_COMPLETADAS` o el default 03:00). El callback es `dispararBarrido`.
   */
  onModuleInit(): void {
    const expresionCron =
      this.configService.get<string>('CRON_BARRIDO_COMPLETADAS') ?? CRON_POR_DEFECTO;

    const job = CronJob.from({
      cronTime: expresionCron,
      onTick: () => {
        void this.dispararBarrido();
      },
    });

    this.schedulerRegistry.addCronJob(NOMBRE_JOB, job);
    job.start();

    this.logger.log(
      `Barrido de archivado automático registrado (${NOMBRE_JOB}) con frecuencia cron "${expresionCron}".`,
    );
  }

  /**
   * Disparo periódico: llama al endpoint interno protegido con `X-Cron-Token`. Sin
   * `CRON_TOKEN` configurado, el disparo automático se desactiva (log de advertencia) y el
   * endpoint queda disponible para disparo manual.
   */
  async dispararBarrido(): Promise<void> {
    const token = this.configService.get<string>('CRON_TOKEN');
    if (!token) {
      this.logger.warn(
        'CRON_TOKEN no configurado: barrido de archivado automático desactivado (endpoint disponible para disparo manual).',
      );
      return;
    }
    const puerto = this.configService.get<number>('API_PORT') ?? 3000;
    const url = `http://localhost:${puerto}/api/cron/barrido-completadas`;
    try {
      const respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'X-Cron-Token': token },
      });
      if (!respuesta.ok) {
        this.logger.error(`Barrido de archivado automático: respuesta HTTP ${respuesta.status}`);
        return;
      }
      const resumen = await respuesta.json();
      this.logger.log(`Barrido de archivado automático ejecutado: ${JSON.stringify(resumen)}`);
    } catch (error) {
      this.logger.error(`Fallo al invocar el barrido de archivado automático: ${String(error)}`);
    }
  }
}
