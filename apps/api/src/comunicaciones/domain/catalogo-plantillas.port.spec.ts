/**
 * Test de CONTRATO del puerto de dominio `CatalogoPlantillasPort` (US-045).
 * tasks.md Fase 2: 2.1 / 2.7 (contrato del puerto).
 *
 * Trazabilidad: US-045, spec-delta `comunicaciones` (Requirement: "Catálogo de
 * plantillas por código de email e idioma del tenant"), design.md §3.
 *
 * El puerto es una interfaz PURA (sin lógica ejecutable): su comportamiento real se
 * ejercita en `catalogo-plantillas.spec.ts` (infra) y en `despachar-email.service.spec.ts`
 * (motor) mediante dobles. Aquí se fija el CONTRATO de forma: una implementación
 * conforme expone `seleccionar(codigoEmail, idioma)` que devuelve una `Plantilla` con
 * metadatos (código, idioma, activa, variables/adjuntos requeridos) y un `render`
 * tipado, o `null` si no hay plantilla en ese idioma.
 *
 * RED: aún no existen `catalogo-plantillas.port.ts` ni `codigo-email.ts`; los imports
 * fallan y la batería está en ROJO. GREEN = `backend-developer`.
 */
import type {
  CatalogoPlantillasPort,
  Plantilla,
  RenderPlantilla,
} from './catalogo-plantillas.port';
import type { CodigoEmail } from './codigo-email';

describe('CatalogoPlantillasPort — contrato del puerto de dominio', () => {
  it('debe_aceptar_una_implementacion_que_seleccione_por_codigo_e_idioma_o_devuelva_null', () => {
    const plantillaE1: Plantilla = {
      codigoEmail: 'E1',
      idioma: 'es',
      activa: true,
      variablesRequeridas: ['email'],
      adjuntosRequeridos: [],
      render: (variables): RenderPlantilla => ({
        asunto: 'Hemos recibido tu consulta',
        cuerpoHtml: `<p>Hola ${String(variables.nombre ?? '')}</p>`,
        cuerpoTexto: `Hola ${String(variables.nombre ?? '')}`,
      }),
    };
    const catalogo: CatalogoPlantillasPort = {
      seleccionar: (codigoEmail: CodigoEmail, idioma: string): Plantilla | null =>
        codigoEmail === 'E1' && idioma === 'es' ? plantillaE1 : null,
    };

    const seleccionada = catalogo.seleccionar('E1', 'es');
    expect(seleccionada?.codigoEmail).toBe('E1');
    expect(catalogo.seleccionar('E1', 'ca')).toBeNull();

    const render = seleccionada?.render({ nombre: 'Marta' });
    expect(render?.asunto).toContain('consulta');
    expect(render?.cuerpoHtml).toContain('Marta');
  });
});
