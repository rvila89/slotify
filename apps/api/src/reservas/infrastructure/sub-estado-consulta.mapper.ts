/**
 * Mapper INFRAESTRUCTURA del sub-estado de consulta: valor de dominio `2a` ↔
 * literal Prisma `s2a` (US-003, design.md §2.1).
 *
 * El enum Prisma `SubEstadoConsulta` NO tiene `@map`, así que sus literales en
 * BD/Prisma llevan el prefijo `s` (un identificador TS no puede empezar por
 * dígito). El dominio trabaja con `2a`; la traducción a `s2a` (y su inversa) es un
 * detalle de persistencia, NO una migración. El mapeo es total y reversible:
 * basta anteponer/quitar el prefijo `s`.
 */
import type { SubEstadoConsulta } from '../domain/maquina-estados';

/** Literal del enum Prisma `SubEstadoConsulta` (prefijo `s` + valor de dominio). */
export type SubEstadoConsultaPrisma = `s${SubEstadoConsulta}`;

/** Traduce el valor de dominio (`'2a'`) al literal Prisma (`'s2a'`). */
export const subEstadoDominioAPrisma = (
  subEstado: SubEstadoConsulta,
): SubEstadoConsultaPrisma => `s${subEstado}`;

/** Traduce el literal Prisma (`'s2a'`) de vuelta al valor de dominio (`'2a'`). */
export const subEstadoPrismaADominio = (
  subEstado: SubEstadoConsultaPrisma,
): SubEstadoConsulta => subEstado.slice(1) as SubEstadoConsulta;
