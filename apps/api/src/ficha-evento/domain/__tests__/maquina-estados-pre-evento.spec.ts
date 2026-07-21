/**
 * TESTS de la MÁQUINA DE ESTADOS de `RESERVA.pre_evento_status` y de la GUARDA
 * «primer guardado con datos» — DOMINIO PURO (US-025 / UC-20 / Módulo M7) — fase TDD RED.
 * tasks.md Fase 3: 3.1 (transiciones) y 3.2 (guarda de contenido).
 *
 * Trazabilidad: US-025; spec-delta `ficha-operativa` (Requirements "Transición
 * pre_evento_status pendiente → en_curso al primer guardado con datos" y "Cierre de
 * la ficha no bloqueado por campos vacíos"); design.md §D-1 (transiciones como
 * ESTRUCTURA DE DATOS: `pendiente → en_curso`, `en_curso → cerrado`; `cerrado`
 * estable, NO existe `cerrado → en_curso`; transición inválida rechazada) y §D-2
 * (guarda del primer guardado con datos: string en blanco/solo espacios = vacío;
 * `numInvitadosConfirmado` entero presente = dato). CLAUDE.md §Máquina de estados
 * (transiciones y guardas como estructura de datos, NO `if` dispersos); skill
 * `state-machine`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): este spec NO importa `@nestjs/*`, Prisma
 * ni infraestructura; ejercita solo funciones puras sobre estructuras de datos.
 *
 * RED: aún NO existe `ficha-evento/domain/maquina-estados-pre-evento.ts` con
 * `esTransicionPreEventoValida`, `tieneAlgunDatoDeContenido` ni los tipos. El import
 * falla en compilación y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN.
 * GREEN es de `backend-developer`.
 */
import {
  esTransicionPreEventoValida,
  tieneAlgunDatoDeContenido,
  type PreEventoStatus,
  type ContenidoFicha,
} from '../maquina-estados-pre-evento';

// ===========================================================================
// 3.1 — Transiciones VÁLIDAS de `pre_evento_status` (D-1). Solo dos aristas:
//        `pendiente → en_curso` (primer guardado con datos) y
//        `en_curso → cerrado` (acción "Cerrar ficha").
// ===========================================================================

describe('esTransicionPreEventoValida — transiciones válidas', () => {
  it('debe_aceptar_pendiente_a_en_curso', () => {
    expect(esTransicionPreEventoValida('pendiente', 'en_curso')).toBe(true);
  });

  it('debe_aceptar_en_curso_a_cerrado', () => {
    expect(esTransicionPreEventoValida('en_curso', 'cerrado')).toBe(true);
  });
});

// ===========================================================================
// 3.1 — `cerrado` es ESTABLE: la edición de una ficha cerrada NO reabre el
//        estado. NO existe la arista `cerrado → en_curso` (ni `cerrado →
//        pendiente`). La edición post-cierre mantiene `cerrado` (D-4), no lo
//        transiciona.
// ===========================================================================

describe('esTransicionPreEventoValida — cerrado no reabre (estado estable)', () => {
  it('no_debe_aceptar_cerrado_a_en_curso', () => {
    expect(esTransicionPreEventoValida('cerrado', 'en_curso')).toBe(false);
  });

  it('no_debe_aceptar_cerrado_a_pendiente', () => {
    expect(esTransicionPreEventoValida('cerrado', 'pendiente')).toBe(false);
  });
});

// ===========================================================================
// 3.1 — Transiciones INVÁLIDAS: cualquier arista que NO esté en la tabla
//        declarativa se rechaza. Incluye saltos (`pendiente → cerrado`),
//        retrocesos (`en_curso → pendiente`) e identidades (`x → x`).
// ===========================================================================

describe('esTransicionPreEventoValida — transiciones inválidas rechazadas', () => {
  const invalidas: ReadonlyArray<[PreEventoStatus, PreEventoStatus]> = [
    ['pendiente', 'cerrado'],
    ['pendiente', 'pendiente'],
    ['en_curso', 'pendiente'],
    ['en_curso', 'en_curso'],
    ['cerrado', 'en_curso'],
    ['cerrado', 'pendiente'],
    ['cerrado', 'cerrado'],
  ];

  it.each(invalidas)(
    'no_debe_aceptar_la_transicion_%s_a_%s',
    (origen, destino) => {
      expect(esTransicionPreEventoValida(origen, destino)).toBe(false);
    },
  );
});

describe('esTransicionPreEventoValida — determinismo (lookup en tabla de datos)', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = esTransicionPreEventoValida('pendiente', 'en_curso');
    const b = esTransicionPreEventoValida('pendiente', 'en_curso');
    expect(a).toBe(b);
  });
});

// ===========================================================================
// 3.2 — GUARDA «primer guardado con datos» (D-2): la ficha tiene al menos un
//        campo de contenido no nulo/no vacío. Es la guarda que dispara
//        `pendiente → en_curso` y se evalúa sobre el RESULTADO del guardado.
// ---------------------------------------------------------------------------
// Todos los campos de contenido nulos → SIN dato → NO dispara.
// ===========================================================================

const fichaVacia = (over: Partial<ContenidoFicha> = {}): ContenidoFicha => ({
  numInvitadosConfirmado: null,
  contactoEventoNombre: null,
  contactoEventoTelefono: null,
  contactoEventoCorreo: null,
  horaLlegada: null,
  duracion: null,
  notasOperativas: null,
  briefingEquipo: null,
  ...over,
});

describe('tieneAlgunDatoDeContenido — ficha completamente vacía no tiene datos', () => {
  it('no_debe_considerar_dato_una_ficha_con_todos_los_campos_nulos', () => {
    expect(tieneAlgunDatoDeContenido(fichaVacia())).toBe(false);
  });
});

// ===========================================================================
// 3.2 — Strings en blanco / solo espacios / tabuladores cuentan como VACÍO
//        (D-2): un guardado que solo trae blancos NO dispara la transición.
// ===========================================================================

describe('tieneAlgunDatoDeContenido — strings en blanco cuentan como vacío', () => {
  const soloBlancos: ReadonlyArray<string> = ['', '   ', '\t', '\n', '  \t \n '];

  it.each(soloBlancos)(
    'no_debe_considerar_dato_duracion_en_blanco_%j',
    (blanco) => {
      expect(tieneAlgunDatoDeContenido(fichaVacia({ duracion: blanco }))).toBe(false);
    },
  );

  it('no_debe_considerar_dato_varios_campos_de_texto_todos_en_blanco', () => {
    expect(
      tieneAlgunDatoDeContenido(
        fichaVacia({
          horaLlegada: '   ',
          duracion: '\t',
          notasOperativas: '',
          briefingEquipo: '  ',
        }),
      ),
    ).toBe(false);
  });
});

// ===========================================================================
// 3.2 — Un string de contenido real (con caracteres no en blanco) SÍ es dato.
// ===========================================================================

describe('tieneAlgunDatoDeContenido — un campo de texto con contenido es dato', () => {
  const conTexto: ReadonlyArray<Partial<ContenidoFicha>> = [
    { horaLlegada: '18:00' },
    { duracion: '4h' },
    { contactoEventoNombre: 'María López' },
    { contactoEventoTelefono: '600123123' },
    { contactoEventoCorreo: 'maria@example.com' },
    { notasOperativas: 'Alergia a los frutos secos' },
    { briefingEquipo: 'Turno de 8 camareros' },
    // Con espacios circundantes pero contenido real → sigue siendo dato.
    { notasOperativas: '  dato con espacios  ' },
  ];

  it.each(conTexto)('debe_considerar_dato_la_ficha_con_%o', (over) => {
    expect(tieneAlgunDatoDeContenido(fichaVacia(over))).toBe(true);
  });
});

// ===========================================================================
// 3.2 — `numInvitadosConfirmado` entero presente = DATO (incluido 0, que es un
//        entero válido presente, no "vacío"). `null` = sin dato.
// ===========================================================================

describe('tieneAlgunDatoDeContenido — numInvitadosConfirmado entero presente es dato', () => {
  it('debe_considerar_dato_un_numero_de_invitados_positivo', () => {
    expect(tieneAlgunDatoDeContenido(fichaVacia({ numInvitadosConfirmado: 85 }))).toBe(true);
  });

  it('debe_considerar_dato_el_entero_cero_presente', () => {
    expect(tieneAlgunDatoDeContenido(fichaVacia({ numInvitadosConfirmado: 0 }))).toBe(true);
  });

  it('no_debe_considerar_dato_numInvitadosConfirmado_null', () => {
    expect(tieneAlgunDatoDeContenido(fichaVacia({ numInvitadosConfirmado: null }))).toBe(false);
  });
});

// ===========================================================================
// 3.2 — Determinismo: la guarda es una función pura sobre el contenido de la
//        ficha (misma entrada → mismo resultado).
// ===========================================================================

describe('tieneAlgunDatoDeContenido — función pura determinista', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const ficha = fichaVacia({ numInvitadosConfirmado: 85 });
    expect(tieneAlgunDatoDeContenido(ficha)).toBe(tieneAlgunDatoDeContenido(ficha));
  });
});
