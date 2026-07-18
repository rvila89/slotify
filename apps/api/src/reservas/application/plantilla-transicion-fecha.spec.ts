/**
 * TESTS del render puro `renderMensajeTransicionFecha` — fase TDD RED
 * (change `email-transicion-fecha-borrador`, tasks.md §3.1).
 *
 * Trazabilidad: spec-delta `consultas` — Requirements:
 *   - "Plantillas dinámicas de la transición de fecha (disponible / cola)"
 *   - "Selección de idioma de la plantilla por `reserva.idioma`"
 *   - "Placeholder visible cuando faltan personas u horas"
 * Fuente de los textos: plan aprobado `email-transicion-fecha-borrador`
 * (plantillas "disponible"/"cola" CA y ES).
 *
 * Módulo PURO (hexagonal): sin framework ni infra, NO necesita Postgres. Se ejercita
 * en aislamiento (unit). Asserts por FRAGMENTO clave (`toContain`) — no del cuerpo
 * entero — para no ser frágil ante retoques de redacción.
 *
 * RED: aún NO existe `application/plantilla-transicion-fecha.ts`. El import falla en
 * compilación y toda la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es
 * de `backend-developer`.
 */
import { renderMensajeTransicionFecha } from './plantilla-transicion-fecha';

// La fecha del ejemplo del plan: 19 de julio / juliol de 2026.
// Se construye en horario local (no UTC) para que `getDate()`/`getMonth()` del
// formateador estilo catálogo devuelvan el día/mes esperados sin desfase de zona.
const FECHA_19_JUL_2026 = new Date(2026, 6, 19);

// ===========================================================================
// Plantilla "disponible" — CA / ES
// ===========================================================================

describe('renderMensajeTransicionFecha — plantilla "disponible"', () => {
  it('debe_renderizar_en_catalan_con_saludo_fecha_personas_horas_40pct_y_firma', () => {
    const { asunto, cuerpo } = renderMensajeTransicionFecha({
      tipo: 'disponible',
      idioma: 'ca',
      nombre: 'Marta',
      fechaEvento: FECHA_19_JUL_2026,
      personas: 40,
      horas: 8,
    });

    expect(asunto.trim().length).toBeGreaterThan(0);
    // Saludo con el nombre de pila.
    expect(cuerpo).toContain('Hola Marta');
    // Fecha formateada en catalán (mes "juliol").
    expect(cuerpo).toContain('19 de juliol de 2026');
    // Disponibilidad + interpolación de personas / horas.
    expect(cuerpo).toContain('disponible');
    expect(cuerpo).toContain('40 persones');
    expect(cuerpo).toContain('8 hores');
    // El "40 %" de la señal es texto FIJO de la plantilla "disponible".
    expect(cuerpo).toContain('40%');
    // Firma hardcodeada.
    expect(cuerpo).toContain("Ari — Masia l'Encís");
  });

  it('debe_renderizar_en_castellano_con_saludo_fecha_personas_horas_40pct_y_firma', () => {
    const { asunto, cuerpo } = renderMensajeTransicionFecha({
      tipo: 'disponible',
      idioma: 'es',
      nombre: 'Marta',
      fechaEvento: FECHA_19_JUL_2026,
      personas: 40,
      horas: 8,
    });

    expect(asunto.trim().length).toBeGreaterThan(0);
    expect(cuerpo).toContain('Hola Marta');
    // Fecha formateada en castellano (mes "julio").
    expect(cuerpo).toContain('19 de julio de 2026');
    expect(cuerpo).toContain('disponible');
    expect(cuerpo).toContain('40 personas');
    expect(cuerpo).toContain('8 horas');
    expect(cuerpo).toContain('40%');
    expect(cuerpo).toContain("Ari — Masia l'Encís");
  });
});

// ===========================================================================
// Plantilla "cola" — CA / ES
// ===========================================================================

describe('renderMensajeTransicionFecha — plantilla "cola"', () => {
  it('debe_renderizar_cola_en_catalan_con_saludo_fecha_frase_bloqueada_y_firma', () => {
    const { asunto, cuerpo } = renderMensajeTransicionFecha({
      tipo: 'cola',
      idioma: 'ca',
      nombre: 'Jordi',
      fechaEvento: FECHA_19_JUL_2026,
      personas: 30,
      horas: 6,
    });

    expect(asunto.trim().length).toBeGreaterThan(0);
    expect(cuerpo).toContain('Hola Jordi');
    expect(cuerpo).toContain('19 de juliol de 2026');
    // Frase clave de la plantilla "cola" en catalán.
    expect(cuerpo).toContain('bloquejada per una altra consulta');
    expect(cuerpo).toContain("Ari — Masia l'Encís");
  });

  it('debe_renderizar_cola_en_castellano_con_saludo_fecha_frase_bloqueada_y_firma', () => {
    const { asunto, cuerpo } = renderMensajeTransicionFecha({
      tipo: 'cola',
      idioma: 'es',
      nombre: 'Jordi',
      fechaEvento: FECHA_19_JUL_2026,
      personas: 30,
      horas: 6,
    });

    expect(asunto.trim().length).toBeGreaterThan(0);
    expect(cuerpo).toContain('Hola Jordi');
    expect(cuerpo).toContain('19 de julio de 2026');
    // Frase clave de la plantilla "cola" en castellano.
    expect(cuerpo).toContain('bloqueada por otra consulta');
    expect(cuerpo).toContain("Ari — Masia l'Encís");
  });
});

// ===========================================================================
// Selección de idioma: 'ca' → catalán; 'es'/otro → castellano (texto y mes).
// ===========================================================================

describe('renderMensajeTransicionFecha — selección de idioma', () => {
  it('idioma_ca_formatea_el_mes_en_catalan', () => {
    const { cuerpo } = renderMensajeTransicionFecha({
      tipo: 'disponible',
      idioma: 'ca',
      nombre: 'Marta',
      fechaEvento: FECHA_19_JUL_2026,
      personas: 40,
      horas: 8,
    });

    expect(cuerpo).toContain('19 de juliol de 2026');
    expect(cuerpo).not.toContain('19 de julio de 2026');
  });

  it('idioma_es_formatea_el_mes_en_castellano', () => {
    const { cuerpo } = renderMensajeTransicionFecha({
      tipo: 'disponible',
      idioma: 'es',
      nombre: 'Marta',
      fechaEvento: FECHA_19_JUL_2026,
      personas: 40,
      horas: 8,
    });

    expect(cuerpo).toContain('19 de julio de 2026');
    expect(cuerpo).not.toContain('19 de juliol de 2026');
  });

  it('idioma_arbitrario_distinto_de_ca_cae_a_castellano', () => {
    const { cuerpo } = renderMensajeTransicionFecha({
      tipo: 'disponible',
      idioma: 'en',
      nombre: 'Marta',
      fechaEvento: FECHA_19_JUL_2026,
      personas: 40,
      horas: 8,
    });

    // Cualquier idioma distinto de 'ca' (incl. 'en') renderiza en castellano.
    expect(cuerpo).toContain('19 de julio de 2026');
    expect(cuerpo).toContain('personas');
    expect(cuerpo).toContain('horas');
  });
});

// ===========================================================================
// Placeholder `___` cuando faltan personas u horas (solo plantilla "disponible").
// ===========================================================================

describe('renderMensajeTransicionFecha — placeholder ___ para datos faltantes', () => {
  it('personas_null_produce_placeholder_y_conserva_las_horas_reales', () => {
    const { cuerpo } = renderMensajeTransicionFecha({
      tipo: 'disponible',
      idioma: 'es',
      nombre: 'Marta',
      fechaEvento: FECHA_19_JUL_2026,
      personas: null,
      horas: 8,
    });

    // Placeholder visible en el lugar de personas; horas con el valor real.
    expect(cuerpo).toContain('___ personas');
    expect(cuerpo).toContain('8 horas');
  });

  it('horas_null_produce_placeholder_y_conserva_las_personas_reales', () => {
    const { cuerpo } = renderMensajeTransicionFecha({
      tipo: 'disponible',
      idioma: 'es',
      nombre: 'Marta',
      fechaEvento: FECHA_19_JUL_2026,
      personas: 40,
      horas: null,
    });

    expect(cuerpo).toContain('___ horas');
    expect(cuerpo).toContain('40 personas');
  });
});
