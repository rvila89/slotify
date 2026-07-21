import type { GuardarFichaOperativaRequest, PreEventoStatus } from '../model/types';

/** Nombre (camelCase) de cada campo de contenido de la ficha operativa (US-025). */
export type CampoFicha = keyof GuardarFichaOperativaRequest;

type DefinicionCampo = {
  campo: CampoFicha;
  etiqueta: string;
  /**
   * `numero` → input numérico entero; `texto` → input; `area` → textarea;
   * `email` → input de correo; `hora` → input de hora (HH:MM).
   */
  tipo: 'numero' | 'texto' | 'area' | 'email' | 'hora';
  placeholder?: string;
  /** Colocar el campo a ancho completo (2 columnas) en el grid del formulario. */
  anchoCompleto?: boolean;
};

/**
 * Definición declarativa de los campos de la ficha operativa (US-025 · UC-20),
 * en el orden de presentación. Tabla de datos (no JSX disperso) que alimenta tanto
 * el formulario como la traducción de `avisosCamposVacios` a etiquetas en español.
 */
export const CAMPOS_FICHA: readonly DefinicionCampo[] = [
  { campo: 'numInvitadosConfirmado', etiqueta: 'Nº de invitados confirmado', tipo: 'numero', placeholder: 'Ej. 85' },
  { campo: 'contactoEventoNombre', etiqueta: 'Contacto del evento', tipo: 'texto', placeholder: 'Ej. María López' },
  { campo: 'contactoEventoTelefono', etiqueta: 'Teléfono de contacto', tipo: 'texto', placeholder: 'Ej. 600 123 456' },
  { campo: 'contactoEventoCorreo', etiqueta: 'Correo de contacto', tipo: 'email', placeholder: 'correo@ejemplo.com' },
  { campo: 'horaLlegada', etiqueta: 'Hora de llegada', tipo: 'hora', placeholder: 'HH:MM' },
  { campo: 'duracion', etiqueta: 'Duración', tipo: 'texto', placeholder: 'ej: 3h, 2h 30min' },
  { campo: 'notasOperativas', etiqueta: 'Notas operativas', tipo: 'area', placeholder: 'Ej. Alergia a los frutos secos', anchoCompleto: true },
  { campo: 'briefingEquipo', etiqueta: 'Briefing para el equipo', tipo: 'area', placeholder: 'Instrucciones para el equipo del evento', anchoCompleto: true },
] as const;

/** Mapa campo → etiqueta, para traducir `avisosCamposVacios` (camelCase) a español. */
export const ETIQUETA_CAMPO: Record<CampoFicha, string> = CAMPOS_FICHA.reduce(
  (acc, { campo, etiqueta }) => ({ ...acc, [campo]: etiqueta }),
  {} as Record<CampoFicha, string>,
);

/**
 * Traduce los nombres camelCase devueltos en `avisosCamposVacios` a las etiquetas en
 * español; si aparece un campo desconocido, cae al propio nombre para no perder el
 * aviso informativo.
 */
export const etiquetasCamposVacios = (avisos: readonly string[]): string[] =>
  avisos.map((campo) => ETIQUETA_CAMPO[campo as CampoFicha] ?? campo);

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
