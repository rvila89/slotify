/**
 * Catálogo de plantillas en CÓDIGO `CatalogoPlantillasEnCodigo` (US-045, design.md
 * §3).
 *
 * INFRAESTRUCTURA que implementa el puerto de dominio `CatalogoPlantillasPort`:
 * registro tipado, indexado por `codigoEmail` + idioma, con render por interpolación
 * (sin motor de plantillas externo). MVP entrega el idioma `es`; otros idiomas
 * devuelven `null` para que el motor aplique el fallback a `es` + AUDIT_LOG.
 *
 * Cobertura E1–E8: **E1 está ACTIVA** (render real). **E2–E8** quedan DECLARADAS
 * como diseñadas/INACTIVAS (sin trigger cableado en este change); su render real se
 * completa en la US que cablea cada trigger (E2→US-014, E3→US-021/022/023, …).
 */
import { Injectable } from '@nestjs/common';
import type {
  CatalogoPlantillasPort,
  Plantilla,
  RenderPlantilla,
} from '../../domain/catalogo-plantillas.port';
import type { CodigoEmail } from '../../domain/codigo-email';

/** Texto seguro a partir de una variable (evita `undefined`/`null` en el render). */
const texto = (valor: unknown): string =>
  valor === null || valor === undefined ? '' : String(valor);

/** Render real de la plantilla E1 (respuesta inicial automática a la consulta). */
const renderE1 = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const asunto = 'Hemos recibido tu consulta';
  const cuerpoTexto = [
    `Hola ${nombre},`,
    '',
    'Gracias por tu interés. Hemos recibido tu consulta y te contactaremos en breve.',
    '',
    'Un saludo.',
  ].join('\n');
  const cuerpoHtml = [
    `<p>Hola ${nombre},</p>`,
    '<p>Gracias por tu interés. Hemos recibido tu consulta y te contactaremos en breve.</p>',
    '<p>Un saludo.</p>',
  ].join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/**
 * Render genérico de un email aún DISEÑADO/INACTIVO (E2, E4–E8). No se dispara en este
 * change; su contenido definitivo llega con la US que cablea el trigger.
 */
const renderInactivo = (codigo: CodigoEmail) => (
  _variables: Record<string, unknown>,
): RenderPlantilla => ({
  asunto: `Plantilla ${codigo} (pendiente de cableado)`,
  cuerpoHtml: `<p>Plantilla ${codigo} diseñada pero inactiva.</p>`,
  cuerpoTexto: `Plantilla ${codigo} diseñada pero inactiva.`,
});

/**
 * Render real de la plantilla E3 (factura de señal 40% + condicions particulars). Se activa en
 * la rebanada 6.4b (`documentos-enviar-factura-senal-e3`): cierra el hito de confirmación con la
 * factura de señal adjunta y anuncia al cliente los próximos hitos del evento.
 */
const renderE3 = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const codigoReserva = texto(variables.codigoReserva);
  const referencia = codigoReserva === '' ? '' : ` (reserva ${codigoReserva})`;
  const asunto = `Confirmación de tu reserva y factura de señal${referencia}`;
  const cuerpoTexto = [
    `Hola ${nombre},`,
    '',
    'Hemos confirmado tu reserva. Adjuntamos la factura de la señal (40%) y las',
    'condicions particulars de tu evento.',
    '',
    'Próximos hitos:',
    '- Revisa y firma las condicions particulars adjuntas.',
    '- Coordinaremos contigo los detalles del evento en las próximas semanas.',
    '- La liquidación del importe restante se emitirá tras el evento.',
    '',
    'Un saludo.',
  ].join('\n');
  const cuerpoHtml = [
    `<p>Hola ${nombre},</p>`,
    '<p>Hemos confirmado tu reserva. Adjuntamos la factura de la señal (40%) y las ' +
      'condicions particulars de tu evento.</p>',
    '<p>Próximos hitos:</p>',
    '<ul>',
    '<li>Revisa y firma las condicions particulars adjuntas.</li>',
    '<li>Coordinaremos contigo los detalles del evento en las próximas semanas.</li>',
    '<li>La liquidación del importe restante se emitirá tras el evento.</li>',
    '</ul>',
    '<p>Un saludo.</p>',
  ].join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/** Plantilla E1 ACTIVA en `es` con su contrato de variables requeridas. */
const PLANTILLA_E1_ES: Plantilla = {
  codigoEmail: 'E1',
  idioma: 'es',
  activa: true,
  variablesRequeridas: ['nombre', 'email'],
  adjuntosRequeridos: [],
  render: renderE1,
};

/**
 * Plantilla E3 ACTIVA en `es` (factura de señal + condicions particulars, 6.4b). La factura de
 * señal es el adjunto REQUERIDO; las condicions particulars son OPCIONALES (degradan sin tumbar
 * el envío, §D-adjunto-condiciones), por eso NO figuran en `adjuntosRequeridos`.
 */
const PLANTILLA_E3_ES: Plantilla = {
  codigoEmail: 'E3',
  idioma: 'es',
  activa: true,
  variablesRequeridas: ['nombre', 'email', 'codigoReserva'],
  adjuntosRequeridos: ['senal'],
  render: renderE3,
};

/** Códigos diferidos: declarados como diseñados/inactivos (sin trigger). */
const CODIGOS_DIFERIDOS: ReadonlyArray<CodigoEmail> = [
  'E2',
  'E4',
  'E5',
  'E6',
  'E7',
  'E8',
];

/** Construye una entrada inactiva en `es` para un código diferido. */
const plantillaInactivaEs = (codigo: CodigoEmail): Plantilla => ({
  codigoEmail: codigo,
  idioma: 'es',
  activa: false,
  variablesRequeridas: [],
  adjuntosRequeridos: [],
  render: renderInactivo(codigo),
});

@Injectable()
export class CatalogoPlantillasEnCodigo implements CatalogoPlantillasPort {
  /** Registro indexado por `codigoEmail` (solo idioma `es` en el MVP). */
  private readonly registroEs: ReadonlyMap<CodigoEmail, Plantilla> = new Map<
    CodigoEmail,
    Plantilla
  >([
    ['E1', PLANTILLA_E1_ES],
    ['E3', PLANTILLA_E3_ES],
    ...CODIGOS_DIFERIDOS.map(
      (codigo): [CodigoEmail, Plantilla] => [codigo, plantillaInactivaEs(codigo)],
    ),
  ]);

  seleccionar(codigoEmail: CodigoEmail, idioma: string): Plantilla | null {
    // MVP: solo `es`. Otros idiomas → null (el motor aplica fallback a `es`).
    if (idioma !== 'es') {
      return null;
    }
    return this.registroEs.get(codigoEmail) ?? null;
  }
}
