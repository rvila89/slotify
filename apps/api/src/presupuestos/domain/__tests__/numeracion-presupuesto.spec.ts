/**
 * TESTS de la NUMERACIÓN `AAAANNN` del presupuesto CON IVA — DOMINIO PURO
 * (épico #6, rebanada 6.1b `documentos-presupuesto-pdf-con-iva`) — fase TDD RED.
 * tasks.md Fase 2: 2.1.
 *
 * Trazabilidad: spec-delta `presupuestos` (Requirement "Numeración del presupuesto
 * CON IVA por tenant y año"; escenarios "El primer presupuesto del tenant en el año
 * recibe el contador inicial" → 2026001, "El contador es único por tenant y se
 * incrementa" → 2026002, "El número reinicia con el año" → 2027001); design.md N1/N2
 * (formato `2026001` = año + contador de 3 dígitos, reinicio anual; unicidad
 * `(tenant_id, numero_presupuesto)` con el año embebido; `MAX`/reintento P2002 son de
 * la capa de infra, no del dominio). Calca el patrón de
 * `facturacion/domain/numeracion-factura.ts`.
 *
 * FUNCIÓN PURA de dominio (hook `no-infra-in-domain`): calcula el SIGUIENTE número a
 * partir del año de emisión y el ÚLTIMO número existente del tenant en ese año (que le
 * llega ya resuelto; la consulta `MAX` a BD y el reintento ante `P2002` viven en la
 * capa de aplicación/infra). No importa `@nestjs/*` ni Prisma.
 *
 * RED: aún NO existe `presupuestos/domain/numeracion-presupuesto.ts` con
 * `siguienteNumeroPresupuesto`. El import falla (TS2307) y la batería está en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { siguienteNumeroPresupuesto } from '../numeracion-presupuesto';

// ===========================================================================
// 2.1 — Primer presupuesto del tenant en el año: 2026001 (sin previo → null).
// ===========================================================================

describe('siguienteNumeroPresupuesto — primer presupuesto del año (2.1)', () => {
  it('debe_asignar_2026001_cuando_no_hay_ningun_presupuesto_previo_del_tenant_en_el_ano', () => {
    const numero = siguienteNumeroPresupuesto({ anio: 2026, ultimoNumero: null });

    expect(numero).toBe('2026001');
  });

  it('debe_tener_formato_ano_mas_contador_de_3_digitos', () => {
    const numero = siguienteNumeroPresupuesto({ anio: 2026, ultimoNumero: null });

    // Formato AAAANNN: año + contador de 3 dígitos con ceros a la izquierda.
    expect(numero).toMatch(/^2026\d{3}$/);
    expect(numero).toBe('2026001');
  });
});

// ===========================================================================
// 2.1 — Secuencia incremental por tenant+año: el segundo número es el siguiente.
// ===========================================================================

describe('siguienteNumeroPresupuesto — secuencia incremental (2.1)', () => {
  it('debe_asignar_2026002_cuando_el_ultimo_del_ano_es_2026001', () => {
    const numero = siguienteNumeroPresupuesto({ anio: 2026, ultimoNumero: '2026001' });

    expect(numero).toBe('2026002');
  });

  it.each([
    ['2026001', '2026002'],
    ['2026009', '2026010'],
    ['2026099', '2026100'],
    ['2026123', '2026124'],
  ])('debe_calcular_el_siguiente_de_%s_como_%s', (ultimo, esperado) => {
    expect(siguienteNumeroPresupuesto({ anio: 2026, ultimoNumero: ultimo })).toBe(esperado);
  });

  it('debe_crecer_el_numero_natural_por_encima_de_999_manteniendo_el_ano_embebido', () => {
    // El padding es a MÍNIMO 3 dígitos; por encima de 999 crece el natural (defensa,
    // no se espera en el MVP pero no debe romper el formato año+contador).
    const numero = siguienteNumeroPresupuesto({ anio: 2026, ultimoNumero: '2026999' });

    expect(numero).toBe('20261000');
  });
});

// ===========================================================================
// 2.1 — Cambio de año: la secuencia se REINICIA a 001 en el año nuevo.
// ===========================================================================

describe('siguienteNumeroPresupuesto — reinicio por año (2.1)', () => {
  it('debe_reiniciar_a_2027001_en_el_ano_nuevo_aunque_2026_tuviera_presupuestos', () => {
    // En 2027 no hay ningún presupuesto todavía (ultimoNumero del año 2027 = null),
    // aunque en 2026 existiera 2026007.
    const numero = siguienteNumeroPresupuesto({ anio: 2027, ultimoNumero: null });

    expect(numero).toBe('2027001');
  });

  it('debe_usar_el_ano_de_emision_en_el_prefijo_del_numero', () => {
    const n2026 = siguienteNumeroPresupuesto({ anio: 2026, ultimoNumero: null });
    const n2027 = siguienteNumeroPresupuesto({ anio: 2027, ultimoNumero: null });

    expect(n2026).toBe('2026001');
    expect(n2027).toBe('2027001');
  });
});

// ===========================================================================
// 2.1 — Defensa de año: si el último número no pertenece al año dado, se ignora
//        su secuencia y se reinicia a 001 (la infra ya filtra por año; esto es
//        una salvaguarda del dominio).
// ===========================================================================

describe('siguienteNumeroPresupuesto — defensa de año (2.1)', () => {
  it('debe_ignorar_el_ultimo_numero_de_otro_ano_y_reiniciar_a_001', () => {
    // ultimoNumero pertenece a 2026 pero calculamos para 2027 → se ignora su
    // secuencia y arranca en 2027001.
    const numero = siguienteNumeroPresupuesto({ anio: 2027, ultimoNumero: '2026042' });

    expect(numero).toBe('2027001');
  });
});

// ===========================================================================
// 2.1 — Independencia entre tenants: la función solo depende del último número
//        del PROPIO tenant en el año; dos tenants sin previos dan 2026001.
// ===========================================================================

describe('siguienteNumeroPresupuesto — numeración independiente por tenant (2.1)', () => {
  it('debe_dar_2026001_a_dos_tenants_distintos_sin_presupuestos_previos_ese_ano', () => {
    // La independencia la garantiza la unicidad (tenant_id, numero_presupuesto):
    // el cálculo del siguiente número solo mira el último del propio tenant.
    const tenantA = siguienteNumeroPresupuesto({ anio: 2026, ultimoNumero: null });
    const tenantB = siguienteNumeroPresupuesto({ anio: 2026, ultimoNumero: null });

    expect(tenantA).toBe('2026001');
    expect(tenantB).toBe('2026001');
  });
});
