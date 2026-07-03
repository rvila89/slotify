/**
 * DTO HTTP de la promoción MANUAL de cola: `POST /reservas/{id}/promover` (US-019).
 * Nombre ALINEADO con el contrato OpenAPI (`PromoverManualRequest`; respuesta 200 =
 * `Reserva`). El cuerpo lleva `confirmado: boolean` (defensa en servidor de la acción
 * destructiva, D-1); el body es OPCIONAL en el contrato para preservar la compatibilidad
 * con la promoción AUTOMÁTICA de US-018 (sin body), pero la promoción manual exige
 * `confirmado: true`.
 *
 * VALIDACIÓN de `confirmado` → **422** (contrato op `promoverConsultaCola`): la valida el
 * DOMINIO (`PromoverManualEnColaService` → `PromocionManualConfirmacionError`, que el
 * controlador mapea a 422), NO `class-validator`. Motivo (igual que
 * `ExtenderBloqueoRequestDto`): el `ValidationPipe` GLOBAL (`main.ts`) corre ANTES que
 * cualquier pipe local y, con `@IsBoolean`, rechazaría con su 400 por defecto —
 * divergente del contrato. Por eso `confirmado` NO lleva decoradores de regla: `@Allow()`
 * solo lo incluye en el whitelist (`whitelist + forbidNonWhitelisted`) para que no lo
 * elimine ni lo rechace con 400; el rechazo (`false`/ausente) lo hace la guarda del
 * dominio → 422.
 */
import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

/** Cuerpo de la petición de promoción manual: confirmación explícita del Gestor. */
export class PromoverManualRequestDto {
  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      'DEBE ser true para ejecutar la promoción manual (acción destructiva: expira la ' +
      'bloqueante actual a 2x, irreversible). Si es false o falta, el servidor rechaza ' +
      'con 422 sin efectos. Validación a 422 en el dominio (no class-validator).',
  })
  @Allow()
  confirmado?: boolean;
}
