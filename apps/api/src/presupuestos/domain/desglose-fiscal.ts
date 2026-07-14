/**
 * Desglose fiscal congelado y reparto de pago del PRESUPUESTO — DOMINIO PURO
 * (US-014 / UC-14, design.md §D-5).
 *
 * Funciones PURAS de dominio (hook `no-infra-in-domain`): no importan `@nestjs/*`,
 * Prisma ni infraestructura. El total ENTRA con IVA 21% incluido (el motor de tarifa
 * de US-016 devuelve `precio_tarifa_eur` con IVA incluido, y el precio manual del
 * caso `tarifa_a_consultar` también es IVA incluido); el desglose sólo DERIVA la base
 * y el IVA a partir de él:
 *   - `total = totalConIva - (descuentoEur ?? 0)`
 *   - `baseImponible = total / 1.21`
 *   - `ivaImporte = total - baseImponible`
 *   - `ivaPorcentaje = "21.00"` (constante MVP)
 *
 * El reparto informativo 40%/60% + fianza (§D-5) deriva `pctSenal` y `fianzaDefaultEur`
 * de TENANT_SETTINGS (nunca hardcodeados en la lógica). La fianza NO forma parte del
 * total. Todos los importes se expresan como Decimal string de 2 decimales (los tipos
 * `Importe`/`Porcentaje` del contrato), para no perder precisión al persistir.
 *
 * 6.2 (`documentos-presupuesto-sin-iva-doble-numeracion`, design.md §"Impacto en el
 * cálculo fiscal por régimen"): el cálculo se PARAMETRIZA por `RegimenIva`. La BASE
 * imponible (`total_entrada / 1.21`) es la MISMA en ambos regímenes; lo que cambia es si
 * se le suma el IVA. CON IVA (transferencia): `total = base + IVA21`. SIN IVA (efectivo):
 * `total = base`, `ivaImporte = 0`, `ivaPorcentaje = 0` — el importe MENOR. El reparto
 * 40/60 opera sobre el `total` del régimen ya resuelto (que la capa de aplicación pasa
 * como `totalConIva`); la fianza es fija (setting), igual en ambos.
 */
import type { RegimenIva } from './regimen-desde-metodo-pago';

/** Porcentaje de IVA aplicado en el MVP (constante de negocio). */
const IVA_PORCENTAJE = 21;

/** Divisor derivado del IVA (1 + 21/100) para separar base e IVA de un total. */
const DIVISOR_IVA = 1 + IVA_PORCENTAJE / 100;

/** Formatea un número EUR a Decimal string de 2 decimales (redondeo estándar). */
const aDecimal2 = (valor: number): string => valor.toFixed(2);

/** Desglose fiscal congelado del PRESUPUESTO (importes Decimal string, 2 dec). */
export interface DesgloseFiscal {
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
}

/** Reparto informativo de pago 40% señal / 60% liquidación + fianza aparte. */
export interface RepartoPago {
  senalEur: string;
  liquidacionEur: string;
  fianzaEur: string;
}

/** Entrada del desglose fiscal: total con IVA incluido, descuento opcional y régimen. */
export interface CalcularDesgloseFiscalInput {
  /** Total con IVA 21% incluido (precio de tarifa + extras, o precio manual). */
  totalConIva: number;
  /** Descuento a restar del total antes de derivar base e IVA (opcional). */
  descuentoEur?: number;
  /** Régimen fiscal derivado del método de pago: gobierna si se suma el IVA (6.2). */
  regimen: RegimenIva;
}

/** Entrada del reparto: total del régimen + porcentaje de señal + fianza del tenant. */
export interface CalcularRepartoInput {
  /** Total del RÉGIMEN sobre el que se calcula el reparto 40/60 (la app lo pasa aquí). */
  totalConIva: number;
  /** Porcentaje de señal (TENANT_SETTINGS.pct_senal), p. ej. 40. */
  pctSenal: number;
  /** Importe de la fianza (TENANT_SETTINGS.fianza_default_eur), aparte del total. */
  fianzaDefaultEur: number;
  /** Régimen fiscal (no altera el reparto: opera sobre el total ya resuelto). */
  regimen: RegimenIva;
}

/**
 * Deriva el desglose fiscal según el RÉGIMEN. En ambos regímenes se resta primero el
 * descuento y se deriva la MISMA base imponible (`total_neto / 1.21`). La ramificación
 * por régimen es DECLARATIVA (una tabla de estrategias, sin `if` dispersos):
 *   - CON IVA: `total = base + IVA21`; `ivaImporte = total - base` (invariante contable
 *     `base + IVA = total` a 2 dec); `ivaPorcentaje = 21`.
 *   - SIN IVA: `total = base`; `ivaImporte = 0`, `ivaPorcentaje = 0` (importe MENOR).
 */
export const calcularDesgloseFiscal = (
  input: CalcularDesgloseFiscalInput,
): DesgloseFiscal => {
  const totalNeto = input.totalConIva - (input.descuentoEur ?? 0);
  // La BASE es idéntica en ambos regímenes: se deriva del total de entrada (con IVA).
  const baseImponible = Number(aDecimal2(totalNeto / DIVISOR_IVA));
  return DESGLOSE_POR_REGIMEN[input.regimen](baseImponible, totalNeto);
};

/**
 * Estrategias de desglose por régimen (tabla declarativa). Cada estrategia recibe la base
 * ya derivada (común) y el total neto de entrada, y resuelve total/IVA de SU régimen.
 */
const DESGLOSE_POR_REGIMEN: Record<
  RegimenIva,
  (baseImponible: number, totalNeto: number) => DesgloseFiscal
> = {
  // CON IVA: el total es el de entrada (con IVA); el IVA se deriva como la diferencia
  // sobre los valores YA redondeados para garantizar base + IVA = total (2 dec).
  con_iva: (baseImponible, totalNeto) => {
    const totalRedondeado = Number(aDecimal2(totalNeto));
    const ivaImporte = Number(aDecimal2(totalRedondeado - baseImponible));
    return {
      baseImponible: aDecimal2(baseImponible),
      ivaPorcentaje: aDecimal2(IVA_PORCENTAJE),
      ivaImporte: aDecimal2(ivaImporte),
      total: aDecimal2(totalRedondeado),
    };
  },
  // SIN IVA: el total es la base (sin el 21%), sin línea de IVA (importe MENOR).
  sin_iva: (baseImponible) => ({
    baseImponible: aDecimal2(baseImponible),
    ivaPorcentaje: aDecimal2(0),
    ivaImporte: aDecimal2(0),
    total: aDecimal2(baseImponible),
  }),
};

/**
 * Calcula el reparto informativo 40%/60% + fianza sobre el `total` del RÉGIMEN ya resuelto
 * (la capa de aplicación pasa ese total como `totalConIva`). `senalEur = total *
 * pctSenal/100`; `liquidacionEur = total - senalEur` (para que señal + liquidación = total
 * a 2 dec); `fianzaEur` es el importe del setting, fuera del total, igual en ambos regímenes.
 */
export const calcularReparto = (input: CalcularRepartoInput): RepartoPago => {
  const total = Number(aDecimal2(input.totalConIva));
  const senal = Number(aDecimal2((total * input.pctSenal) / 100));
  const liquidacion = Number(aDecimal2(total - senal));
  return {
    senalEur: aDecimal2(senal),
    liquidacionEur: aDecimal2(liquidacion),
    fianzaEur: aDecimal2(input.fianzaDefaultEur),
  };
};
