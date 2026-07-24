/**
 * TESTS del caso de uso `ReenviarE3UseCase` (US-023, GAP 3) — fase TDD RED.
 * tasks.md Fase 3: 3.5 (nueva COMUNICACION E3 es_reenvio=true reutilizando documentos, NO
 * muta FACTURA ni transiciona la RESERVA, actualiza cond_part_enviadas_fecha), 3.6 (fallo
 * del proveedor → rollback; el segundo reenvío no colisiona con el índice UNIQUE parcial
 * porque va con es_reenvio=true), 3.7 (guardas: sin E3 previo → 409
 * E3_NO_ENVIADO_PREVIAMENTE; sin factura de señal / cross-tenant → 404
 * FACTURA_SENAL_NO_ENCONTRADA, RLS).
 *
 * ESPEJO de `reenviar-liquidacion.use-case.spec.ts` (patrón vivo del reenvío de E4,
 * US-028): dobles de los puertos in-memory (hexagonal, hook `no-infra-in-domain`), sin
 * Prisma, sin react-pdf, reloj inyectable, nombres en español orientados a comportamiento.
 *
 * Trazabilidad: spec-delta `facturacion` (ADDED "Reenvío manual de E3 sin re-emitir la
 * factura ni duplicar documentos", "Endpoint dedicado de reenvío de E3"); spec-delta
 * `comunicaciones` (ADDED "El reenvío manual de E3 crea una nueva COMUNICACION con
 * es_reenvio marcado"). Contrato: `POST /reservas/{id}/facturas/senal/reenviar`
 * (operationId `reenviarE3`; 200 / 404 FACTURA_SENAL_NO_ENCONTRADA / 409
 * E3_NO_ENVIADO_PREVIAMENTE / 502 EMISION_ENVIO_FALLIDO). design.md §D-reenvio-e3,
 * §Atomicidad.
 *
 * RED: aún NO existe `facturacion/application/reenviar-e3.use-case.ts`. El import falla y
 * la batería arranca en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de
 * `backend-developer`.
 */
import {
  ReenviarE3UseCase,
  FacturaSenalNoEncontradaError,
  E3NoEnviadoPreviamenteError,
  EmisionEnvioFallidoError,
  type ReenviarE3Deps,
  type ReenviarE3Comando,
  type FacturaSenalReenvio,
  type ReservaReenvioE3,
  type ComunicacionE3PreviaReenvio,
  type ClockPort,
} from '../application/reenviar-e3.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const RESERVA_ID = 'res-conf-1';
const CLIENTE_ID = 'cli-1';
const FAC_SENAL_ID = 'fac-senal-1';
const USUARIO_ID = 'usr-gestor-1';

const AHORA = new Date('2026-07-15T11:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

const URL_PDF_SENAL = 'https://storage.local/facturas/senal.pdf';
const URL_PDF_CONDICIONES = 'https://storage.local/condiciones/tenant-1.pdf';

// ---------------------------------------------------------------------------
// Dobles de datos: FACTURA(senal) YA emitida, COMUNICACION E3 original enviada
// (es_reenvio=false), DOCUMENTO de condiciones YA persistido (GAP 1).
// ---------------------------------------------------------------------------

const facturaSenalEmitida = (
  over: Partial<FacturaSenalReenvio> = {},
): FacturaSenalReenvio => ({
  idFactura: FAC_SENAL_ID,
  tenantId: TENANT,
  reservaId: RESERVA_ID,
  numeroFactura: 'F-2026-0007',
  tipo: 'senal',
  estado: 'enviada',
  total: '1640.00',
  pdfUrl: URL_PDF_SENAL,
  fechaEmision: new Date('2026-07-10T10:00:00.000Z'),
  ...over,
});

const reservaReenvio = (over: Partial<ReservaReenvioE3> = {}): ReservaReenvioE3 => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  clienteId: CLIENTE_ID,
  codigo: 'SLO-2026-0023',
  clienteEmail: 'marta.soler@example.com',
  condPartEnviadasFecha: new Date('2026-07-10T10:00:00.000Z'),
  ...over,
});

const e3Previa = (
  over: Partial<ComunicacionE3PreviaReenvio> = {},
): ComunicacionE3PreviaReenvio => ({
  idComunicacion: 'com-e3-original',
  estado: 'enviado',
  esReenvio: false,
  ...over,
});

// ---------------------------------------------------------------------------
// Montaje del use-case con dobles de puertos. Intencionadamente SIN puertos de
// emisión/renumeración de factura ni de transición de la RESERVA: el reenvío
// jamás muta la FACTURA ni transiciona la máquina de estados.
// ---------------------------------------------------------------------------

const montar = (opciones: {
  senal?: FacturaSenalReenvio | null;
  reserva?: ReservaReenvioE3 | null;
  /** COMUNICACION E3 previa, o null si no hay ninguna (→ 409). */
  e3Previa?: ComunicacionE3PreviaReenvio | null;
  /** Comportamiento del generador de condiciones: url (config) | null (degrada). */
  condiciones?: 'url' | 'null';
  /** El proveedor de email falla en el reenvío. */
  reenvioFalla?: boolean;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaReenvio();
  const senal = 'senal' in opciones ? opciones.senal : facturaSenalEmitida();
  const comE3 = 'e3Previa' in opciones ? opciones.e3Previa : e3Previa();

  const cargarReserva = jest.fn(async () => reserva);
  const cargarFacturaSenal = jest.fn(async () => senal);
  const buscarE3Previa = jest.fn(async () => comE3);
  // Puerto NUEVO: el reenvío REGENERA el PDF en blanco vía `GenerarPdfCondicionesPort`
  // (change condiciones-…-senal-…), en vez de buscar un DOCUMENTO persistido (código stale
  // tras la Mejora B). Modo configurable: url (config) | null (degrada).
  const generarCondiciones = {
    generar: jest.fn(async (_params: { tenantId: string; idioma: 'es' | 'ca' }) =>
      opciones.condiciones === 'null' ? null : URL_PDF_CONDICIONES,
    ),
  };
  const reenviarE3 = jest.fn(async (_params: Record<string, unknown>) => {
    if (opciones.reenvioFalla) throw new Error('PROVEEDOR_EMAIL_CAIDO');
    return { idComunicacion: 'com-e3-reenvio-1', estado: 'enviado' as const, fechaEnvio: AHORA };
  });
  const registrarComunicacion = jest.fn(async (p: Record<string, unknown>) => ({
    idComunicacion: 'com-e3-reenvio-1',
    ...p,
  }));
  const fijarCondicionesEnviadas = jest.fn(async () => undefined);
  const registrarAuditoria = jest.fn(async () => undefined);

  // `buscarDocumentoCondiciones` desaparece (código stale). Se inyecta vía cast porque en RED
  // la firma viva de `ReenviarE3Deps` aún lo declara; el backend-developer lo sustituye por
  // `generarCondiciones`.
  const deps = {
    cargarReserva,
    cargarFacturaSenal,
    buscarE3Previa,
    generarCondiciones,
    reenviarE3,
    registrarComunicacion,
    fijarCondicionesEnviadas,
    registrarAuditoria,
    clock: relojFijo,
  } as unknown as ReenviarE3Deps;
  return {
    useCase: new ReenviarE3UseCase(deps),
    cargarReserva,
    cargarFacturaSenal,
    buscarE3Previa,
    generarCondiciones,
    reenviarE3,
    registrarComunicacion,
    fijarCondicionesEnviadas,
    registrarAuditoria,
    deps,
  };
};

const comando = (over: Partial<ReenviarE3Comando> = {}): ReenviarE3Comando => ({
  tenantId: TENANT,
  usuarioId: USUARIO_ID,
  reservaId: RESERVA_ID,
  ...over,
});

// ===========================================================================
// 3.5 — Reenvío happy path: NUEVA COMUNICACION E3 es_reenvio=true reutilizando
//        los documentos existentes (no regenera PDF, no duplica DOCUMENTO),
//        actualiza cond_part_enviadas_fecha, NO muta FACTURA ni transiciona la
//        RESERVA.
// ===========================================================================

describe('ReenviarE3 — reenvío reutilizando documentos existentes (3.5)', () => {
  it('debe_crear_una_NUEVA_COMUNICACION_E3_con_es_reenvio_true_y_fecha', async () => {
    const { useCase, registrarComunicacion } = montar();

    await useCase.ejecutar(comando());

    expect(registrarComunicacion).toHaveBeenCalledTimes(1);
    const args = registrarComunicacion.mock.calls[0][0];
    expect(args.codigoEmail).toBe('E3');
    expect(args.estado).toBe('enviado');
    expect(args.esReenvio).toBe(true);
    expect(args.fechaEnvio).toEqual(AHORA);
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.clienteId).toBe(CLIENTE_ID);
    expect(args.tenantId).toBe(TENANT);
  });

  it('debe_REGENERAR_el_PDF_de_condiciones_via_GenerarPdfCondicionesPort_no_buscar_documento_stale', async () => {
    const { useCase, generarCondiciones, reenviarE3 } = montar();

    await useCase.ejecutar(comando());

    // El reenvío REGENERA el PDF en blanco (change condiciones-…-senal-…) en vez de buscar un
    // DOCUMENTO persistido (que tras mover las condiciones de E2 a E3 ya no existe).
    expect(generarCondiciones.generar).toHaveBeenCalledTimes(1);
    expect(generarCondiciones.generar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT }),
    );
    // El reenvío adjunta la señal ya emitida y las condiciones regeneradas.
    const adjuntos = reenviarE3.mock.calls[0][0].adjuntos as ReadonlyArray<{ pdfUrl: string }>;
    expect(adjuntos.map((a) => a.pdfUrl)).toEqual(
      expect.arrayContaining([URL_PDF_SENAL, URL_PDF_CONDICIONES]),
    );
  });

  it('debe_reenviar_SOLO_la_senal_cuando_el_generador_de_condiciones_degrada_a_null', async () => {
    const { useCase, reenviarE3 } = montar({ condiciones: 'null' });

    await useCase.ejecutar(comando());

    const adjuntos = reenviarE3.mock.calls[0][0].adjuntos as ReadonlyArray<{ clave: string }>;
    expect(adjuntos).toHaveLength(1);
    expect(adjuntos[0].clave).toBe('senal');
    expect(adjuntos.some((a) => a.clave === 'condiciones')).toBe(false);
  });

  it('debe_actualizar_cond_part_enviadas_fecha_al_nuevo_timestamp', async () => {
    const { useCase, fijarCondicionesEnviadas } = montar();

    await useCase.ejecutar(comando());

    expect(fijarCondicionesEnviadas).toHaveBeenCalledWith(
      expect.objectContaining({
        reservaId: RESERVA_ID,
        condPartEnviadasFecha: AHORA,
      }),
    );
  });

  it('no_debe_exponer_ningun_puerto_de_emision_renumeracion_ni_de_transicion_de_estado', async () => {
    const { deps } = montar();

    const registro = deps as unknown as Record<string, unknown>;
    // El reenvío NO puede re-emitir la factura ni renumerar ni transicionar la reserva.
    expect(registro.emitir).toBeUndefined();
    expect(registro.renumerar).toBeUndefined();
    expect(registro.transicionarReserva).toBeUndefined();
    expect(registro.avanzarEstado).toBeUndefined();
    // No crea/duplica documentos, pero SÍ REGENERA el PDF de condiciones vía el puerto
    // (change condiciones-…-senal-…): `buscarDocumentoCondiciones` (stale) desaparece y
    // `generarCondiciones` pasa a ser dependencia.
    expect(registro.crearDocumento).toBeUndefined();
    expect(registro.buscarDocumentoCondiciones).toBeUndefined();
    expect(registro.generarCondiciones).toBeDefined();
  });

  it('debe_devolver_la_nueva_fecha_de_envio_del_reenvio', async () => {
    const { useCase } = montar();

    const resultado = await useCase.ejecutar(comando());

    expect(resultado.condPartEnviadasFecha).toEqual(AHORA);
  });
});

// ===========================================================================
// 3.6 — Fallo del proveedor → rollback (no COMUNICACION de reenvío, no
//        actualización de fecha); un segundo reenvío exitoso NO colisiona con el
//        índice UNIQUE parcial (reserva_id, codigo_email) WHERE es_reenvio=false
//        porque el reenvío va con es_reenvio=true.
// ===========================================================================

describe('ReenviarE3 — atomicidad del reenvío (3.6)', () => {
  it('debe_lanzar_EmisionEnvioFallido_cuando_el_proveedor_de_email_falla', async () => {
    const { useCase } = montar({ reenvioFalla: true });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
  });

  it('no_debe_crear_COMUNICACION_ni_actualizar_fecha_cuando_el_reenvio_falla', async () => {
    const { useCase, registrarComunicacion, fijarCondicionesEnviadas } = montar({
      reenvioFalla: true,
    });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(EmisionEnvioFallidoError);
    expect(registrarComunicacion).not.toHaveBeenCalled();
    expect(fijarCondicionesEnviadas).not.toHaveBeenCalled();
  });

  it('el_reenvio_registra_la_COMUNICACION_con_es_reenvio_true_esquivando_el_indice_unique_parcial', async () => {
    // El índice UNIQUE parcial solo aplica a es_reenvio=false; el reenvío va con
    // es_reenvio=true, por lo que sucesivos reenvíos no colisionan (P2002).
    const { useCase, registrarComunicacion } = montar();

    await useCase.ejecutar(comando());
    await useCase.ejecutar(comando());

    expect(registrarComunicacion).toHaveBeenCalledTimes(2);
    for (const call of registrarComunicacion.mock.calls) {
      expect(call[0].esReenvio).toBe(true);
    }
  });
});

// ===========================================================================
// 3.7 — Guardas: sin COMUNICACION E3 `enviado` previa →
//        E3NoEnviadoPreviamenteError (409 E3_NO_ENVIADO_PREVIAMENTE); reserva
//        inexistente / sin factura de señal / cross-tenant →
//        FacturaSenalNoEncontradaError (404, RLS). Sin reenvío en ambos casos.
// ===========================================================================

describe('ReenviarE3 — guardas (3.7)', () => {
  it('debe_rechazar_con_E3NoEnviadoPreviamente_cuando_no_hay_E3_enviado_previo', async () => {
    const { useCase, reenviarE3, registrarComunicacion } = montar({ e3Previa: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      E3NoEnviadoPreviamenteError,
    );
    expect(reenviarE3).not.toHaveBeenCalled();
    expect(registrarComunicacion).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_E3NoEnviadoPreviamente_cuando_la_E3_previa_esta_en_fallido', async () => {
    // Una COMUNICACION E3 en `fallido` no cuenta como "enviado previamente".
    const { useCase, reenviarE3 } = montar({ e3Previa: e3Previa({ estado: 'fallido' }) });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      E3NoEnviadoPreviamenteError,
    );
    expect(reenviarE3).not.toHaveBeenCalled();
  });

  it('debe_rechazar_con_FacturaSenalNoEncontrada_cuando_no_hay_factura_de_senal', async () => {
    const { useCase } = montar({ senal: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaSenalNoEncontradaError,
    );
  });

  it('debe_rechazar_con_FacturaSenalNoEncontrada_cuando_la_reserva_es_cross_tenant', async () => {
    const { useCase, reenviarE3 } = montar({ reserva: null });

    await expect(useCase.ejecutar(comando())).rejects.toBeInstanceOf(
      FacturaSenalNoEncontradaError,
    );
    expect(reenviarE3).not.toHaveBeenCalled();
  });
});
