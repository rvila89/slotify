/**
 * Caso de uso de aplicación: liberación de fechas EN LOTE (US-041 / UC-31, D-9).
 *
 * Orquesta N liberaciones (barrido del cron de TTL, descartes de cola) delegando
 * cada fecha al servicio de dominio `LiberarFechaService`. Cada fecha se procesa en
 * su PROPIA transacción independiente (la del adaptador Prisma dentro de
 * `liberar()`), de modo que el fallo de una (p. ej. la guarda firme rechaza una
 * fecha) queda AISLADO y no impide liberar las demás. Cada éxito dispara, dentro
 * del servicio, la promoción de cola si corresponde (exactamente una vez por fecha).
 *
 * Hexagonal: orquesta el dominio puro; no toca Prisma ni frameworks directamente.
 *
 * NOTA TDD: la batería RED de este caso de uso vive en el spec de integración
 * hermano `__tests__/liberar-fecha-integracion.spec.ts` (describe
 * `liberarFechasEnLote() — fallo aislado por fecha`), que importa y ejercita esta
 * clase contra Postgres real.
 */
import {
  LiberarFechaService,
  type LiberacionResultado,
  type LiberarFechaComando,
} from '../domain/liberar-fecha.service';

/** Resultado por-ítem del lote: liberada (resuelta) o fallida (aislada). */
export interface LiberacionLoteItem {
  comando: LiberarFechaComando;
  estado: 'liberada' | 'fallida';
  resultado?: LiberacionResultado;
  error?: unknown;
}

export class LiberarFechasEnLoteService {
  constructor(private readonly servicio: LiberarFechaService) {}

  async ejecutar(comandos: LiberarFechaComando[]): Promise<LiberacionLoteItem[]> {
    const items: LiberacionLoteItem[] = [];
    // Secuencial con fallo aislado por fecha: cada `ejecutar` abre su propia
    // transacción; un rechazo (guarda firme) se captura y no aborta el lote.
    for (const comando of comandos) {
      try {
        const resultado = await this.servicio.ejecutar(comando);
        items.push({ comando, estado: 'liberada', resultado });
      } catch (error) {
        items.push({ comando, estado: 'fallida', error });
      }
    }
    return items;
  }
}
