/**
 * TESTS de la GUARDA PURA de la fianza `debeEnviarseE5(fianzaEur)` de US-034 (UC-25)
 * — fase TDD RED. tasks.md Fase 3: 3.2.
 *
 * Trazabilidad: US-034, spec-delta `comunicaciones` (Requirements "E5 (solicitud de IBAN)
 * se dispara al finalizar el evento solo si fianza_eur > 0" y "fianza_eur IS NULL se trata
 * como sin fianza"), design.md §D-4:
 *   `debeEnviarseE5(fianzaEur: number | null): boolean = fianzaEur != null && fianzaEur > 0`
 * `NULL` y `0` colapsan a `false` (sin E5); un negativo (defensivo) también es `false`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): función determinista sin efectos, sin
 * `@nestjs/*`/Prisma. Es la ÚNICA fuente de verdad de "¿corresponde disparar E5?": la
 * transición a `post_evento` es incondicional, pero E5 está condicionado a esta guarda.
 *
 * RED: aún NO existe `debeEnviarseE5` en `reservas/domain/maquina-estados.ts`. La batería
 * está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { debeEnviarseE5 } from '../domain/maquina-estados';

describe('debeEnviarseE5 — guarda pura de la fianza (design.md §D-4)', () => {
  it('debe_ser_true_cuando_fianza_eur_es_mayor_que_cero', () => {
    expect(debeEnviarseE5(1000)).toBe(true);
    expect(debeEnviarseE5(0.01)).toBe(true);
  });

  it('debe_ser_false_cuando_fianza_eur_es_cero', () => {
    expect(debeEnviarseE5(0)).toBe(false);
  });

  it('debe_ser_false_cuando_fianza_eur_es_null', () => {
    // NULL == "sin fianza" (dato inconsistente si fianza_status=cobrada; NUNCA envía E5).
    expect(debeEnviarseE5(null)).toBe(false);
  });

  it('debe_ser_false_cuando_fianza_eur_es_negativo_caso_defensivo', () => {
    // Un negativo no es un importe de fianza válido: nunca dispara E5 (defensivo).
    expect(debeEnviarseE5(-50)).toBe(false);
  });

  it('debe_ser_determinista_para_la_misma_entrada', () => {
    expect(debeEnviarseE5(1000)).toBe(debeEnviarseE5(1000));
    expect(debeEnviarseE5(null)).toBe(debeEnviarseE5(null));
  });
});
