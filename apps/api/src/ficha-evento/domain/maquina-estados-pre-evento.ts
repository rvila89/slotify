/**
 * Máquina de estados de `RESERVA.pre_evento_status` (US-025 / UC-20 / Módulo M7) —
 * DOMINIO PURO.
 *
 * Modela las transiciones del sub-proceso pre-evento como ESTRUCTURA DE DATOS
 * declarativa + una guarda pura sobre el contenido de la ficha (design.md §D-1/§D-2;
 * CLAUDE.md «las transiciones permitidas y sus guardas se modelan como estructura de
 * datos, no como código disperso»). Solo dos aristas válidas:
 *   - `pendiente → en_curso` (primer guardado con datos, ver `tieneAlgunDatoDeContenido`).
 *   - `en_curso → cerrado`  (acción "Cerrar ficha").
 * `cerrado` es ESTABLE: no existe `cerrado → *` (la edición post-cierre NO reabre, §D-4).
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): no importa `@nestjs/*`, Prisma ni
 * infraestructura. Solo tipos y funciones puras sobre estructuras de datos.
 */

/** Estados del sub-proceso pre-evento (alineado con el enum Prisma `PreEventoStatus`). */
export type PreEventoStatus = 'pendiente' | 'en_curso' | 'cerrado';

/**
 * Contenido de la ficha operativa relevante para la guarda «primer guardado con
 * datos» (§D-2). Son los 7 campos de contenido; el resto (fichaCerrada, fechaCierre,
 * ids) no cuenta como "dato".
 */
export interface ContenidoFicha {
  numInvitadosConfirmado: number | null;
  menuSeleccionado: string | null;
  timingDetallado: string | null;
  contactoEventoNombre: string | null;
  contactoEventoTelefono: string | null;
  notasOperativas: string | null;
  briefingEquipo: string | null;
}

/**
 * Tabla declarativa de transiciones válidas: para cada estado origen, el conjunto de
 * destinos permitidos. Un destino ausente = transición inválida. No hay identidades
 * (`x → x`), ni saltos, ni retrocesos, ni reapertura de `cerrado`.
 */
const TRANSICIONES: Readonly<Record<PreEventoStatus, ReadonlyArray<PreEventoStatus>>> = {
  pendiente: ['en_curso'],
  en_curso: ['cerrado'],
  cerrado: [],
};

/** ¿Es válida la transición `origen → destino` según la tabla declarativa? */
export const esTransicionPreEventoValida = (
  origen: PreEventoStatus,
  destino: PreEventoStatus,
): boolean => TRANSICIONES[origen].includes(destino);

/**
 * Mapa declarativo del CIERRE AUTOMÁTICO A10 en T-1d (US-026 / UC-20 FA-01, actor
 * Sistema): para cada `pre_evento_status` de origen, el destino del cierre forzado por
 * el barrido. Los dos estados ABIERTOS (`pendiente`, `en_curso`) transicionan a
 * `cerrado`; `cerrado` es ESTABLE y NO es candidato (idempotencia: no-op → sin destino).
 * Es una ESTRUCTURA DE DATOS, no `if` dispersos (CLAUDE.md §Máquina de estados).
 */
const CIERRE_AUTOMATICO_A10: Readonly<Record<PreEventoStatus, PreEventoStatus | null>> = {
  pendiente: 'cerrado',
  en_curso: 'cerrado',
  cerrado: null,
};

/**
 * Resuelve el destino del cierre automático A10 para un `pre_evento_status` de origen:
 * `'cerrado'` cuando la RESERVA es candidata (`pendiente`/`en_curso`); `null` cuando ya
 * NO lo es (`cerrado`, idempotente/no-op). Base declarativa de la idempotencia del
 * barrido: la guarda se re-evalúa dentro de la transacción de cada RESERVA (D-4/D-6).
 * Función pura y determinista.
 */
export const resolverCierreAutomatico = (
  origen: PreEventoStatus,
): PreEventoStatus | null => CIERRE_AUTOMATICO_A10[origen];

/** Nombres de los campos de texto de contenido (para la guarda de "dato de texto"). */
const CAMPOS_TEXTO: ReadonlyArray<keyof ContenidoFicha> = [
  'menuSeleccionado',
  'timingDetallado',
  'contactoEventoNombre',
  'contactoEventoTelefono',
  'notasOperativas',
  'briefingEquipo',
];

/** Un string es "dato" si, tras recortar blancos, no queda vacío. `null` = sin dato. */
const esTextoConDato = (valor: string | null): boolean =>
  valor !== null && valor.trim().length > 0;

/**
 * Guarda «primer guardado con datos» (§D-2): la ficha tiene al menos un campo de
 * contenido no nulo/no vacío. Un string en blanco/solo espacios cuenta como vacío;
 * `numInvitadosConfirmado` cuenta como dato si es un entero presente (incluido 0).
 * Función pura y determinista.
 */
export const tieneAlgunDatoDeContenido = (ficha: ContenidoFicha): boolean => {
  if (ficha.numInvitadosConfirmado !== null) {
    return true;
  }
  return CAMPOS_TEXTO.some((campo) => esTextoConDato(ficha[campo] as string | null));
};
