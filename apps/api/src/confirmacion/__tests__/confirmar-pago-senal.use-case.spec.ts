/**
 * TESTS del caso de uso `ConfirmarPagoSenalUseCase` (UC-17 / US-021) — fase TDD RED.
 * tasks.md Fase 3: 3.5 (congelado de importes), 3.6 (idempotencia FICHA_OPERATIVA),
 * 3.7 (validación del justificante), guarda de origen (3.1) e IMPORTE_TOTAL_INVALIDO,
 * y atomicidad/propagación de rollback (3.3, en su vertiente de orquestación).
 *
 * Trazabilidad: US-021; spec-delta `confirmacion` (Requirements de precondición/
 * validación del justificante, creación del DOCUMENTO, congelado de importes,
 * inicialización de los tres sub-procesos, creación idempotente de FICHA_OPERATIVA)
 * y spec-delta `consultas` (guarda de origen `pre_reserva → reserva_confirmada`,
 * atomicidad all-or-nothing). Contrato congelado:
 *   - `POST /reservas/{id}/confirmar-senal` (multipart, campo `justificante`).
 * Códigos de dominio (schema `ConfirmarSenalValidacionError` / `…ConflictoError`):
 *   ORIGEN_INVALIDO, JUSTIFICANTE_REQUERIDO, FORMATO_NO_PERMITIDO, TAMANO_EXCEDIDO,
 *   IMPORTE_TOTAL_INVALIDO (422); RESERVA_YA_CONFIRMADA, FECHA_NO_DISPONIBLE (409).
 *
 * Ejercita la APLICACIÓN contra DOBLES DE LOS PUERTOS (in-memory), sin tocar Prisma
 * (hexagonal, hook `no-infra-in-domain`). La ATOMICIDAD, la concurrencia y el upgrade
 * a firme REALES viven en `…-integracion.spec.ts` y `…-concurrencia.spec.ts`; aquí se
 * fija la ORQUESTACIÓN: validaciones síncronas y previas a la tx (guarda de origen,
 * justificante, importe_total), congelado de importes por resta, init de sub-procesos,
 * idempotencia de la FICHA_OPERATIVA y que un fallo parcial en la tx se PROPAGA
 * (rollback all-or-nothing).
 *
 * RED: aún NO existe `confirmacion/application/confirmar-pago-senal.use-case.ts`. La
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  ConfirmarPagoSenalUseCase,
  OrigenInvalidoError,
  JustificanteRequeridoError,
  FormatoNoPermitidoError,
  TamanoExcedidoError,
  ImporteTotalInvalidoError,
  ReservaNoEncontradaError,
  type ConfirmarPagoSenalDeps,
  type ConfirmarPagoSenalComando,
  type JustificanteSubido,
  type ReservaConfirmacion,
  type RepositoriosConfirmacion,
  type UnidadDeTrabajoConfirmacionPort,
  type TenantSettingsConfirmacion,
  type ClockPort,
} from '../application/confirmar-pago-senal.use-case';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const GESTOR = '00000000-0000-0000-0000-000000000002';
const RESERVA_ID = 'res-pre';
const MB = 1024 * 1024;

const AHORA = new Date('2026-07-03T10:00:00.000Z');
const FECHA_EVENTO = new Date('2027-09-15T00:00:00.000Z');
const relojFijo: ClockPort = { ahora: () => AHORA };

// ---------------------------------------------------------------------------
// Dobles de datos: RESERVA en pre_reserva con importe_total fijado en US-014.
// ---------------------------------------------------------------------------

const reservaEnPreReserva = (
  over: Partial<ReservaConfirmacion> = {},
): ReservaConfirmacion => ({
  idReserva: RESERVA_ID,
  tenantId: TENANT,
  estado: 'pre_reserva',
  subEstado: null,
  fechaEvento: FECHA_EVENTO,
  importeTotal: '3000.00',
  ...over,
});

const settings: TenantSettingsConfirmacion = { pctSenal: 40 };

// Justificante válido por defecto: PDF de 1 MB.
const justificanteValido = (over: Partial<JustificanteSubido> = {}): JustificanteSubido => ({
  nombreArchivo: 'justificante.pdf',
  mimeType: 'application/pdf',
  tamanoBytes: 1 * MB,
  buffer: Buffer.from('%PDF-1.4 fake'),
  ...over,
});

// ---------------------------------------------------------------------------
// Repositorios + UoW fake. El use-case orquesta la tx única de confirmación.
// ---------------------------------------------------------------------------

interface ReposFake extends RepositoriosConfirmacion {
  documentos: { crearJustificante: jest.Mock };
  reservas: { confirmarSenal: jest.Mock };
  fechaBloqueada: { upgradeAFirme: jest.Mock };
  fichaOperativa: { buscarPorReserva: jest.Mock; crearVacia: jest.Mock };
  auditoria: { registrar: jest.Mock };
}

type PuntoDeFallo =
  | 'crearJustificante'
  | 'confirmarSenal'
  | 'upgradeAFirme'
  | 'crearFicha'
  | 'auditoria';

const crearReposFake = (opciones: {
  fichaExistente?: boolean;
  fallarEn?: PuntoDeFallo;
} = {}): ReposFake => ({
  documentos: {
    crearJustificante: jest.fn(async (d: Record<string, unknown>) => {
      if (opciones.fallarEn === 'crearJustificante') throw new Error('FALLO_CREARJUSTIFICANTE');
      return { idDocumento: 'doc-1', tipo: 'justificante_pago', ...d };
    }),
  },
  reservas: {
    confirmarSenal: jest.fn(async () => {
      if (opciones.fallarEn === 'confirmarSenal') throw new Error('FALLO_CONFIRMARSENAL');
      return undefined;
    }),
  },
  fechaBloqueada: {
    upgradeAFirme: jest.fn(async () => {
      if (opciones.fallarEn === 'upgradeAFirme') throw new Error('FALLO_UPGRADEAFIRME');
      return undefined;
    }),
  },
  fichaOperativa: {
    buscarPorReserva: jest.fn(async () =>
      opciones.fichaExistente ? { idFicha: 'ficha-prev', reservaId: RESERVA_ID } : null,
    ),
    crearVacia: jest.fn(async (f: Record<string, unknown>) => {
      if (opciones.fallarEn === 'crearFicha') throw new Error('FALLO_CREARFICHA');
      return { idFicha: 'ficha-1', ...f };
    }),
  },
  auditoria: {
    registrar: jest.fn(async () => {
      if (opciones.fallarEn === 'auditoria') throw new Error('FALLO_AUDITORIA');
      return undefined;
    }),
  },
});

const crearUowFake = (
  repos: ReposFake,
): UnidadDeTrabajoConfirmacionPort & { ejecutar: jest.Mock } => ({
  ejecutar: jest.fn(
    async <T,>(
      _tenantId: string,
      trabajo: (r: RepositoriosConfirmacion) => Promise<T>,
    ) => trabajo(repos),
  ),
});

const montar = (opciones: {
  reserva?: ReservaConfirmacion | null;
  settings?: TenantSettingsConfirmacion;
  fichaExistente?: boolean;
  fallarEn?: PuntoDeFallo;
  almacenarUrl?: string;
} = {}) => {
  const reserva = 'reserva' in opciones ? opciones.reserva : reservaEnPreReserva();
  const repos = crearReposFake({
    fichaExistente: opciones.fichaExistente,
    fallarEn: opciones.fallarEn,
  });
  const uow = crearUowFake(repos);
  const cargarReserva = jest.fn(async () => reserva);
  const almacenarJustificante = jest.fn(
    async () => opciones.almacenarUrl ?? 'https://docs/justificante-1.pdf',
  );
  const presentarFacturaSenalBorrador = jest.fn(async () => undefined);
  const deps: ConfirmarPagoSenalDeps = {
    unidadDeTrabajo: uow,
    tenantSettings: { obtener: jest.fn(async () => opciones.settings ?? settings) },
    cargarReserva,
    almacenarJustificante,
    presentarFacturaSenalBorrador,
    clock: relojFijo,
  };
  return {
    useCase: new ConfirmarPagoSenalUseCase(deps),
    repos,
    uow,
    cargarReserva,
    almacenarJustificante,
    presentarFacturaSenalBorrador,
    deps,
  };
};

const comando = (
  over: Partial<ConfirmarPagoSenalComando> = {},
): ConfirmarPagoSenalComando => ({
  tenantId: TENANT,
  usuarioId: GESTOR,
  reservaId: RESERVA_ID,
  justificante: justificanteValido(),
  ...over,
});

// ===========================================================================
// 3.7 — Validación del justificante (síncrona, ANTES de la tx): ausente,
//        formato no permitido, tamaño > 10 MB → rechazo SIN efectos (sin
//        DOCUMENTO, sin mutación de RESERVA/FECHA_BLOQUEADA, sin almacenar).
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — validación del justificante (3.7)', () => {
  it('debe_lanzar_JUSTIFICANTE_REQUERIDO_cuando_no_se_adjunta_fichero_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarJustificante } = montar();

    const promesa = useCase.ejecutar(comando({ justificante: null }));
    await expect(promesa).rejects.toBeInstanceOf(JustificanteRequeridoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'JUSTIFICANTE_REQUERIDO' });

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarJustificante).not.toHaveBeenCalled();
    expect(repos.documentos.crearJustificante).not.toHaveBeenCalled();
    expect(repos.reservas.confirmarSenal).not.toHaveBeenCalled();
    expect(repos.fechaBloqueada.upgradeAFirme).not.toHaveBeenCalled();
  });

  it.each(['application/x-msdownload', 'text/plain', 'application/octet-stream'])(
    'debe_lanzar_FORMATO_NO_PERMITIDO_para_mime_%s_sin_efectos',
    async (mimeType) => {
      const { useCase, repos, uow, almacenarJustificante } = montar();

      const promesa = useCase.ejecutar(
        comando({ justificante: justificanteValido({ mimeType, nombreArchivo: 'virus.exe' }) }),
      );
      await expect(promesa).rejects.toBeInstanceOf(FormatoNoPermitidoError);
      await expect(promesa).rejects.toMatchObject({ codigo: 'FORMATO_NO_PERMITIDO' });

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(almacenarJustificante).not.toHaveBeenCalled();
      expect(repos.documentos.crearJustificante).not.toHaveBeenCalled();
    },
  );

  it.each(['image/jpeg', 'image/png', 'application/pdf'])(
    'debe_aceptar_el_formato_permitido_%s',
    async (mimeType) => {
      const { useCase, repos } = montar();

      await useCase.ejecutar(comando({ justificante: justificanteValido({ mimeType }) }));

      expect(repos.documentos.crearJustificante).toHaveBeenCalledTimes(1);
      expect(repos.documentos.crearJustificante.mock.calls[0][0].mimeType).toBe(mimeType);
    },
  );

  it('debe_lanzar_TAMANO_EXCEDIDO_cuando_el_fichero_supera_10_MB_sin_efectos', async () => {
    const { useCase, repos, uow, almacenarJustificante } = montar();

    const promesa = useCase.ejecutar(
      comando({ justificante: justificanteValido({ tamanoBytes: 10 * MB + 1 }) }),
    );
    await expect(promesa).rejects.toBeInstanceOf(TamanoExcedidoError);
    await expect(promesa).rejects.toMatchObject({ codigo: 'TAMANO_EXCEDIDO' });

    expect(uow.ejecutar).not.toHaveBeenCalled();
    expect(almacenarJustificante).not.toHaveBeenCalled();
    expect(repos.documentos.crearJustificante).not.toHaveBeenCalled();
  });

  it('debe_aceptar_un_fichero_de_exactamente_10_MB_como_valido', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(
      comando({ justificante: justificanteValido({ tamanoBytes: 10 * MB }) }),
    );

    expect(repos.documentos.crearJustificante).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// 3.1 — Guarda de origen: confirmar sobre una RESERVA que NO está en
//        `pre_reserva` → ORIGEN_INVALIDO, SIN efectos (sin DOCUMENTO, sin
//        mutación, sin almacenar el fichero, sin auditoría).
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — guarda de origen ORIGEN_INVALIDO (3.1)', () => {
  const origenesInvalidos: ReadonlyArray<Partial<ReservaConfirmacion>> = [
    { estado: 'consulta', subEstado: '2a' },
    { estado: 'consulta', subEstado: '2b' },
    { estado: 'consulta', subEstado: '2c' },
    { estado: 'consulta', subEstado: '2d' },
    { estado: 'consulta', subEstado: '2v' },
    { estado: 'consulta', subEstado: '2x' },
    { estado: 'reserva_confirmada', subEstado: null },
    { estado: 'evento_en_curso', subEstado: null },
    { estado: 'reserva_completada', subEstado: null },
    { estado: 'reserva_cancelada', subEstado: null },
  ];

  it.each(origenesInvalidos)(
    'debe_lanzar_ORIGEN_INVALIDO_para_%o_sin_efectos',
    async (over) => {
      const { useCase, repos, uow, almacenarJustificante } = montar({
        reserva: reservaEnPreReserva(over),
      });

      const promesa = useCase.ejecutar(comando());
      await expect(promesa).rejects.toBeInstanceOf(OrigenInvalidoError);
      await expect(promesa).rejects.toMatchObject({ codigo: 'ORIGEN_INVALIDO' });

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(almacenarJustificante).not.toHaveBeenCalled();
      expect(repos.documentos.crearJustificante).not.toHaveBeenCalled();
      expect(repos.reservas.confirmarSenal).not.toHaveBeenCalled();
      expect(repos.fechaBloqueada.upgradeAFirme).not.toHaveBeenCalled();
      expect(repos.auditoria.registrar).not.toHaveBeenCalled();
    },
  );

  it('debe_exponer_el_mensaje_la_reserva_no_esta_en_estado_pre_reserva', async () => {
    const { useCase } = montar({
      reserva: reservaEnPreReserva({ estado: 'reserva_confirmada' }),
    });

    await expect(useCase.ejecutar(comando())).rejects.toMatchObject({
      codigo: 'ORIGEN_INVALIDO',
      message: expect.stringContaining('pre_reserva'),
    });
  });
});

// ===========================================================================
// IMPORTE_TOTAL_INVALIDO — importe_total 0/null/negativo (sin presupuesto
//        aceptado previo válido) → rechazo SIN efectos.
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — IMPORTE_TOTAL_INVALIDO', () => {
  const importesInvalidos: ReadonlyArray<string | null> = [null, '0.00', '-100.00'];

  it.each(importesInvalidos)(
    'debe_lanzar_IMPORTE_TOTAL_INVALIDO_cuando_importe_total_es_%s_sin_efectos',
    async (importeTotal) => {
      const { useCase, repos, uow } = montar({
        reserva: reservaEnPreReserva({ importeTotal }),
      });

      const promesa = useCase.ejecutar(comando());
      await expect(promesa).rejects.toBeInstanceOf(ImporteTotalInvalidoError);
      await expect(promesa).rejects.toMatchObject({ codigo: 'IMPORTE_TOTAL_INVALIDO' });

      expect(uow.ejecutar).not.toHaveBeenCalled();
      expect(repos.reservas.confirmarSenal).not.toHaveBeenCalled();
    },
  );
});

// ===========================================================================
// 3.5 — Congelado de importes: señal = round(total × pct_senal/100, 2);
//        liquidación = total − señal (complemento por resta). SIEMPRE
//        señal + liquidación = total EXACTO. pct_senal desde TENANT_SETTINGS.
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — congelado de importes señal/liquidación (3.5)', () => {
  it('debe_congelar_1200_de_senal_y_1800_de_liquidacion_para_3000_al_40_por_ciento', async () => {
    const { useCase, repos } = montar({
      reserva: reservaEnPreReserva({ importeTotal: '3000.00' }),
      settings: { pctSenal: 40 },
    });

    await useCase.ejecutar(comando());

    const args = repos.reservas.confirmarSenal.mock.calls[0][0];
    expect(args.importeSenal).toBe('1200.00');
    expect(args.importeLiquidacion).toBe('1800.00');
    // Invariante: señal + liquidación = total EXACTO.
    expect(Number(args.importeSenal) + Number(args.importeLiquidacion)).toBe(3000);
  });

  it('debe_derivar_el_porcentaje_de_TENANT_SETTINGS_1000_1000_para_2000_al_50_por_ciento', async () => {
    const { useCase, repos } = montar({
      reserva: reservaEnPreReserva({ importeTotal: '2000.00' }),
      settings: { pctSenal: 50 },
    });

    await useCase.ejecutar(comando());

    const args = repos.reservas.confirmarSenal.mock.calls[0][0];
    expect(args.importeSenal).toBe('1000.00');
    expect(args.importeLiquidacion).toBe('1000.00');
    expect(Number(args.importeSenal) + Number(args.importeLiquidacion)).toBe(2000);
  });

  it('debe_cumplir_la_invariante_de_complemento_por_resta_sin_desajuste_de_centimos', async () => {
    // 1000.01 × 40% = 400.004 → redondea a 400.00; liquidación = 600.01 (resta),
    // NO 600.006→600.01 (que también sería 600.01 aquí, pero la resta lo garantiza
    // en TODOS los casos): señal + liquidación = total EXACTO.
    const { useCase, repos } = montar({
      reserva: reservaEnPreReserva({ importeTotal: '1000.01' }),
      settings: { pctSenal: 40 },
    });

    await useCase.ejecutar(comando());

    const args = repos.reservas.confirmarSenal.mock.calls[0][0];
    expect(Number(args.importeSenal) + Number(args.importeLiquidacion)).toBeCloseTo(1000.01, 2);
  });

  it('debe_fijar_ttl_expiracion_a_null_al_confirmar', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const args = repos.reservas.confirmarSenal.mock.calls[0][0];
    expect(args.ttlExpiracion).toBeNull();
    expect(args.estado).toBe('reserva_confirmada');
  });
});

// ===========================================================================
// Inicialización de los tres sub-procesos paralelos = 'pendiente'.
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — init sub-procesos en pendiente', () => {
  it('debe_inicializar_pre_evento_liquidacion_y_fianza_status_en_pendiente', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    const args = repos.reservas.confirmarSenal.mock.calls[0][0];
    expect(args.preEventoStatus).toBe('pendiente');
    expect(args.liquidacionStatus).toBe('pendiente');
    expect(args.fianzaStatus).toBe('pendiente');
  });
});

// ===========================================================================
// DOCUMENTO justificante_pago: se crea con tipo, reserva_id, tenant_id, url y
//        mime_type del fichero subido; se almacena físicamente ANTES del commit.
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — creación del DOCUMENTO justificante_pago', () => {
  it('debe_crear_un_DOCUMENTO_justificante_pago_con_url_y_mime_del_fichero', async () => {
    const { useCase, repos, almacenarJustificante } = montar({
      almacenarUrl: 'https://docs/just-99.pdf',
    });

    await useCase.ejecutar(comando({ justificante: justificanteValido({ mimeType: 'image/png' }) }));

    expect(almacenarJustificante).toHaveBeenCalledTimes(1);
    expect(repos.documentos.crearJustificante).toHaveBeenCalledTimes(1);
    const args = repos.documentos.crearJustificante.mock.calls[0][0];
    expect(args.tipo).toBe('justificante_pago');
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.tenantId).toBe(TENANT);
    expect(args.url).toBe('https://docs/just-99.pdf');
    expect(args.mimeType).toBe('image/png');
  });
});

// ===========================================================================
// 3.6 — Idempotencia de FICHA_OPERATIVA: si ya existe una con ese reserva_id,
//        NO se duplica y la transición continúa sin error.
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — idempotencia de FICHA_OPERATIVA (3.6)', () => {
  it('debe_crear_una_FICHA_OPERATIVA_vacia_cuando_no_existe', async () => {
    const { useCase, repos } = montar({ fichaExistente: false });

    await useCase.ejecutar(comando());

    expect(repos.fichaOperativa.buscarPorReserva).toHaveBeenCalledTimes(1);
    expect(repos.fichaOperativa.crearVacia).toHaveBeenCalledTimes(1);
    const args = repos.fichaOperativa.crearVacia.mock.calls[0][0];
    expect(args.reservaId).toBe(RESERVA_ID);
    expect(args.fichaCerrada).toBe(false);
  });

  it('no_debe_duplicar_la_FICHA_OPERATIVA_si_ya_existe_y_debe_continuar_sin_error', async () => {
    const { useCase, repos } = montar({ fichaExistente: true });

    // No lanza: la transición continúa (confirmación completa).
    await expect(useCase.ejecutar(comando())).resolves.toBeDefined();

    expect(repos.fichaOperativa.buscarPorReserva).toHaveBeenCalledTimes(1);
    // Detecta la existente y NO crea un duplicado.
    expect(repos.fichaOperativa.crearVacia).not.toHaveBeenCalled();
    // El resto de la transición SÍ se aplicó (no aborta).
    expect(repos.reservas.confirmarSenal).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// AUDIT_LOG: accion='transicion', entidad='RESERVA', datos_anteriores.estado=
//        'pre_reserva', datos_nuevos.estado='reserva_confirmada'.
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — auditoría de la transición', () => {
  it('debe_registrar_AUDIT_LOG_de_transicion_pre_reserva_a_reserva_confirmada', async () => {
    const { useCase, repos } = montar();

    await useCase.ejecutar(comando());

    expect(repos.auditoria.registrar).toHaveBeenCalledTimes(1);
    const args = repos.auditoria.registrar.mock.calls[0][0];
    expect(args.accion).toBe('transicion');
    expect(args.entidad).toBe('RESERVA');
    expect(args.entidadId).toBe(RESERVA_ID);
    expect(args.datosAnteriores.estado).toBe('pre_reserva');
    expect(args.datosNuevos.estado).toBe('reserva_confirmada');
  });
});

// ===========================================================================
// Orquestación en una única UoW + presentación de factura POST-commit.
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — orquestación transaccional', () => {
  it('debe_orquestar_toda_la_confirmacion_dentro_de_una_unica_unidad_de_trabajo', async () => {
    const { useCase, uow } = montar();

    await useCase.ejecutar(comando());

    expect(uow.ejecutar).toHaveBeenCalledTimes(1);
  });

  it('debe_presentar_la_factura_de_senal_en_borrador_DESPUES_del_commit', async () => {
    const { useCase, presentarFacturaSenalBorrador, repos } = montar();
    const orden: string[] = [];
    repos.reservas.confirmarSenal.mockImplementation(async () => {
      orden.push('commit');
    });
    presentarFacturaSenalBorrador.mockImplementation(async () => {
      orden.push('presentarFactura');
    });

    await useCase.ejecutar(comando());

    expect(presentarFacturaSenalBorrador).toHaveBeenCalledTimes(1);
    // La presentación es POSTERIOR a la mutación transaccional.
    expect(orden.indexOf('presentarFactura')).toBeGreaterThan(orden.indexOf('commit'));
  });

  it('no_debe_revertir_la_confirmacion_si_la_presentacion_de_la_factura_falla', async () => {
    const { useCase, presentarFacturaSenalBorrador } = montar();
    presentarFacturaSenalBorrador.mockRejectedValueOnce(new Error('US-022 aún no lista'));

    // El fallo post-commit NO revierte: la confirmación ya está comprometida.
    await expect(useCase.ejecutar(comando())).resolves.toBeDefined();
  });
});

// ===========================================================================
// 404 — RESERVA inexistente para el tenant (RLS: cross-tenant invisible).
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — RESERVA inexistente / cross-tenant → 404', () => {
  it('debe_lanzar_ReservaNoEncontrada_cuando_no_existe_para_el_tenant_sin_efectos', async () => {
    const { useCase, repos, almacenarJustificante } = montar({ reserva: null });

    await expect(
      useCase.ejecutar(comando({ tenantId: OTRO_TENANT })),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);
    expect(almacenarJustificante).not.toHaveBeenCalled();
    expect(repos.documentos.crearJustificante).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Atomicidad (vertiente de orquestación): si CUALQUIER operación de la tx
//        falla, el error se PROPAGA para que la UoW haga rollback (all-or-nothing).
//        La atomicidad REAL (estado de BD) se verifica en …-integracion.spec.ts.
// ===========================================================================

describe('ConfirmarPagoSenalUseCase — propagación de fallo para rollback', () => {
  it.each([
    'crearJustificante',
    'confirmarSenal',
    'upgradeAFirme',
    'crearFicha',
    'auditoria',
  ] as const)(
    'debe_propagar_el_error_cuando_falla_%s_para_que_la_tx_revierta',
    async (op) => {
      const { useCase } = montar({ fallarEn: op });

      await expect(useCase.ejecutar(comando())).rejects.toThrow(
        `FALLO_${op.toUpperCase()}`,
      );
    },
  );
});
