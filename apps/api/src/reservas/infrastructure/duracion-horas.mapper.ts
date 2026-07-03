/**
 * Mapper INFRAESTRUCTURA de la duración del evento: literal del enum Prisma
 * `DuracionHoras` (`h4`, `h8`, `h12`) ↔ número de dominio (`4`, `8`, `12`).
 *
 * El enum Prisma `DuracionHoras` lleva `@map("4")` en BD, pero el CLIENTE Prisma
 * expone el literal con prefijo `h` (`'h4'`) porque un identificador TS no puede
 * empezar por dígito. El dominio trabaja con el número (`4`); traducir `h4 → 4` es
 * un detalle de persistencia. `Number('h4')` sería `NaN`: por eso hay que quitar el
 * prefijo `h` antes de convertir. Fuente ÚNICA de esta conversión (evita duplicar
 * la lógica en cada adaptador de lectura).
 */

/** Traduce la `DuracionHoras` del cliente Prisma (`'h8'`) al número de dominio (`8`); null si ausente. */
export const duracionHorasPrismaANumero = (
  duracion: string | null,
): number | null => (duracion === null ? null : Number(duracion.replace(/^h/, '')));
