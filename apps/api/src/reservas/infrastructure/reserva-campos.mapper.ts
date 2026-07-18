/**
 * Mapper INFRAESTRUCTURA de los campos escalares de la RESERVA que usan enums Prisma
 * (`DuracionHoras`, `TipoEvento`) ↔ su valor de dominio (US-051 §Punto 2).
 *
 * El dominio del PATCH trabaja con `duracionHoras` como NÚMERO (`4|8|12`) y `tipoEvento`
 * como cadena libre (`'boda'`, etc.); Prisma los persiste como enum (`h4/h8/h12`,
 * mapeados a `4/8/12` en BD; y `boda/corporativo/...`). La traducción es un detalle de
 * persistencia, NO una migración. Vive en infraestructura (hexagonal), fuera del dominio.
 */
import { DuracionHoras, TipoEvento } from '@prisma/client';

/** Traduce el enum Prisma `DuracionHoras` al número de dominio (`h8 → 8`); null si ausente. */
export const duracionHorasPrismaADominio = (
  valor: DuracionHoras | null,
): number | null => {
  switch (valor) {
    case DuracionHoras.h4:
      return 4;
    case DuracionHoras.h8:
      return 8;
    case DuracionHoras.h12:
      return 12;
    default:
      return null;
  }
};

/** Traduce el número de dominio (`8 → h8`) al enum Prisma `DuracionHoras`. */
export const duracionHorasDominioAPrisma = (valor: number): DuracionHoras => {
  switch (valor) {
    case 4:
      return DuracionHoras.h4;
    case 8:
      return DuracionHoras.h8;
    case 12:
      return DuracionHoras.h12;
    default:
      throw new Error(`Duración de horas no soportada: ${String(valor)}`);
  }
};

/** Traduce la cadena de dominio del tipo de evento al enum Prisma `TipoEvento`. */
export const tipoEventoDominioAPrisma = (valor: string): TipoEvento => {
  if (valor in TipoEvento) {
    return TipoEvento[valor as keyof typeof TipoEvento];
  }
  throw new Error(`Tipo de evento no soportado: ${valor}`);
};
