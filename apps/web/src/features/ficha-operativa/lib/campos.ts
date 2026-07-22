import type { PreEventoStatus } from '../model/types';

/** Campos de texto libre de la ficha (contacto, hora, notas, briefing). */
export type CampoTextoFicha =
  | 'contactoEventoNombre'
  | 'contactoEventoTelefono'
  | 'contactoEventoCorreo'
  | 'horaLlegada'
  | 'notasOperativas'
  | 'briefingEquipo';

type DefinicionCampo = {
  campo: CampoTextoFicha;
  etiqueta: string;
  /** `texto` → input; `area` → textarea; `email` → input de correo; `hora` → HH:MM. */
  tipo: 'texto' | 'area' | 'email' | 'hora';
  placeholder?: string;
  /** Colocar el campo a ancho completo (2 columnas) en el grid del formulario. */
  anchoCompleto?: boolean;
};

/**
 * Definición declarativa de los campos de TEXTO LIBRE de la ficha operativa (US-025 ·
 * UC-20), en el orden de presentación. El aforo ESTRUCTURAL (desglose de invitados),
 * el nº de personas derivado y la duración enum se renderizan aparte en `CamposFicha`
 * (no son inputs de texto libre). Tabla de datos (no JSX disperso) que alimenta el
 * formulario y la traducción de `avisosCamposVacios` a etiquetas en español.
 */
export const CAMPOS_TEXTO_FICHA: readonly DefinicionCampo[] = [
  { campo: 'contactoEventoNombre', etiqueta: 'Contacto del evento', tipo: 'texto', placeholder: 'Ej. María López' },
  { campo: 'contactoEventoTelefono', etiqueta: 'Teléfono de contacto', tipo: 'texto', placeholder: 'Ej. 600 123 456' },
  { campo: 'contactoEventoCorreo', etiqueta: 'Correo de contacto', tipo: 'email', placeholder: 'correo@ejemplo.com' },
  { campo: 'horaLlegada', etiqueta: 'Hora de llegada', tipo: 'hora', placeholder: 'HH:MM' },
  { campo: 'notasOperativas', etiqueta: 'Notas operativas', tipo: 'area', placeholder: 'Ej. Alergia a los frutos secos', anchoCompleto: true },
  { campo: 'briefingEquipo', etiqueta: 'Briefing para el equipo', tipo: 'area', placeholder: 'Instrucciones para el equipo del evento', anchoCompleto: true },
] as const;

/**
 * Mapa campo → etiqueta para traducir `avisosCamposVacios` (camelCase) a español.
 * Incluye los campos estructurales/derivado (aunque se renderizan aparte) por si el
 * backend los reportara como vacíos al cerrar.
 */
export const ETIQUETA_CAMPO: Record<string, string> = {
  ...CAMPOS_TEXTO_FICHA.reduce(
    (acc, { campo, etiqueta }) => ({ ...acc, [campo]: etiqueta }),
    {} as Record<string, string>,
  ),
  numInvitadosConfirmado: 'Nº de invitados confirmado',
  numAdultosNinosMayores4: 'Adultos y niños ≥ 4 años',
  numNinosMenores4: 'Niños < 4 años',
  duracionHoras: 'Duración del evento',
  duracion: 'Duración',
};

/**
 * Traduce los nombres camelCase devueltos en `avisosCamposVacios` a las etiquetas en
 * español; si aparece un campo desconocido, cae al propio nombre para no perder el
 * aviso informativo.
 */
export const etiquetasCamposVacios = (avisos: readonly string[]): string[] =>
  avisos.map((campo) => ETIQUETA_CAMPO[campo] ?? campo);

/** Duraciones estructurales admitidas (enum del contrato `DuracionHoras`). */
export const DURACIONES_HORAS = [4, 8, 12] as const;

/** Etiqueta legible de una duración de evento. */
export const etiquetaDuracion = (horas: number): string => `${horas} horas`;

/** Metadatos visuales del indicador de estado del sub-proceso pre-evento (US-025). */
export const ESTADO_PRE_EVENTO: Record<
  PreEventoStatus,
  { etiqueta: string; clase: string }
> = {
  pendiente: {
    etiqueta: 'Pendiente',
    clase: 'border-border-default/40 bg-surface-muted/60 text-text-secondary',
  },
  en_curso: {
    etiqueta: 'En curso',
    clase: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  cerrado: {
    etiqueta: 'Cerrada',
    clase: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
};
