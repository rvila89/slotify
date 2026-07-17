/**
 * TESTS DE INTEGRACIÓN HTTP del endpoint del histórico `GET /api/historico` →
 * `ReservaHistoricoListResponse` (US-042 / UC-32) — fase TDD RED.
 *
 * Frontera HTTP REAL con supertest y el MISMO `ValidationPipe` GLOBAL +
 * `HttpExceptionFilter` que `main.ts`. El `ListarHistoricoUseCase` se DOBLA (in-memory)
 * para no tocar Prisma (hexagonal): se verifica el CONTRATO del controller (forma de la
 * respuesta HTTP, tenant del JWT, validación de `limit`, guard de auth), NO la transacción.
 *
 * El `JwtAuthGuard` del controller se DOBLA por un guard falso que: (a) rechaza con 401
 * cuando NO hay usuario (simula token ausente/inválido), y (b) inyecta `req.user` cuando
 * lo hay. Así el test exige que el controller ESTÉ guardado (`@UseGuards(JwtAuthGuard)`)
 * y ejercita el 401 del contrato sin cablear passport.
 *
 * Cubre:
 *   - 200 con la forma del contrato (`{ data: ReservaHistorico[], metadata }`);
 *   - el `tenant_id` deriva SIEMPRE del JWT, nunca del query;
 *   - `estadoFinal` opt-in de canceladas viaja al comando;
 *   - 400 con `limit` fuera de rango (>100) — validación de la paginación;
 *   - 401 sin JWT (guard de auth).
 *
 * RED HOY: `../interface/listar-historico.controller` y `../application/listar-historico.use-case`
 * todavía NO existen → estas aserciones fallan por AUSENCIA de implementación (no por error
 * trivial). El GREEN es de `backend-developer`.
 */
import { UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import { ListarHistoricoController } from '../interface/listar-historico.controller';
import {
  ListarHistoricoUseCase,
  type ListarHistoricoComando,
  type HistoricoListResponse,
} from '../application/listar-historico.use-case';
import { HttpExceptionFilter } from '../../shared/filters/http-exception.filter';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

const TENANT = '00000000-0000-0000-0000-000000000001';
const GESTOR = '00000000-0000-0000-0000-0000000000a1';
const usuarioGestor: UsuarioAutenticado = { sub: GESTOR, tenantId: TENANT, rol: 'gestor' };

// Usuario "actual" mutable: undefined ⇒ el guard falso responde 401 (sin JWT válido).
let usuarioActual: UsuarioAutenticado | undefined = usuarioGestor;

// Doble del JwtAuthGuard: 401 si no hay usuario; si lo hay, lo cuelga en req.user.
class JwtAuthGuardFalso implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (usuarioActual === undefined) {
      throw new UnauthorizedException('No autenticado: token ausente o inválido');
    }
    const req = context.switchToHttp().getRequest<Request>();
    req.user = usuarioActual;
    return true;
  }
}

// Respuesta que el use-case doblado devuelve: una fila LIGERA `ReservaHistorico` con TODOS
// los campos del contrato poblados. Es la forma que la proyección del use-case DEBE producir.
const respuestaConforme: HistoricoListResponse = {
  data: [
    {
      idReserva: '11111111-1111-1111-1111-111111111111',
      codigo: 'SLO-2026-0001',
      clienteId: '22222222-2222-2222-2222-222222222222',
      clienteNombre: 'Ana',
      clienteApellidos: 'García López',
      estado: 'reserva_completada',
      fechaEvento: '2026-05-20',
      tipoEvento: 'boda',
      importeTotal: '12000.00',
    },
  ],
  metadata: { total: 1, page: 1, limit: 20, totalPages: 1 },
} as unknown as HistoricoListResponse;

let ultimoComando: ListarHistoricoComando | null = null;

const useCaseFalso = {
  ejecutar: async (comando: ListarHistoricoComando): Promise<HistoricoListResponse> => {
    ultimoComando = comando;
    return respuestaConforme;
  },
} as unknown as ListarHistoricoUseCase;

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ListarHistoricoController],
    providers: [{ provide: ListarHistoricoUseCase, useValue: useCaseFalso }],
  })
    // El controller DEBE declarar `@UseGuards(JwtAuthGuard)`; aquí se sustituye por el doble.
    .overrideGuard(JwtAuthGuard)
    .useClass(JwtAuthGuardFalso)
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  ultimoComando = null;
  usuarioActual = usuarioGestor;
});

describe('GET /api/historico — contrato del controller del histórico (US-042)', () => {
  it('debe_responder_200_y_derivar_el_tenant_del_jwt', async () => {
    const res = await request(app.getHttpServer()).get('/api/historico');

    expect(res.status).toBe(200);
    // El tenant SIEMPRE deriva del JWT, nunca del query.
    expect(ultimoComando?.tenantId).toBe(TENANT);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('debe_devolver_cada_fila_con_la_forma_del_schema_ReservaHistorico', async () => {
    const res = await request(app.getHttpServer()).get('/api/historico');

    const item = res.body.data[0];
    expect(item.idReserva).toBe('11111111-1111-1111-1111-111111111111');
    expect(item.codigo).toBe('SLO-2026-0001');
    expect(item.clienteId).toBe('22222222-2222-2222-2222-222222222222');
    expect(item.clienteNombre).toBe('Ana');
    expect(item.clienteApellidos).toBe('García López');
    expect(item.estado).toBe('reserva_completada');
    expect(item.fechaEvento).toBe('2026-05-20');
    expect(item.tipoEvento).toBe('boda');
    expect(item.importeTotal).toBe('12000.00');
    // Fila LIGERA: sin derivados del pipeline ni `id` renombrado.
    expect(item).not.toHaveProperty('id');
    expect(item).not.toHaveProperty('progressLogistica');
    expect(item).not.toHaveProperty('progressLiquidacion');
  });

  it('debe_devolver_el_envoltorio_metadata_del_contrato', async () => {
    const res = await request(app.getHttpServer()).get('/api/historico');

    expect(res.body.metadata).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
  });

  it('debe_propagar_estadoFinal_y_filtros_de_query_al_comando', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/historico?estadoFinal=reserva_cancelada&q=Garc%C3%ADa&tipoEvento=boda&importeMin=1000.00&importeMax=20000.00&fechaDesde=2026-01-01&fechaHasta=2026-03-31',
    );

    expect(res.status).toBe(200);
    expect(ultimoComando?.estadoFinal).toBe('reserva_cancelada');
    expect(ultimoComando?.q).toBe('García');
    expect(ultimoComando?.tipoEvento).toBe('boda');
    expect(ultimoComando?.importeMin).toBe('1000.00');
    expect(ultimoComando?.importeMax).toBe('20000.00');
  });

  it('debe_usar_page_1_y_limit_20_por_defecto_cuando_no_se_pasan', async () => {
    await request(app.getHttpServer()).get('/api/historico');

    expect(ultimoComando?.page).toBe(1);
    expect(ultimoComando?.limit).toBe(20);
  });

  it('debe_responder_400_cuando_limit_supera_100', async () => {
    const res = await request(app.getHttpServer()).get('/api/historico?limit=500');

    expect(res.status).toBe(400);
    // No se ejecuta el use-case cuando la validación falla.
    expect(ultimoComando).toBeNull();
  });

  it('debe_responder_400_cuando_page_es_menor_que_1', async () => {
    const res = await request(app.getHttpServer()).get('/api/historico?page=0');

    expect(res.status).toBe(400);
    expect(ultimoComando).toBeNull();
  });

  it('debe_responder_400_cuando_estadoFinal_no_es_un_estado_cerrado_valido', async () => {
    // `estadoFinal` solo admite reserva_completada | reserva_cancelada (nunca activos).
    const res = await request(app.getHttpServer()).get('/api/historico?estadoFinal=pre_reserva');

    expect(res.status).toBe(400);
    expect(ultimoComando).toBeNull();
  });
});

describe('GET /api/historico — autenticación (401 sin JWT)', () => {
  it('debe_responder_401_y_no_ejecutar_el_caso_de_uso_cuando_no_hay_jwt', async () => {
    usuarioActual = undefined; // sin usuario → guard responde 401.

    const res = await request(app.getHttpServer()).get('/api/historico');

    expect(res.status).toBe(401);
    expect(ultimoComando).toBeNull();
  });
});
