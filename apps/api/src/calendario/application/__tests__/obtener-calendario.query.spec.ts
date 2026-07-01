/**
 * TESTS del query de APLICACIÓN `ObtenerCalendarioUseCase` (US-039 / UC-29,
 * `GET /calendario`) — fase TDD RED. Ejercita la AGREGACIÓN POR RANGO contra un
 * DOBLE del puerto de lectura (in-memory), sin Prisma (hexagonal, design.md §D-5).
 *
 * Trazabilidad: US-039, spec-delta `calendario`, design.md §D-1 (endpoint agregado),
 * §D-3 (conteo de cola `enCola`), §D-4 (aislamiento multi-tenant), §D-7 (no-mutación).
 * Contrato congelado `CalendarioResponse { rango{desde,hasta}, fechas: CalendarioFecha[] }`.
 *
 * Cubre (lectura pura, SIN concurrencia — US-039 §Concurrencia):
 *   - Agregación: solo fechas OCUPADAS del rango; las libres NO aparecen.
 *   - Rango vacío → `fechas: []` (mes sin bloqueos), respuesta bien formada.
 *   - Conteo de cola `enCola` proyectado tal cual lo entrega el puerto (0/ausente sin cola).
 *   - Aislamiento multi-tenant: el use-case SIEMPRE pasa el `tenant_id` del comando al puerto.
 *   - `vista` informativa: no altera el dataset (mismo rango ⇒ mismas fechas).
 *   - NO-MUTACIÓN: el use-case solo invoca el método de LECTURA del puerto.
 *
 * RED: aún NO existe `calendario/application/obtener-calendario.query.ts`; el import
 * falla y la batería está en ROJO POR AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  ObtenerCalendarioUseCase,
  type CalendarioQueryPort,
  type CalendarioFechaLectura,
  type ObtenerCalendarioComando,
} from '../obtener-calendario.query';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';

const DESDE = new Date('2026-06-01T00:00:00.000Z');
const HASTA = new Date('2026-06-30T00:00:00.000Z');

const comando = (
  over: Partial<ObtenerCalendarioComando> = {},
): ObtenerCalendarioComando => ({
  tenantId: TENANT,
  desde: DESDE,
  hasta: HASTA,
  vista: 'mes',
  ...over,
});

const fechaGris2b = (): CalendarioFechaLectura => ({
  fecha: new Date('2026-06-12T00:00:00.000Z'),
  color: 'gris',
  estado: 'consulta',
  subEstado: '2b',
  reservaId: '11111111-1111-1111-1111-111111111111',
  cliente: 'Ana García',
  ttlExpiracion: new Date('2026-06-14T17:00:00.000Z'),
  enCola: 2,
});

const fechaVerdeConfirmada = (): CalendarioFechaLectura => ({
  fecha: new Date('2026-06-20T00:00:00.000Z'),
  color: 'verde',
  estado: 'reserva_confirmada',
  subEstado: null,
  reservaId: '22222222-2222-2222-2222-222222222222',
  cliente: 'Luis Pérez',
  ttlExpiracion: null,
  enCola: 0,
});

const construir = (
  agregarPorRango: jest.Mock,
): ObtenerCalendarioUseCase =>
  new ObtenerCalendarioUseCase({ calendario: { agregarPorRango } });

describe('ObtenerCalendarioUseCase — agregación por rango (solo fechas ocupadas)', () => {
  it('debe_devolver_el_rango_eco_y_solo_las_fechas_ocupadas', async () => {
    const agregarPorRango = jest
      .fn()
      .mockResolvedValue([fechaGris2b(), fechaVerdeConfirmada()]);
    const useCase = construir(agregarPorRango);

    const resultado = await useCase.ejecutar(comando());

    // El rango se hace eco de los query params (CalendarioRango).
    expect(resultado.rango.desde).toEqual(DESDE);
    expect(resultado.rango.hasta).toEqual(HASTA);
    // Solo las fechas ocupadas que entrega el puerto; nada inventado.
    expect(resultado.fechas).toHaveLength(2);
    expect(resultado.fechas.map((f: CalendarioFechaLectura) => f.color)).toEqual([
      'gris',
      'verde',
    ]);
    expect(resultado.fechas.map((f: CalendarioFechaLectura) => f.reservaId)).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
  });

  it('debe_devolver_fechas_vacio_cuando_el_rango_no_tiene_bloqueos', async () => {
    // Mes sin reservas (US-039 §Mes sin reservas): el puerto devuelve [].
    const agregarPorRango = jest.fn().mockResolvedValue([]);
    const useCase = construir(agregarPorRango);

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.fechas).toEqual([]);
    expect(resultado.rango.desde).toEqual(DESDE);
    expect(resultado.rango.hasta).toEqual(HASTA);
  });
});

describe('ObtenerCalendarioUseCase — conteo de cola (enCola)', () => {
  it('debe_proyectar_enCola_N_para_una_fecha_2b_con_reservas_en_cola', async () => {
    // Fecha 2.b con 2 reservas en 2.d apuntando a la bloqueante → enCola=2 (design.md §D-3).
    const agregarPorRango = jest.fn().mockResolvedValue([fechaGris2b()]);
    const useCase = construir(agregarPorRango);

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.fechas[0].enCola).toBe(2);
    // El color base permanece gris (el indicador no cambia el color de la celda).
    expect(resultado.fechas[0].color).toBe('gris');
  });

  it('debe_proyectar_enCola_0_para_una_fecha_sin_cola', async () => {
    const agregarPorRango = jest.fn().mockResolvedValue([fechaVerdeConfirmada()]);
    const useCase = construir(agregarPorRango);

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.fechas[0].enCola).toBe(0);
  });
});

describe('ObtenerCalendarioUseCase — aislamiento multi-tenant (CRÍTICO)', () => {
  it('debe_pasar_SIEMPRE_el_tenant_del_comando_al_puerto_de_lectura', async () => {
    const agregarPorRango = jest.fn().mockResolvedValue([]);
    const useCase = construir(agregarPorRango);

    await useCase.ejecutar(comando({ tenantId: TENANT }));

    expect(agregarPorRango).toHaveBeenCalledTimes(1);
    expect(agregarPorRango).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
    );
  });

  it('debe_consultar_con_el_tenant_del_jwt_y_nunca_mezclar_otro_tenant', async () => {
    const agregarPorRango = jest.fn().mockResolvedValue([]);
    const useCase = construir(agregarPorRango);

    await useCase.ejecutar(comando({ tenantId: OTRO_TENANT }));

    const params = agregarPorRango.mock.calls[0][0];
    expect(params.tenantId).toBe(OTRO_TENANT);
    expect(params.tenantId).not.toBe(TENANT);
  });
});

describe('ObtenerCalendarioUseCase — vista informativa y rango pasados al puerto', () => {
  it('debe_pasar_el_rango_desde_hasta_y_la_vista_al_puerto', async () => {
    const agregarPorRango = jest.fn().mockResolvedValue([]);
    const useCase = construir(agregarPorRango);

    await useCase.ejecutar(comando({ vista: 'semana' }));

    expect(agregarPorRango).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, desde: DESDE, hasta: HASTA }),
    );
  });

  it('debe_devolver_el_mismo_dataset_independientemente_de_la_vista', async () => {
    // La vista es informativa: el conjunto de datos del mismo rango no cambia
    // (US-039 §Reglas de Validación: código de colores idéntico entre vistas).
    const dataset = [fechaGris2b(), fechaVerdeConfirmada()];
    const useCaseMes = construir(jest.fn().mockResolvedValue(dataset));
    const useCaseLista = construir(jest.fn().mockResolvedValue(dataset));

    const enMes = await useCaseMes.ejecutar(comando({ vista: 'mes' }));
    const enLista = await useCaseLista.ejecutar(comando({ vista: 'lista' }));

    expect(enLista.fechas).toEqual(enMes.fechas);
  });
});

describe('ObtenerCalendarioUseCase — no-mutación (lectura pura)', () => {
  it('debe_invocar_solo_el_metodo_de_lectura_del_puerto_sin_escribir', async () => {
    // El puerto SOLO expone lectura; verificamos que el use-case no llama a ningún
    // método de escritura (design.md §D-7: el calendario NO muta RESERVA ni
    // FECHA_BLOQUEADA).
    const agregarPorRango = jest.fn().mockResolvedValue([fechaGris2b()]);
    const escribirEspia = jest.fn();
    const puerto = {
      calendario: { agregarPorRango },
    } as unknown as { calendario: CalendarioQueryPort } & Record<string, unknown>;
    // Métodos de escritura "trampa": si el use-case los tocara, fallaría.
    (puerto as Record<string, unknown>).guardar = escribirEspia;
    (puerto as Record<string, unknown>).actualizar = escribirEspia;

    const useCase = new ObtenerCalendarioUseCase({ calendario: puerto.calendario });
    await useCase.ejecutar(comando());

    expect(agregarPorRango).toHaveBeenCalledTimes(1);
    expect(escribirEspia).not.toHaveBeenCalled();
  });
});
