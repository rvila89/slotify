/**
 * Scheduler del barrido de expiración por TTL (US-012 / UC-09, §D-1).
 *
 * Patrón obligatorio "estado en fila + barrido periódico" (skill `async-jobs`;
 * `CLAUDE.md §Jobs asíncronos`): un cron de `@nestjs/schedule` INVOCA
 * PERIÓDICAMENTE el endpoint interno protegido `POST /cron/barrido-expiracion` con la
 * cabecera `X-Cron-Token`. El scheduler NO ejecuta lógica de negocio: solo dispara el
 * endpoint HTTP (para que el barrido sea invocable también manualmente/por un
 * scheduler externo y testeable como HTTP). NADA de Lambda/EventBridge ni timers
 * exactos.
 *
 * Registro DINÁMICO (no decorador `@Cron`): el job se crea y arranca en
 * `onModuleInit` a través del `SchedulerRegistry`. Así podemos leer la frecuencia del
 * `ConfigService` en tiempo de arranque (el decorador `@Cron` se evalúa en carga del
 * módulo, antes de poder inyectar/consultar configuración). El job se registra con el
 * nombre `'barrido-expiracion-ttl'`.
 *
 * Frecuencia: `CRON_BARRIDO_EXPIRACION` del entorno (expresión cron) o, por defecto,
 * `'0 * * * *'` (minuto 0 de cada hora). No se depende de la precisión del timer: el
 * barrido es idempotente (D-4), así que un disparo perdido se recupera en la siguiente
 * pasada.
 *
 * Desactivación: sin `CRON_TOKEN` configurado, el disparo automático queda
 * efectivamente desactivado (el callback sale con log de advertencia); el endpoint
 * sigue disponible para disparo manual.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

const CRON_POR_DEFECTO = '0 * * * *';
const NOMBRE_JOB = 'barrido-expiracion-ttl';

@Injectable()
export class BarridoExpiracionScheduler implements OnModuleInit {
  private readonly logger = new Logger(BarridoExpiracionScheduler.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /**
   * Registra y arranca el cron del barrido con la frecuencia configurada
   * (`CRON_BARRIDO_EXPIRACION` o el default horario). El callback es `dispararBarrido`.
   */
  onModuleInit(): void {
    const expresionCron =
      this.configService.get<string>('CRON_BARRIDO_EXPIRACION') ?? CRON_POR_DEFECTO;

    const job = CronJob.from({
      cronTime: expresionCron,
      onTick: () => {
        void this.dispararBarrido();
      },
    });

    this.schedulerRegistry.addCronJob(NOMBRE_JOB, job);
    job.start();

    this.logger.log(
      `Barrido de expiración registrado (${NOMBRE_JOB}) con frecuencia cron "${expresionCron}".`,
    );
  }

  /**
   * Disparo periódico: llama al endpoint interno protegido con `X-Cron-Token`. Sin
   * `CRON_TOKEN` configurado, el disparo automático se desactiva (log de advertencia)
   * y el endpoint queda disponible para disparo manual.
   */
  async dispararBarrido(): Promise<void> {
    const token = this.configService.get<string>('CRON_TOKEN');
    if (!token) {
      this.logger.warn(
        'CRON_TOKEN no configurado: barrido de expiración automático desactivado (endpoint disponible para disparo manual).',
      );
      return;
    }
    const puerto = this.configService.get<number>('API_PORT') ?? 3000;
    const url = `http://localhost:${puerto}/api/cron/barrido-expiracion`;
    try {
      const respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'X-Cron-Token': token },
      });
      if (!respuesta.ok) {
        this.logger.error(
          `Barrido de expiración: respuesta HTTP ${respuesta.status}`,
        );
        return;
      }
      const resumen = await respuesta.json();
      this.logger.log(`Barrido de expiración ejecutado: ${JSON.stringify(resumen)}`);
    } catch (error) {
      this.logger.error(
        `Fallo al invocar el barrido de expiración: ${String(error)}`,
      );
    }
  }
}
