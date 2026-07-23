/**
 * MODELO DE VISTA del documento de "Condicions particulars" (épico #6, rebanada
 * 6.4a `documentos-condiciones-particulares-pdf`) — capa de presentación de
 * `documentos`.
 *
 * Función PURA `construirModeloDocumentoCondiciones(config)` que proyecta el modelo
 * de vista a partir SOLO de la config del tenant: título del documento, secciones
 * (título + cuerpo) y las etiquetas del bloque de firma. El documento es LEGAL, largo
 * e IDÉNTICO por tenant: el bloque de firma va EN BLANCO (sin datos de reserva); sus
 * etiquetas son LAYOUT FIJO (no contenido de negocio), igual que las etiquetas de
 * columnas del presupuesto en 6.1b. Determinista, sin react-pdf.
 *
 * Reutiliza `CabeceraModelo` del presupuesto para pintar la misma cabecera del tenant
 * (nombre comercial / identidad fiscal / branding).
 */
import type { ConfiguracionDocumentoTenant } from '../domain/configuracion-documento';
import type { CabeceraModelo } from './modelo-documento-presupuesto';

/** Una sección del documento, tal como se pinta (título + cuerpo). */
export interface SeccionModeloCondiciones {
  titulo: string;
  cuerpo: string;
}

/** Bloque de firma EN BLANCO: solo etiquetas fijas de layout, sin valores de reserva. */
export interface FirmaModeloCondiciones {
  etiquetas: ReadonlyArray<string>;
}

/** MODELO DE VISTA completo del documento de condicions particulars. */
export interface ModeloDocumentoCondiciones {
  titulo: string;
  cabecera: CabeceraModelo;
  secciones: ReadonlyArray<SeccionModeloCondiciones>;
  firma: FirmaModeloCondiciones;
}

/**
 * Etiquetas fijas del bloque de firma (LAYOUT FIJO, no contenido de negocio). El orden
 * es contractual (verificado por el test de plantilla).
 */
const ETIQUETAS_FIRMA_CA: ReadonlyArray<string> = [
  'NOM I COGNOMS CLIENT',
  'SIGNATURA CLIENT',
  'DNI',
  'DATA ESDEVENIMENT',
];

const ETIQUETAS_FIRMA_ES: ReadonlyArray<string> = [
  'NOMBRE Y APELLIDOS CLIENTE',
  'FIRMA CLIENTE',
  'DNI',
  'FECHA DEL EVENTO',
];

/**
 * Construye el modelo de vista del documento a partir de la config del tenant y el
 * IDIOMA de la reserva (Mejora A). PURA y determinista: todas las aserciones de CONTENIDO
 * recaen aquí. El `idioma` selecciona el texto del JSON bilingüe (título y secciones); por
 * defecto `ca` para preservar el comportamiento previo. El bloque de firma va en blanco
 * (solo etiquetas). Con 0 secciones el modelo sigue teniendo título + firma (D3).
 */
export const construirModeloDocumentoCondiciones = (
  config: ConfiguracionDocumentoTenant,
  idioma: 'es' | 'ca' = 'ca',
): ModeloDocumentoCondiciones => ({
  // Mejora A: el idioma de la reserva elige el texto del JSON bilingüe (título/secciones).
  titulo: config.condiciones.titulo[idioma],
  cabecera: {
    // Las condicions no muestran el desglose fiscal ni dependen del régimen: cabecera con
    // nombre comercial + identidad fiscal + branding del tenant (mismo componente que 6.1b).
    soloTexto: config.branding.logoUrl === null,
    mostrarIdentidadFiscal: true,
    logoUrl: config.branding.logoUrl,
    colorPrimario: config.branding.colorPrimario,
    colorTexto: config.branding.colorTexto,
    razonSocialFiscal: config.identidadFiscal.razonSocialFiscal,
    nombreComercial: config.identidadFiscal.nombreComercial,
    nif: config.identidadFiscal.nif,
    direccionFiscal: config.identidadFiscal.direccionFiscal,
    web: config.identidadFiscal.web,
    email: config.identidadFiscal.email,
  },
  secciones: config.condiciones.secciones.map((seccion) => ({
    titulo: seccion.titulo[idioma],
    cuerpo: seccion.cuerpo[idioma],
  })),
  firma: { etiquetas: idioma === 'ca' ? ETIQUETAS_FIRMA_CA : ETIQUETAS_FIRMA_ES },
});
