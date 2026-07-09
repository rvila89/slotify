/**
 * Adaptador CONSERVADOR del puerto `DocumentacionEventoPort` (US-034 / UC-25, §D-7).
 *
 * El checklist de documentación del evento (DNI anverso/reverso, cláusula de
 * responsabilidad) es superficie de US-033, que aún NO está expuesta en el código. US-034
 * solo CONSULTA su completitud para una advertencia INFORMATIVA no bloqueante; mientras
 * US-033 no aterrice, este adaptador devuelve `[]` (sin ítems pendientes). Es FAIL-OPEN por
 * diseño: en el peor caso no se advierte y la finalización procede — coherente con "no
 * bloqueante". Cuando US-033 exponga el checklist, este stub se sustituye por el adaptador
 * real sin tocar el caso de uso (hexagonal).
 */
import { Injectable } from '@nestjs/common';
import type { DocumentacionEventoPort } from '../application/finalizar-evento.use-case';

@Injectable()
export class DocumentacionEventoStubAdapter implements DocumentacionEventoPort {
  async itemsPendientes(
    _reservaId: string,
    _tenantId: string,
  ): Promise<string[]> {
    // US-033 aún no expone el checklist: sin ítems pendientes (fail-open, no bloquea).
    return [];
  }
}
