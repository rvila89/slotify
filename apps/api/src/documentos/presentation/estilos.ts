/**
 * Estilos compartidos de la plantilla de documentos react-pdf (épico #6, 6.1b;
 * REDISEÑADOS en 6.5 `documentos-rediseno-pdf-logo-storage` para replicar el
 * documento real de Masia `P2026023`).
 *
 * Layout FIJO; el CONTENIDO (colores de marca, textos) llega parametrizado desde la
 * config del tenant. El `colorPrimario` (turquesa `#5edada`) es dato del tenant; el
 * ACENTO amarillo (`COLOR_ACENTO`) es CONSTANTE de presentación (design.md §C, gate
 * SDD: NO dato del tenant). Se construyen con el `StyleSheet` inyectado del kit
 * (react-pdf no se importa estáticamente; ver `kit-react-pdf.ts`). Reutilizable por
 * presupuesto (6.1b/6.2), factura (6.3) y condicions (6.4a).
 */
import type { EstilosReactPdf, KitReactPdf } from './kit-react-pdf';

/**
 * Acento amarillo de la marca (línea inferior del bloque de condicions), CONSTANTE de
 * presentación (design.md §C): NO es dato del tenant. Se promovería a
 * `branding.colorSecundario` en un change aparte si el multi-tenant lo exigiera.
 */
export const COLOR_ACENTO = '#ffd978';

/** Gris de bordes/líneas del layout. */
const COLOR_BORDE = '#BBBBBB';
/** Blanco para el texto sobre la barra turquesa del concepto. */
const COLOR_SOBRE_PRIMARIO = '#FFFFFF';

export const construirEstilos = (StyleSheet: KitReactPdf['StyleSheet']): EstilosReactPdf =>
  StyleSheet.create({
    pagina: {
      paddingTop: 36,
      paddingBottom: 44,
      paddingHorizontal: 44,
      fontSize: 10,
      fontFamily: 'Helvetica',
      color: '#333333',
    },

    // --- Cabecera: logo arriba-izquierda + identidad fiscal arriba-derecha ---
    cabecera: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 24,
    },
    cabeceraLogo: { width: 150, height: 70, objectFit: 'contain' },
    cabeceraIdentidad: { alignItems: 'flex-end', maxWidth: 240 },
    cabeceraTitulo: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
    cabeceraLinea: { fontSize: 9, marginTop: 2, textAlign: 'right' },
    cabeceraEnlace: { fontSize: 9, marginTop: 2, textAlign: 'right', color: '#2563EB' },

    // --- Título grande "PRESSUPOST"/"FACTURA" en turquesa ---
    tituloDocumento: {
      fontSize: 26,
      fontFamily: 'Helvetica-Bold',
      marginBottom: 6,
    },

    // --- Franja título: bloque "Dades client" (izq) + tabla meta (der) ---
    filaTitulo: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 22,
    },
    columnaCliente: { flex: 1, paddingRight: 20 },
    columnaTitulo: { width: 250, alignItems: 'flex-end' },

    // Bloque "Dades client": título subrayado + líneas.
    clienteTitulo: {
      fontSize: 11,
      fontFamily: 'Helvetica-Bold',
      borderBottomWidth: 0.5,
      borderBottomColor: COLOR_BORDE,
      paddingBottom: 3,
      marginBottom: 4,
    },

    // Mini-tabla con borde `Pressupost | Data` (o `Factura | Data`).
    tablaMeta: {
      width: 250,
      borderWidth: 0.5,
      borderColor: COLOR_BORDE,
    },
    tablaMetaFila: { flexDirection: 'row' },
    tablaMetaCeldaEtiqueta: {
      flex: 1,
      paddingVertical: 5,
      paddingHorizontal: 6,
      textAlign: 'center',
      borderRightWidth: 0.5,
      borderRightColor: COLOR_BORDE,
      borderBottomWidth: 0.5,
      borderBottomColor: COLOR_BORDE,
    },
    tablaMetaCeldaEtiquetaUltima: {
      flex: 1,
      paddingVertical: 5,
      paddingHorizontal: 6,
      textAlign: 'center',
      borderBottomWidth: 0.5,
      borderBottomColor: COLOR_BORDE,
    },
    tablaMetaCeldaValor: {
      flex: 1,
      paddingVertical: 5,
      paddingHorizontal: 6,
      textAlign: 'center',
      borderRightWidth: 0.5,
      borderRightColor: COLOR_BORDE,
    },
    tablaMetaCeldaValorUltima: {
      flex: 1,
      paddingVertical: 5,
      paddingHorizontal: 6,
      textAlign: 'center',
    },

    // --- Tabla de concepto: barra turquesa + cuerpo con borde ---
    conceptoCabeceraBarra: {
      flexDirection: 'row',
      paddingVertical: 6,
      paddingHorizontal: 8,
    },
    conceptoCabeceraConcepto: {
      flex: 1,
      color: COLOR_SOBRE_PRIMARIO,
      fontFamily: 'Helvetica-Bold',
    },
    conceptoCabeceraPreu: {
      width: 90,
      textAlign: 'right',
      color: COLOR_SOBRE_PRIMARIO,
      fontFamily: 'Helvetica-Bold',
    },
    conceptoCuerpo: {
      borderWidth: 0.5,
      borderColor: COLOR_BORDE,
      borderTopWidth: 0,
      minHeight: 260,
      padding: 10,
    },
    conceptoFilaPrincipal: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    conceptoPrincipalTexto: { flex: 1, paddingRight: 8, fontFamily: 'Helvetica-Bold' },
    conceptoPrecio: { width: 90, textAlign: 'right' },
    conceptoDetalleLinea: { marginTop: 4, marginLeft: 10 },
    // Subtítulo de referencia de la factura (change `factura-pdf-fiel-referencia`, §D1/§D2):
    // línea indentada NO negrita bajo el concepto principal (el 40/60 con nº de presupuesto).
    conceptoSubtituloLinea: {
      marginTop: 3,
      marginLeft: 10,
      fontFamily: 'Helvetica',
    },
    conceptoExtraFila: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 6,
    },
    conceptoExtraTexto: { flex: 1, paddingRight: 8, marginLeft: 10 },

    // --- Franja de totales: `Validesa | Base imp. | % Iva | Total` ---
    totalesTabla: { marginTop: 22, marginBottom: 22 },
    totalesFilaEtiquetas: {
      flexDirection: 'row',
      borderBottomWidth: 0.5,
      borderBottomColor: COLOR_BORDE,
      paddingBottom: 4,
    },
    totalesFilaValores: { flexDirection: 'row', paddingTop: 4 },
    totalesCeldaIzquierda: { flex: 1, paddingHorizontal: 4 },
    totalesCeldaDerecha: { flex: 1, paddingHorizontal: 4, textAlign: 'right' },
    totalesEtiqueta: { fontFamily: 'Helvetica-Bold' },
    totalesEtiquetaDestacada: { fontFamily: 'Helvetica-Bold' },
    totalesValorDestacado: { fontFamily: 'Helvetica-Bold' },
    totalesSeparadorCelda: {
      borderLeftWidth: 0.5,
      borderLeftColor: COLOR_BORDE,
    },

    // --- Condicions de pagament: mini-tabla 3 columnas + acento amarillo ---
    condicionsBloque: { marginBottom: 8 },
    condicionsTitulo: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
    condicionsTabla: {
      borderTopWidth: 0.5,
      borderTopColor: COLOR_BORDE,
    },
    condicionsFila: { flexDirection: 'row' },
    condicionsCeldaPct: {
      width: 90,
      paddingVertical: 3,
      paddingHorizontal: 6,
      textAlign: 'center',
      borderRightWidth: 0.5,
      borderRightColor: COLOR_BORDE,
    },
    condicionsCeldaImporte: {
      width: 120,
      paddingVertical: 3,
      paddingHorizontal: 6,
      textAlign: 'center',
      borderRightWidth: 0.5,
      borderRightColor: COLOR_BORDE,
    },
    condicionsCeldaEtiqueta: {
      flex: 1,
      paddingVertical: 3,
      paddingHorizontal: 6,
    },
    condicionsAcento: {
      height: 3,
      backgroundColor: COLOR_ACENTO,
      marginTop: 0,
    },

    // --- Pie centrado + IBAN ---
    pieCentrado: { marginTop: 10, alignItems: 'center' },
    pieLinea: { textAlign: 'center', marginBottom: 2 },
    pieIban: { textAlign: 'center', marginTop: 4 },

    // --- Compartidos / legado (usados por condicions y utilidades) ---
    seccion: { marginBottom: 16 },
    seccionTitulo: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
    linea: { marginBottom: 2 },
    negrita: { fontFamily: 'Helvetica-Bold' },
    // Bloque de firma de las condicions particulars (épico #6, 6.4a): etiqueta + línea
    // en blanco para rellenar a mano.
    filaFirma: { marginTop: 14 },
    etiquetaFirma: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
    lineaFirma: { marginTop: 4, borderBottomWidth: 0.5, borderBottomColor: '#999999' },
  });
