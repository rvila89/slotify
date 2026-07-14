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
const ETIQUETAS_FIRMA: ReadonlyArray<string> = [
  'NOM I COGNOMS CLIENT',
  'SIGNATURA CLIENT',
  'DNI',
  'DATA ESDEVENIMENT',
];

/**
 * Construye el modelo de vista del documento a partir de la config del tenant. PURA y
 * determinista: todas las aserciones de CONTENIDO recaen aquí. El bloque de firma va en
 * blanco (solo etiquetas). Con 0 secciones el modelo sigue teniendo título + firma (D3).
 */
export const construirModeloDocumentoCondiciones = (
  config: ConfiguracionDocumentoTenant,
): ModeloDocumentoCondiciones => ({
  titulo: config.condiciones.titulo,
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
    titulo: seccion.titulo,
    cuerpo: seccion.cuerpo,
  })),
  firma: { etiquetas: ETIQUETAS_FIRMA },
});
