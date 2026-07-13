/**
 * TDD (RED→GREEN) del caso de uso de LECTURA del catálogo de extras del tenant
 * (US-014, `GET /extras`). Solo lectura, sin transacción de escritura ni máquina
 * de estados: el use-case delega en `CatalogoExtrasPort` y propaga el `tenantId`
 * (que SIEMPRE llega del JWT). El aislamiento multi-tenant (RLS / filtrado por
 * `tenant_id` + `activo=true` + orden) es responsabilidad del adaptador.
 */
import { ListarExtrasUseCase } from '../application/listar-extras.use-case';
import type { CatalogoExtrasPort, ExtraCatalogoItem } from '../domain/catalogo-extras.port';

const crearItem = (over: Partial<ExtraCatalogoItem> = {}): ExtraCatalogoItem => ({
  idExtra: 'extra-1',
  nombre: 'Barbacoa',
  descripcion: 'Servicio de barbacoa para el evento',
  precioEur: 30,
  activo: true,
  ...over,
});

describe('ListarExtrasUseCase', () => {
  it('devuelve el catálogo activo del tenant tal cual lo entrega el puerto', async () => {
    const filas: ExtraCatalogoItem[] = [
      crearItem({ idExtra: 'extra-bbq', nombre: 'Barbacoa' }),
      crearItem({ idExtra: 'extra-pae', nombre: 'Paellero' }),
    ];
    const catalogo: CatalogoExtrasPort = {
      listarActivos: jest.fn().mockResolvedValue(filas),
    };

    const useCase = new ListarExtrasUseCase({ catalogo });
    const resultado = await useCase.ejecutar('tenant-1');

    expect(catalogo.listarActivos).toHaveBeenCalledWith('tenant-1');
    expect(resultado).toEqual(filas);
  });

  it('devuelve lista vacía cuando el tenant no tiene extras', async () => {
    const catalogo: CatalogoExtrasPort = {
      listarActivos: jest.fn().mockResolvedValue([]),
    };

    const useCase = new ListarExtrasUseCase({ catalogo });

    await expect(useCase.ejecutar('tenant-sin-extras')).resolves.toEqual([]);
  });
});
