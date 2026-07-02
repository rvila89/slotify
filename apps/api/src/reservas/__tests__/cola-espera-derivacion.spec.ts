/**
 * TESTS DE DOMINIO PURO de la DERIVACIÓN TEMPORAL de la vista de cola de espera
 * (US-017 / UC-11) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-017, spec-delta `consultas` (Requirement "Cálculo de TTL restante
 * y tiempo en cola como instantes": `ttlRestante = ttl_expiracion − now()`,
 * `tiempoEnCola = now() − fecha_creacion`, operando sobre instantes `timestamptz`,
 * NUNCA formateando fechas — mitiga el off-by-one de zona horaria documentado);
 * design.md §D-2 (derivación en backend sobre instantes), §D-6 (función pura de
 * derivación, unit-testeable sin BD), §D-7 (bloque TDD-RED: derivación pura incl. TTL
 * `null`). Los ejemplos de formato legible ("22 h", "2 h", "30 min") provienen del
 * contrato `docs/api-spec.yml` (`ColaBloqueante.ttlRestante`, `ColaItem.tiempoEnCola`).
 *
 * DOMINIO PURO (skill `tdd-core`, hexagonal, hook `no-infra-in-domain`): se ejercita
 * una función pura y determinista que recibe DOS INSTANTES `Date` y calcula el delta.
 * No hay `new Date()` interno ni Prisma ni `@nestjs/*`: el "ahora" se INYECTA como
 * instante, garantizando que el cálculo es sobre `timestamptz` y no sobre fechas
 * formateadas (regla anti off-by-one de TZ).
 *
 * NO hay tests de concurrencia ni de máquina de estados (lectura pura, design.md §D-7).
 *
 * RED: aún NO existe `domain/cola-espera-lectura.ts` ni la función de derivación. Los
 * imports fallan y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  derivarTtlRestante,
  derivarTiempoEnCola,
} from '../domain/cola-espera-lectura';

// Instante "ahora" fijo e inyectable: todo delta se calcula respecto a él.
const AHORA = new Date('2026-09-12T12:00:00.000Z');

const enHoras = (h: number): Date => new Date(AHORA.getTime() + h * 60 * 60 * 1000);
const haceHoras = (h: number): Date => new Date(AHORA.getTime() - h * 60 * 60 * 1000);
const haceMinutos = (m: number): Date => new Date(AHORA.getTime() - m * 60 * 1000);

// ===========================================================================
// ttlRestante = ttl_expiracion − now(), calculado SOBRE INSTANTES.
//   spec: "El TTL restante refleja ≈ 22 h calculado como ttl_expiracion − now()".
// ===========================================================================

describe('derivarTtlRestante — TTL restante desde instantes (ttl_expiracion − now())', () => {
  it('debe_calcular_22_h_cuando_el_ttl_expira_dentro_de_22_horas', () => {
    // Arrange
    const ttl = enHoras(22);

    // Act
    const restante = derivarTtlRestante(ttl, AHORA);

    // Assert — formato legible del contrato ("22 h").
    expect(restante).toBe('22 h');
  });

  it('debe_devolver_null_cuando_la_bloqueante_no_tiene_ttl_expiracion', () => {
    // spec: "El TTL restante SHALL ser null cuando la bloqueante no tiene ttl_expiracion".
    expect(derivarTtlRestante(null, AHORA)).toBeNull();
  });

  it('debe_derivar_del_delta_de_instantes_y_no_de_una_fecha_formateada', () => {
    // Anti off-by-one de TZ: el mismo instante UTC calculado con un "ahora" en
    // distinto offset local NO cambia el delta (el cálculo es sobre timestamptz).
    const ttl = enHoras(22);
    const ahoraOtroReloj = new Date(AHORA.getTime()); // mismo instante UTC.

    expect(derivarTtlRestante(ttl, ahoraOtroReloj)).toBe(
      derivarTtlRestante(ttl, AHORA),
    );
  });
});

// ===========================================================================
// tiempoEnCola = now() − fecha_creacion, calculado SOBRE INSTANTES.
//   spec: "El tiempo en cola refleja ≈ 30 min / ≈ 2 h calculado como now() − fecha_creacion".
// ===========================================================================

describe('derivarTiempoEnCola — tiempo en cola desde instantes (now() − fecha_creacion)', () => {
  it('debe_calcular_2_h_para_una_reserva_creada_hace_2_horas', () => {
    // Arrange
    const creada = haceHoras(2);

    // Act
    const enCola = derivarTiempoEnCola(creada, AHORA);

    // Assert — formato legible del contrato ("2 h").
    expect(enCola).toBe('2 h');
  });

  it('debe_calcular_30_min_para_una_reserva_creada_hace_30_minutos', () => {
    const creada = haceMinutos(30);

    expect(derivarTiempoEnCola(creada, AHORA)).toBe('30 min');
  });
});
