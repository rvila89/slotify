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
 */

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

/** Entrada del desglose fiscal: total con IVA incluido y descuento opcional. */
export interface CalcularDesgloseFiscalInput {
  /** Total con IVA 21% incluido (precio de tarifa + extras, o precio manual). */
  totalConIva: number;
  /** Descuento a restar del total antes de derivar base e IVA (opcional). */
  descuentoEur?: number;
}

/** Entrada del reparto: total con IVA + porcentaje de señal + fianza del tenant. */
export interface CalcularRepartoInput {
  /** Total (con IVA) sobre el que se calcula el reparto 40/60. */
  totalConIva: number;
  /** Porcentaje de señal (TENANT_SETTINGS.pct_senal), p. ej. 40. */
  pctSenal: number;
  /** Importe de la fianza (TENANT_SETTINGS.fianza_default_eur), aparte del total. */
  fianzaDefaultEur: number;
}

/**
 * Deriva el desglose fiscal (base, IVA 21%, total) de un total con IVA incluido,
 * restando primero el descuento si lo hay. `ivaImporte = total - base` para que la
 * invariante contable `base + IVA = total` se cumpla a 2 decimales.
 */
export const calcularDesgloseFiscal = (
  input: CalcularDesgloseFiscalInput,
): DesgloseFiscal => {
  const total = input.totalConIva - (input.descuentoEur ?? 0);
  // Se redondean base y total a 2 decimales; el IVA se deriva como la diferencia
  // sobre los valores YA redondeados para garantizar base + IVA = total (2 dec).
  const totalRedondeado = Number(aDecimal2(total));
  const baseImponible = Number(aDecimal2(total / DIVISOR_IVA));
  const ivaImporte = Number(aDecimal2(totalRedondeado - baseImponible));
  return {
    baseImponible: aDecimal2(baseImponible),
    ivaPorcentaje: aDecimal2(IVA_PORCENTAJE),
    ivaImporte: aDecimal2(ivaImporte),
    total: aDecimal2(totalRedondeado),
  };
};

/**
 * Calcula el reparto informativo 40%/60% + fianza. `senalEur = total * pctSenal/100`;
 * `liquidacionEur = total - senalEur` (para que señal + liquidación = total a 2 dec);
 * `fianzaEur` es el importe del setting, fuera del total.
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
