/**
 * TESTS de la MÁQUINA DE ESTADOS de la FACTURA de señal (US-022 / UC-18) — fase
 * TDD RED. tasks.md Fase 3: 3.9 (aprobar: borrador→enviada con guardas), 3.10
 * (rechazar: permanece en borrador + motivo en AUDIT_LOG).
 *
 * Trazabilidad: US-022, spec-delta `facturacion` (Requirements "Aprobación del borrador
 * por el Gestor (borrador → enviada)", escenarios "Aprobar un borrador válido lo pasa a
 * enviada con fecha_emision" y "No se puede aprobar un borrador inválido o sin PDF"; y
 * "Rechazo del borrador por el Gestor", escenario "Rechazar el borrador lo mantiene en
 * borrador y registra el motivo"); design.md §D-9. skill `state-machine` (transiciones
 * como estructura de datos declarativa; transición/guarda no satisfecha → 422; estado no
 * aplicable → 409). Contrato: schema `EstadoFactura` (borrador→enviada→cobrada), errores
 * `FacturaEstadoInvalidoError` (409 FACTURA_NO_BORRADOR), `FacturaDatosFiscalesIncompletosError`
 * (422 DATOS_FISCALES_INCOMPLETOS), `FacturaPdfPendienteError` (422 PDF_PENDIENTE).
 *
 * Ejercita los casos de uso `AprobarFacturaUseCase` / `RechazarFacturaUseCase` contra
 * DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma (hexagonal, hook `no-infra-in-domain`).
 *
 * RED: aún NO existen `facturacion/application/aprobar-factura.use-case.ts` ni
 * `…/rechazar-factura.use-case.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  AprobarFacturaUseCase,
  FacturaNoBorradorError,
  DatosFiscalesIncompletosError,
  PdfPendienteError,
  FacturaNoEncontradaError,
  type AprobarFacturaDeps,
  type AprobarFacturaComando,
} from '../application/aprobar-factura.use-case';
import {
  RechazarFacturaUseCase,
  MotivoRequeridoError,
  type RechazarFacturaDeps,
  type RechazarFacturaComando,
} from '../application/rechazar-factura.use-case';
import type { FacturaSenal } from '../application/generar-factura-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const FACTURA_ID = 'fac-1';

const AHORA = new Date('2026-07-04T10:00:00.000Z');
const relojFijo = { ahora: () => AHORA };

/** Forma laxa de los argumentos capturados por los dobles (para las aserciones). */
interface AuditArg {
  accion?: string;
  entidad?: string;
  entidadId?: string;
  motivo?: string;
  datosAnteriores?: { estado?: string };
  datosNuevos?: { estado?: string };
}
interface AprobarArg {
  facturaId?: string;
  estado?: string;
  fechaEmision?: Date;
}

// ---------------------------------------------------------------------------
// Dobles de datos: FACTURA en borrador válida (PDF disponible, datos fiscales OK).
// ---------------------------------------------------------------------------

const facturaBorrador = (over: Partial<FacturaSenal> = {}): FacturaSenal => ({
  idFactura: FACTURA_ID,
  tenantId: TENANT,
  reservaId: 'res-1',
  numeroFactura: 'F-2026-0001',
  tipo: 'senal',
  estado: 'borrador',
  total: '1200.00',
  baseImponible: '991.74',
  ivaPorcentaje: '21.00',
  ivaImporte: '208.26',
  pdfUrl: 'https://storage.local/facturas/fac-1.pdf',
  fechaEmision: null,
  ...over,
});

// ---------------------------------------------------------------------------
// APROBAR (borrador → enviada)
// ---------------------------------------------------------------------------

const montarAprobar = (opciones: {
  factura?: FacturaSenal | null;
  clienteInvalido?: ReadonlyArray<string>;
} = {}) => {
  const factura = 'factura' in opciones ? opciones.factura : facturaBorrador();
  const cargarFactura = jest.fn(async () => factura);
  const camposFiscalesFaltantes = jest.fn(async () => opciones.clienteInvalido ?? []);
  const aprobar = jest.fn(async (_p: AprobarArg) => undefined);
  const registrarAuditoria = jest.fn(async (_a: AuditArg) => undefined);
  const deps: AprobarFacturaDeps = {
    cargarFactura,
    camposFiscalesFaltantes,
    aprobar,
    registrarAuditoria,
    clock: relojFijo,
  };
  return {
    useCase: new AprobarFacturaUseCase(deps),
    cargarFactura,
    camposFiscalesFaltantes,
    aprobar,
    registrarAuditoria,
  };
};

const comandoAprobar = (
  over: Partial<AprobarFacturaComando> = {},
): AprobarFacturaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  facturaId: FACTURA_ID,
  ...over,
});

describe('AprobarFacturaUseCase — transición borrador → enviada (3.9)', () => {
  it('debe_pasar_un_borrador_valido_a_enviada_y_fijar_fecha_emision', async () => {
    const { useCase, aprobar } = montarAprobar();

    await useCase.ejecutar(comandoAprobar());

    expect(aprobar).toHaveBeenCalledTimes(1);
    const args = aprobar.mock.calls[0][0];
    expect(args.facturaId).toBe(FACTURA_ID);
    expect(args.estado).toBe('enviada');
    expect(args.fechaEmision).toEqual(AHORA);
  });

  it('debe_registrar_AUDIT_LOG_actualizar_con_estado_anterior_borrador_y_nuevo_enviada', async () => {
    const { useCase, registrarAuditoria } = montarAprobar();

    await useCase.ejecutar(comandoAprobar());

    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    const args = registrarAuditoria.mock.calls[0][0];
    expect(args.accion).toBe('actualizar');
    expect(args.entidad).toBe('FACTURA');
    expect(args.datosAnteriores?.estado).toBe('borrador');
    expect(args.datosNuevos?.estado).toBe('enviada');
  });
});

describe('AprobarFacturaUseCase — guardas que bloquean la aprobación (3.9)', () => {
  it('debe_lanzar_FACTURA_NO_BORRADOR_409_al_aprobar_una_factura_ya_enviada', async () => {
    const { useCase, aprobar } = montarAprobar({
      factura: facturaBorrador({ estado: 'enviada', fechaEmision: AHORA }),
    });

    const promesa = useCase.ejecutar(comandoAprobar());
    await expect(promesa).rejects.toBeInstanceOf(FacturaNoBorradorError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'FACTURA_NO_BORRADOR' });
    expect(aprobar).not.toHaveBeenCalled();
  });

  it('debe_lanzar_FACTURA_NO_BORRADOR_409_al_aprobar_una_factura_cobrada', async () => {
    const { useCase } = montarAprobar({
      factura: facturaBorrador({ estado: 'cobrada', fechaEmision: AHORA }),
    });

    await expect(useCase.ejecutar(comandoAprobar())).rejects.toMatchObject({
      codigo: 'FACTURA_NO_BORRADOR',
    });
  });

  it('debe_lanzar_PDF_PENDIENTE_422_al_aprobar_un_borrador_con_pdf_url_null', async () => {
    const { useCase, aprobar } = montarAprobar({
      factura: facturaBorrador({ pdfUrl: null }),
    });

    const promesa = useCase.ejecutar(comandoAprobar());
    await expect(promesa).rejects.toBeInstanceOf(PdfPendienteError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'PDF_PENDIENTE' });
    expect(aprobar).not.toHaveBeenCalled();
  });

  it('debe_lanzar_DATOS_FISCALES_INCOMPLETOS_422_al_aprobar_un_borrador_invalido', async () => {
    // Datos fiscales del cliente incompletos (aunque el pdf_url estuviera fijado).
    const { useCase, aprobar } = montarAprobar({
      factura: facturaBorrador({ pdfUrl: null }),
      clienteInvalido: ['dniNif', 'poblacion'],
    });

    const promesa = useCase.ejecutar(comandoAprobar());
    await expect(promesa).rejects.toBeInstanceOf(DatosFiscalesIncompletosError);
    await expect(promesa).rejects.toMatchObject({
      codigo: 'DATOS_FISCALES_INCOMPLETOS',
      camposFaltantes: expect.arrayContaining(['dniNif', 'poblacion']),
    });
    expect(aprobar).not.toHaveBeenCalled();
  });

  it('debe_lanzar_FacturaNoEncontrada_cuando_no_existe_para_el_tenant', async () => {
    const { useCase } = montarAprobar({ factura: null });

    await expect(useCase.ejecutar(comandoAprobar())).rejects.toBeInstanceOf(
      FacturaNoEncontradaError,
    );
  });
});

// ---------------------------------------------------------------------------
// RECHAZAR (permanece en borrador + motivo en AUDIT_LOG)
// ---------------------------------------------------------------------------

const montarRechazar = (opciones: { factura?: FacturaSenal | null } = {}) => {
  const factura = 'factura' in opciones ? opciones.factura : facturaBorrador();
  const cargarFactura = jest.fn(async () => factura);
  const registrarAuditoria = jest.fn(async (_a: AuditArg) => undefined);
  const deps: RechazarFacturaDeps = {
    cargarFactura,
    registrarAuditoria,
    clock: relojFijo,
  };
  return {
    useCase: new RechazarFacturaUseCase(deps),
    cargarFactura,
    registrarAuditoria,
  };
};

const comandoRechazar = (
  over: Partial<RechazarFacturaComando> = {},
): RechazarFacturaComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  facturaId: FACTURA_ID,
  motivo: 'Datos fiscales del tenant erróneos',
  ...over,
});

describe('RechazarFacturaUseCase — permanece en borrador con motivo (3.10)', () => {
  it('debe_mantener_la_factura_en_borrador_y_registrar_el_motivo_en_AUDIT_LOG', async () => {
    const { useCase, registrarAuditoria } = montarRechazar();

    const resultado = await useCase.ejecutar(comandoRechazar());

    // NO cambia de estado: permanece en borrador (E3 bloqueado).
    expect(resultado.estado).toBe('borrador');
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    const args = registrarAuditoria.mock.calls[0][0];
    expect(args.entidad).toBe('FACTURA');
    expect(args.entidadId).toBe(FACTURA_ID);
    expect(args.motivo).toBe('Datos fiscales del tenant erróneos');
  });

  it('debe_exigir_un_motivo_no_vacio_para_rechazar', async () => {
    const { useCase, registrarAuditoria } = montarRechazar();

    await expect(
      useCase.ejecutar(comandoRechazar({ motivo: '' })),
    ).rejects.toBeInstanceOf(MotivoRequeridoError);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('debe_lanzar_FACTURA_NO_BORRADOR_409_al_rechazar_una_factura_ya_enviada', async () => {
    const { useCase } = montarRechazar({
      factura: facturaBorrador({ estado: 'enviada', fechaEmision: AHORA }),
    });

    await expect(useCase.ejecutar(comandoRechazar())).rejects.toMatchObject({
      codigo: 'FACTURA_NO_BORRADOR',
    });
  });
});
