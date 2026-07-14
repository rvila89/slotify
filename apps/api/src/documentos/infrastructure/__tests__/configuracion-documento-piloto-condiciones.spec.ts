/**
 * TESTS del bloque `condiciones` del factory del seed del piloto
 * `construirConfiguracionDocumentoPiloto` (épico #6, rebanada 6.4a
 * `documentos-condiciones-particulares-pdf`) — fase TDD RED. tasks.md Fase 2: 2.2.
 *
 * Trazabilidad: design.md §"Seed piloto" (título "Condicions Particulars" + las 14
 * secciones reales de Masia; el texto literal de cada `cuerpo` lo aporta el usuario
 * — D1 — y lo pone `backend-developer` en GREEN).
 *
 * ESTRATEGIA: el factory es PURO y determinista (se ejerce sin Postgres). Este test
 * NO hardcodea el cuerpo íntegro de cada sección (eso llega en GREEN con el texto de
 * D1); verifica el CONTRATO estructural del bloque `condiciones`:
 *   - `titulo === 'Condicions Particulars'`
 *   - EXACTAMENTE 14 secciones
 *   - el ORDEN EXACTO de los 14 títulos
 *   - cada `titulo` y cada `cuerpo` NO vacíos (trim)
 *   - determinismo (apoyo a la idempotencia del seed)
 *
 * RED: `construirConfiguracionDocumentoPiloto` aún NO pobla el bloque `condiciones`
 * (el tipo `ConfiguracionDocumentoTenant` ni siquiera tiene el bloque todavía). El
 * acceso a `config.condiciones` no compila / está indefinido → batería en ROJO por
 * AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { construirConfiguracionDocumentoPiloto } from '../seed/configuracion-documento-piloto';

const TENANT_PILOTO = '00000000-0000-0000-0000-000000000001';

/** Orden EXACTO de los 14 títulos de las condicions particulars de Masia (D1). */
const TITULOS_ESPERADOS: ReadonlyArray<string> = [
  'Reserva i pagament',
  'Fiança',
  'Política de cancel·lació',
  'Responsabilitat i dades personals',
  'Visites',
  'Neteja',
  'Gestió de residus',
  'Horaris',
  "Excés d'horari",
  'Normes de convivència i ús responsable',
  'Capacitat',
  'Piscina',
  'Música i respecte veïnal',
  'Parking',
];

describe('construirConfiguracionDocumentoPiloto — bloque condiciones (2.2)', () => {
  it('debe_titular_el_bloque_como_Condicions_Particulars', () => {
    // Arrange / Act
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    // Assert
    expect(config.condiciones.titulo).toBe('Condicions Particulars');
  });

  it('debe_tener_exactamente_14_secciones', () => {
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    expect(config.condiciones.secciones).toHaveLength(14);
  });

  it('debe_listar_los_14_titulos_en_el_orden_exacto_especificado', () => {
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    const titulos = config.condiciones.secciones.map((s) => s.titulo);
    expect(titulos).toEqual(TITULOS_ESPERADOS);
  });

  it('debe_tener_titulo_y_cuerpo_no_vacios_en_cada_seccion', () => {
    // NO hardcodea el texto literal (D1 lo aporta el usuario en GREEN); solo exige
    // que ni el título ni el cuerpo estén vacíos.
    const config = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    for (const seccion of config.condiciones.secciones) {
      expect(seccion.titulo.trim().length).toBeGreaterThan(0);
      expect(seccion.cuerpo.trim().length).toBeGreaterThan(0);
    }
  });

  it('debe_ser_determinista_para_el_mismo_tenant_apoyo_a_la_idempotencia_del_seed', () => {
    const a = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);
    const b = construirConfiguracionDocumentoPiloto(TENANT_PILOTO);

    expect(a.condiciones).toEqual(b.condiciones);
  });
});
