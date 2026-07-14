/**
 * TESTS de la NUMERACIÓN POR RÉGIMEN (doble secuencia) — DOMINIO PURO (épico #6,
 * rebanada 6.2 `documentos-presupuesto-sin-iva-doble-numeracion`) — fase TDD RED.
 * tasks.md Fase 3: 3.2.
 *
 * Trazabilidad: spec-delta `presupuestos` (Requirement MODIFICADO "Numeración del
 * presupuesto por tenant, año y régimen (doble secuencia)"; escenarios "Cada régimen
 * tiene su propia secuencia desde 001", "Cada secuencia se incrementa
 * independientemente", "La secuencia CON IVA continúa la de 6.1b (reconciliación)",
 * "Cada secuencia reinicia con el año"); design.md D2 (Opción A — literal `AAAANNN`
 * COMPARTIDO entre CON/SIN, diferenciado por la columna `regimen_iva` de la unicidad
 * `@@unique([tenantId, regimenIva, numeroPresupuesto])`; la consulta `MAX` discrimina por
 * régimen: `ultimoNumeroDelAnio(tenantId, anio, regimen)`).
 *
 * MODELADO (design.md D2, patrón 6.1b): el CÁLCULO del siguiente número sigue siendo la
 * función pura `siguienteNumeroPresupuesto(anio, ultimoNumero)` REUTILIZADA de 6.1b — no
 * cambia su firma. La "doble secuencia" se logra porque la INFRA
 * (`ultimoNumeroDelAnio(tenantId, anio, regimen)`) devuelve el último número del PROPIO
 * régimen; el dominio, alimentado con el último de CADA régimen por separado, produce dos
 * secuencias independientes que pueden compartir el literal `2026001` (la unicidad
 * `[tenantId, regimenIva, numeroPresupuesto]` las mantiene sin colisión). Este test fija,
 * a nivel de dominio, que alimentar el último de cada régimen produce secuencias
 * INDEPENDIENTES; la consulta `MAX` discriminada por régimen y la unicidad ampliada se
 * verifican en la suite de integración (sesión principal, con Postgres).
 *
 * FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): no importa `@nestjs/*` ni Prisma.
 *
 * RED: `siguienteNumeroPresupuesto` YA existe de 6.1b, pero el enum `RegimenIva` (que
 * este test importa para tipar las dos secuencias) aún NO existe en
 * `regimen-desde-metodo-pago`. El import falla (TS2307) y la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN del enum. GREEN es de `backend-developer`.
 */
import { siguienteNumeroPresupuesto } from '../numeracion-presupuesto';
import type { RegimenIva } from '../regimen-desde-metodo-pago';

const CON_IVA: RegimenIva = 'con_iva';
const SIN_IVA: RegimenIva = 'sin_iva';

/**
 * Doble secuencia in-memory: modela lo que la INFRA (`ultimoNumeroDelAnio(tenantId,
 * anio, regimen)`) entrega — el último número del PROPIO régimen — y delega el cálculo
 * en la función pura de dominio. Cada régimen mantiene su propio `ultimoNumero`.
 */
const crearDobleSecuencia = (
  iniciales: { con_iva: string | null; sin_iva: string | null } = {
    con_iva: null,
    sin_iva: null,
  },
) => {
  const ultimoPorRegimen: Record<RegimenIva, string | null> = { ...iniciales };
  return {
    /** Asigna el siguiente número al régimen y avanza SOLO su secuencia. */
    asignar: (anio: number, regimen: RegimenIva): string => {
      const numero = siguienteNumeroPresupuesto({
        anio,
        ultimoNumero: ultimoPorRegimen[regimen],
      });
      ultimoPorRegimen[regimen] = numero;
      return numero;
    },
    ultimoDe: (regimen: RegimenIva): string | null => ultimoPorRegimen[regimen],
  };
};

// ===========================================================================
// 3.2 — Cada régimen arranca en AAAA001 (literal compartido, sin colisión).
// ===========================================================================

describe('numeración por régimen — cada secuencia arranca en 001 (3.2)', () => {
  it('debe_asignar_2026001_al_primer_con_iva_y_2026001_al_primer_sin_iva_del_tenant', () => {
    const secuencia = crearDobleSecuencia();

    const numeroConIva = secuencia.asignar(2026, CON_IVA);
    const numeroSinIva = secuencia.asignar(2026, SIN_IVA);

    // Ambos comparten el literal 2026001; la unicidad
    // [tenantId, regimenIva, numeroPresupuesto] permite que coexistan (integración).
    expect(numeroConIva).toBe('2026001');
    expect(numeroSinIva).toBe('2026001');
  });
});

// ===========================================================================
// 3.2 — Cada secuencia se incrementa INDEPENDIENTEMENTE: avanzar CON IVA no
//        mueve SIN IVA y viceversa.
// ===========================================================================

describe('numeración por régimen — secuencias independientes (3.2)', () => {
  it('debe_incrementar_solo_la_secuencia_con_iva_dejando_sin_iva_intacta', () => {
    const secuencia = crearDobleSecuencia({ con_iva: '2026001', sin_iva: '2026001' });

    const nuevoConIva = secuencia.asignar(2026, CON_IVA);

    // CON IVA avanza a 2026002; SIN IVA permanece en 2026001.
    expect(nuevoConIva).toBe('2026002');
    expect(secuencia.ultimoDe(SIN_IVA)).toBe('2026001');
  });

  it('debe_incrementar_solo_la_secuencia_sin_iva_dejando_con_iva_intacta', () => {
    const secuencia = crearDobleSecuencia({ con_iva: '2026005', sin_iva: '2026003' });

    const nuevoSinIva = secuencia.asignar(2026, SIN_IVA);

    // SIN IVA avanza a 2026004; CON IVA permanece en 2026005.
    expect(nuevoSinIva).toBe('2026004');
    expect(secuencia.ultimoDe(CON_IVA)).toBe('2026005');
  });

  it('debe_intercalar_asignaciones_de_ambos_regimenes_sin_que_compartan_contador', () => {
    const secuencia = crearDobleSecuencia();

    // CON, SIN, CON, SIN, CON  → CON: 001,002,003 ; SIN: 001,002
    expect(secuencia.asignar(2026, CON_IVA)).toBe('2026001');
    expect(secuencia.asignar(2026, SIN_IVA)).toBe('2026001');
    expect(secuencia.asignar(2026, CON_IVA)).toBe('2026002');
    expect(secuencia.asignar(2026, SIN_IVA)).toBe('2026002');
    expect(secuencia.asignar(2026, CON_IVA)).toBe('2026003');

    expect(secuencia.ultimoDe(CON_IVA)).toBe('2026003');
    expect(secuencia.ultimoDe(SIN_IVA)).toBe('2026002');
  });
});

// ===========================================================================
// 3.2 — La secuencia CON IVA CONTINÚA la de 6.1b (reconciliación): los
//        presupuestos de 6.1b (backfill regimen_iva='con_iva') son la secuencia
//        CON; un nuevo CON IVA continúa sin reiniciar.
// ===========================================================================

describe('numeración por régimen — CON IVA continúa la secuencia de 6.1b (3.2)', () => {
  it('debe_asignar_2026008_cuando_la_secuencia_con_iva_de_6_1b_llega_a_2026007', () => {
    // Los presupuestos de 6.1b (todos CON IVA por backfill) llegan a 2026007.
    const secuencia = crearDobleSecuencia({ con_iva: '2026007', sin_iva: null });

    const nuevoConIva = secuencia.asignar(2026, CON_IVA);

    // Continúa la secuencia CON, sin reiniciar.
    expect(nuevoConIva).toBe('2026008');
  });

  it('debe_arrancar_sin_iva_en_001_aunque_con_iva_venga_de_6_1b_en_2026007', () => {
    // La secuencia SIN IVA es nueva en 6.2: arranca en 001 aunque CON venga de 6.1b.
    const secuencia = crearDobleSecuencia({ con_iva: '2026007', sin_iva: null });

    const primerSinIva = secuencia.asignar(2026, SIN_IVA);

    expect(primerSinIva).toBe('2026001');
  });
});

// ===========================================================================
// 3.2 — Cada secuencia REINICIA con el año (el año va embebido en el literal).
// ===========================================================================

describe('numeración por régimen — reinicio anual por régimen (3.2)', () => {
  it('debe_reiniciar_ambas_secuencias_a_2027001_en_el_ano_nuevo', () => {
    // En 2026: CON hasta 2026005, SIN hasta 2026003. En 2027 no hay número previo de
    // ningún régimen (la infra filtra por año → null), así que ambos reinician a 001.
    const secuencia = crearDobleSecuencia({ con_iva: null, sin_iva: null });

    const conIva2027 = secuencia.asignar(2027, CON_IVA);
    const sinIva2027 = secuencia.asignar(2027, SIN_IVA);

    expect(conIva2027).toBe('2027001');
    expect(sinIva2027).toBe('2027001');
  });

  it('debe_ignorar_el_ultimo_de_otro_ano_al_reiniciar_cada_regimen', () => {
    // Defensa del dominio: un último de 2026 no cuenta para 2027 (arranca en 001).
    const secuencia = crearDobleSecuencia({ con_iva: '2026005', sin_iva: '2026003' });

    expect(secuencia.asignar(2027, CON_IVA)).toBe('2027001');
    expect(secuencia.asignar(2027, SIN_IVA)).toBe('2027001');
  });
});
