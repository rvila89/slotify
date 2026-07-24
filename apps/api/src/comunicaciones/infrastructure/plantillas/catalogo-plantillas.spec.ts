/**
 * TESTS del catálogo de plantillas en código `CatalogoPlantillasEnCodigo`
 * (US-045) — fase TDD RED. tasks.md Fase 2: 2.7.
 *
 * Trazabilidad: US-045, spec-delta `comunicaciones` (Requirement: "Catálogo de
 * plantillas por código de email e idioma del tenant"; Scenarios: "La plantilla se
 * selecciona por código e idioma del tenant", "E2–E8 están diseñadas pero no se
 * disparan en este change"), design.md §3 (catálogo tipado en código, indexado por
 * `codigo_email` + idioma, i18n con default/fallback `es`; E1 ACTIVA con render real,
 * E2–E8 DECLARADAS como diseñadas/INACTIVAS).
 *
 * El catálogo es INFRAESTRUCTURA: implementa el puerto de dominio
 * `CatalogoPlantillasPort`. Aquí se verifica el contenido declarado (E1 activa,
 * E2–E8 inactivas), la selección por idioma y la ausencia de plantilla en idiomas
 * no provistos (que el motor resuelve con fallback `es`).
 *
 * RED: aún no existen
 * `comunicaciones/infrastructure/plantillas/catalogo-plantillas.ts` ni los puertos
 * de dominio; los imports fallan y la batería está en ROJO. GREEN = `backend-developer`.
 */
import { CatalogoPlantillasEnCodigo } from './catalogo-plantillas';
import type { CodigoEmail } from '../../domain/codigo-email';

// E3 pasa a ACTIVA en la rebanada 6.4b (documentos-enviar-factura-senal-e3) y E2 en el change
// `presupuesto-prereserva-cta-descarte-y-e2` (workstream C; su activación se verifica en
// `catalogo-plantillas-e2.spec.ts`); ya no son diferidas. El resto sigue diseñado/inactivo.
// fix-liquidacion-fianza-independientes: E4 se ACTIVA (liquidación standalone). E5/E8 quedan
// inactivas (captura de IBAN retirada); E6/E7 siguen diferidas.
const E_DIFERIDOS: ReadonlyArray<CodigoEmail> = ['E5', 'E6', 'E7', 'E8'];

describe('CatalogoPlantillasEnCodigo — E1 activa y E2–E8 diseñadas/inactivas (2.7)', () => {
  it('debe_seleccionar_la_plantilla_E1_en_es_y_marcarla_como_activa', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E1', 'es');

    expect(plantilla).not.toBeNull();
    expect(plantilla?.codigoEmail).toBe('E1');
    expect(plantilla?.idioma).toBe('es');
    expect(plantilla?.activa).toBe(true);
  });

  it('debe_declarar_las_variables_requeridas_de_la_plantilla_E1', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E1', 'es');

    // La plantilla declara su contrato de variables (nombre del cliente + casuística E1).
    expect(plantilla?.variablesRequeridas).toEqual(
      expect.arrayContaining(['nombre', 'tipoE1']),
    );
  });

  it('debe_renderizar_la_plantilla_E1_con_asunto_y_cuerpo_a_partir_de_las_variables', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E1', 'es');
    const render = plantilla?.render({ nombre: 'Marta', email: 'marta.soler@example.com' });

    expect(render?.asunto.length).toBeGreaterThan(0);
    expect(render?.cuerpoHtml.length).toBeGreaterThan(0);
    expect(render?.cuerpoTexto.length).toBeGreaterThan(0);
  });

  it('debe_declarar_E2_a_E8_como_disenadas_pero_inactivas_sin_trigger', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    for (const codigo of E_DIFERIDOS) {
      const plantilla = catalogo.seleccionar(codigo, 'es');
      // Declarada (existe la entrada) pero INACTIVA: sin trigger cableado en este change.
      expect(plantilla).not.toBeNull();
      expect(plantilla?.activa).toBe(false);
    }
  });

  it('no_debe_tener_plantilla_en_un_idioma_no_provisto_para_que_el_motor_aplique_fallback', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    // El MVP entrega `es` y `ca`; cualquier otro idioma (ej. `fr`) no está provisto →
    // `seleccionar` devuelve `null` para que el FALLBACK a `es` + AUDIT_LOG lo aplique el
    // MOTOR (`DespacharEmailService`), no el catálogo (change
    // `presupuesto-confirmar-ux-e2-idioma`, workstream E).
    expect(catalogo.seleccionar('E1', 'fr')).toBeNull();
  });
});

// ===========================================================================
// 3.8 — Activación de la plantilla E3 (documentos-enviar-factura-senal-e3, 6.4b).
//   E3 pasa a activa=true con render real (asunto + cuerpo canónicos, NO el
//   placeholder de `renderInactivo`); declara el contrato de adjuntos: la factura
//   de señal es REQUERIDA y las condicions particulars son OPCIONALES
//   (§D-ruta-email / §D-adjunto-condiciones).
// ===========================================================================

describe('CatalogoPlantillasEnCodigo — E3 activa con render real (3.8)', () => {
  it('debe_marcar_la_plantilla_E3_en_es_como_activa', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'es');

    expect(plantilla).not.toBeNull();
    expect(plantilla?.codigoEmail).toBe('E3');
    expect(plantilla?.idioma).toBe('es');
    expect(plantilla?.activa).toBe(true);
  });

  it('debe_renderizar_E3_con_asunto_y_cuerpo_reales_no_el_placeholder_de_renderInactivo', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'es');
    const render = plantilla?.render({
      nombre: 'Marta',
      email: 'marta.soler@example.com',
      codigoReserva: 'SLO-2026-0023',
    });

    expect(render?.asunto.length).toBeGreaterThan(0);
    expect(render?.cuerpoHtml.length).toBeGreaterThan(0);
    expect(render?.cuerpoTexto.length).toBeGreaterThan(0);
    // NO es el placeholder de una plantilla inactiva.
    expect(render?.asunto).not.toContain('pendiente de cableado');
    expect(render?.cuerpoTexto).not.toContain('diseñada pero inactiva');
  });

  it('debe_declarar_las_variables_requeridas_de_la_plantilla_E3', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'es');

    // factura-senal-pdf-idioma-email-ux: E3 requiere `nombre` + `codigoReserva`; `email`
    // ya no es variable de plantilla (el destinatario lo aporta el use-case).
    expect(plantilla?.variablesRequeridas).toEqual(
      expect.arrayContaining(['nombre', 'codigoReserva']),
    );
    expect(plantilla?.variablesRequeridas).not.toContain('email');
  });

  it('debe_requerir_la_factura_de_senal_como_adjunto_y_dejar_las_condiciones_opcionales', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E3', 'es');

    // La factura de señal es el adjunto imprescindible (§D-guarda-estado).
    expect(plantilla?.adjuntosRequeridos).toEqual(expect.arrayContaining(['senal']));
    // Las condiciones NO son un adjunto requerido (degradan sin tumbar el envío).
    expect(plantilla?.adjuntosRequeridos).not.toContain('condiciones');
  });
});

// ===========================================================================
// E4 — Liquidación standalone (fix-liquidacion-fianza-independientes §Email copy).
//   E4 pasa a ACTIVA en CA y ES: SOLO liquidación (sin recibo de fianza). El PDF de
//   la liquidación es el adjunto REQUERIDO (clave `liquidacion`). El cuerpo recuerda
//   abonar la fianza de `{fianzaEur}` €; requiere las variables `nombre` y `fianzaEur`.
// ===========================================================================

describe('CatalogoPlantillasEnCodigo — E4 liquidación standalone activa (fix-liquidacion-fianza-independientes)', () => {
  it.each(['es', 'ca'] as const)(
    'debe_marcar_la_plantilla_E4_en_%s_como_activa',
    (idioma) => {
      const catalogo = new CatalogoPlantillasEnCodigo();

      const plantilla = catalogo.seleccionar('E4', idioma);

      expect(plantilla).not.toBeNull();
      expect(plantilla?.codigoEmail).toBe('E4');
      expect(plantilla?.idioma).toBe(idioma);
      expect(plantilla?.activa).toBe(true);
    },
  );

  it('debe_declarar_nombre_y_fianzaEur_como_variables_requeridas_de_E4', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E4', 'es');

    expect(plantilla?.variablesRequeridas).toEqual(
      expect.arrayContaining(['nombre', 'fianzaEur']),
    );
  });

  it('debe_requerir_SOLO_el_adjunto_de_liquidacion_y_nunca_el_de_fianza', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E4', 'es');

    // E4 = solo liquidación: el PDF de la liquidación es el adjunto requerido.
    expect(plantilla?.adjuntosRequeridos).toEqual(['liquidacion']);
    expect(plantilla?.adjuntosRequeridos).not.toContain('fianza');
  });

  it('debe_renderizar_E4_en_es_con_el_60_restante_y_el_recordatorio_de_la_fianza', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E4', 'es');
    const render = plantilla?.render({ nombre: 'Marta', fianzaEur: '500.00' });

    expect(render?.asunto.length).toBeGreaterThan(0);
    expect(render?.cuerpoTexto).toContain('Marta');
    expect(render?.cuerpoTexto).toContain('60%');
    // El importe de la fianza aparece formateado (500,00 €).
    expect(render?.cuerpoTexto).toContain('500,00 €');
    // No es el placeholder de una plantilla inactiva.
    expect(render?.asunto).not.toContain('pendiente de cableado');
  });

  it('debe_renderizar_E4_en_ca_con_el_60_restant_y_el_recordatori_de_la_fiança', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E4', 'ca');
    const render = plantilla?.render({ nombre: 'Marta', fianzaEur: '500.00' });

    expect(render?.cuerpoTexto).toContain('Marta');
    expect(render?.cuerpoTexto).toContain('60%');
    expect(render?.cuerpoTexto).toContain('fiança');
    expect(render?.cuerpoTexto).toContain('500,00 €');
    expect(render?.asunto).not.toContain('pendiente de cableado');
  });
});

// ===========================================================================
// E10 — Fianza devuelta (fix-liquidacion-fianza-independientes §Email copy).
//   Nueva plantilla ACTIVA en CA y ES, disparada post-commit best-effort al
//   registrar la devolución completa. Sin adjuntos. Requiere `nombre` y `fianzaEur`;
//   el cuerpo confirma la devolución de `{fianzaEur}` € por transferencia.
// ===========================================================================

describe('CatalogoPlantillasEnCodigo — E10 fianza devuelta activa (fix-liquidacion-fianza-independientes)', () => {
  it.each(['es', 'ca'] as const)(
    'debe_marcar_la_plantilla_E10_en_%s_como_activa',
    (idioma) => {
      const catalogo = new CatalogoPlantillasEnCodigo();

      const plantilla = catalogo.seleccionar('E10', idioma);

      expect(plantilla).not.toBeNull();
      expect(plantilla?.codigoEmail).toBe('E10');
      expect(plantilla?.idioma).toBe(idioma);
      expect(plantilla?.activa).toBe(true);
    },
  );

  it('debe_declarar_nombre_y_fianzaEur_como_variables_requeridas_de_E10_sin_adjuntos', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E10', 'es');

    expect(plantilla?.variablesRequeridas).toEqual(
      expect.arrayContaining(['nombre', 'fianzaEur']),
    );
    expect(plantilla?.adjuntosRequeridos).toEqual([]);
  });

  it('debe_renderizar_E10_en_es_confirmando_la_devolucion_de_la_fianza', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E10', 'es');
    const render = plantilla?.render({ nombre: 'Marta', fianzaEur: '500.00' });

    expect(render?.asunto.length).toBeGreaterThan(0);
    expect(render?.cuerpoTexto).toContain('Marta');
    expect(render?.cuerpoTexto).toContain('devuelto la fianza');
    expect(render?.cuerpoTexto).toContain('500,00 €');
    expect(render?.asunto).not.toContain('pendiente de cableado');
  });

  it('debe_renderizar_E10_en_ca_confirmant_el_retorn_de_la_fiança', () => {
    const catalogo = new CatalogoPlantillasEnCodigo();

    const plantilla = catalogo.seleccionar('E10', 'ca');
    const render = plantilla?.render({ nombre: 'Marta', fianzaEur: '500.00' });

    expect(render?.cuerpoTexto).toContain('Marta');
    expect(render?.cuerpoTexto).toContain('retornat la fiança');
    expect(render?.cuerpoTexto).toContain('500,00 €');
    expect(render?.asunto).not.toContain('pendiente de cableado');
  });
});
