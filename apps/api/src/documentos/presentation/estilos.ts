/**
 * Estilos compartidos de la plantilla de documentos react-pdf (épico #6, 6.1b).
 *
 * Layout FIJO y neutro; el CONTENIDO (colores de marca, textos) llega parametrizado
 * desde la config del tenant. Se construyen con el `StyleSheet` inyectado del kit
 * (react-pdf no se importa estáticamente; ver `kit-react-pdf.ts`). Reutilizable por
 * presupuesto (6.1b) y factura (6.3).
 */
import type { EstilosReactPdf, KitReactPdf } from './kit-react-pdf';

export const construirEstilos = (StyleSheet: KitReactPdf['StyleSheet']): EstilosReactPdf =>
  StyleSheet.create({
    pagina: {
      paddingTop: 40,
      paddingBottom: 48,
      paddingHorizontal: 44,
      fontSize: 10,
      fontFamily: 'Helvetica',
      color: '#333333',
    },
    cabecera: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 20,
      borderBottomWidth: 2,
      paddingBottom: 12,
    },
    cabeceraLogo: { width: 120, height: 48, objectFit: 'contain' },
    cabeceraTitulo: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
    cabeceraLinea: { fontSize: 9, marginTop: 2 },
    seccion: { marginBottom: 16 },
    seccionTitulo: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
    filaMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
    linea: { marginBottom: 2 },
    tablaFila: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 4,
      borderBottomWidth: 0.5,
      borderBottomColor: '#DDDDDD',
    },
    tablaConcepto: { flex: 1, paddingRight: 8 },
    tablaImporte: { width: 90, textAlign: 'right' },
    totalesBloque: { marginTop: 8, alignItems: 'flex-end' },
    totalesFila: { flexDirection: 'row', width: 220, justifyContent: 'space-between' },
    totalesEtiqueta: { textAlign: 'right' },
    totalesValor: { width: 90, textAlign: 'right' },
    totalDestacado: { fontFamily: 'Helvetica-Bold', fontSize: 12 },
    pie: { marginTop: 24, borderTopWidth: 1, borderTopColor: '#DDDDDD', paddingTop: 10 },
    negrita: { fontFamily: 'Helvetica-Bold' },
    validesa: { marginTop: 12, fontSize: 9, fontStyle: 'italic' },
  });
