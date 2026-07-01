/**
 * TEST del BINDING del módulo para la PROMOCIÓN de cola (US-018) — fase TDD RED.
 * tasks.md Fase 3 (soporte de 3.2/3.3) y Fase 4.2/4.4 (re-binding stub → adaptador
 * real).
 *
 * Trazabilidad: US-018, design.md §D-1 (SUSTITUIR el stub `PromocionColaStubAdapter`
 * por el adaptador real que invoca `PromoverPrimeroEnColaService`; NO re-inventar el
 * seam), §D-2 (infraestructura: `PromocionColaPrismaAdapter implements
 * PromocionColaPort` + re-binding en `reservas.module.ts`). CLAUDE.md §Hooks
 * (`no-distributed-lock`, `no-infra-in-domain`).
 *
 * Verifica que el `ReservasModule` deja de resolver el `PROMOCION_COLA_PORT` al stub
 * no-op y pasa a resolver el adaptador real de US-018, y que el caso de uso de
 * aplicación está registrado.
 *
 * RED: aún NO existen `PromoverPrimeroEnColaService`,
 * `PromocionColaPrismaAdapter`, ni el re-binding; el módulo sigue enlazando el stub.
 * Los imports/resoluciones fallan y la batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ReservasModule } from '../reservas.module';
import { PROMOCION_COLA_PORT } from '../reservas.tokens';
import { PromoverPrimeroEnColaService } from '../application/promover-primero-en-cola.service';
import { PromocionColaPrismaAdapter } from '../infrastructure/promocion-cola.prisma.adapter';
import { PromocionColaStubAdapter } from '../infrastructure/promocion-cola.stub.adapter';

let moduleRef: TestingModule;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), ReservasModule],
  }).compile();
  await moduleRef.init();
});

afterAll(async () => {
  await moduleRef.close();
});

describe('ReservasModule — binding de la promoción de cola (US-018)', () => {
  it('debe_resolver_el_PROMOCION_COLA_PORT_al_adaptador_real_no_al_stub', () => {
    const adapter = moduleRef.get(PROMOCION_COLA_PORT);
    expect(adapter).toBeInstanceOf(PromocionColaPrismaAdapter);
    expect(adapter).not.toBeInstanceOf(PromocionColaStubAdapter);
  });

  it('debe_registrar_el_caso_de_uso_PromoverPrimeroEnColaService', () => {
    expect(moduleRef.get(PromoverPrimeroEnColaService)).toBeInstanceOf(
      PromoverPrimeroEnColaService,
    );
  });
});
