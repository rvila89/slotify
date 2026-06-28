/**
 * TESTS del adaptador FAKE de email `FakeEmailAdapter` (US-045) — fase TDD RED.
 * tasks.md Fase 2: 2.6.
 *
 * Trazabilidad: US-045, spec-delta `comunicaciones` (Requirement: "Transporte real
 * de email con proveedor y modo sandbox para CI/QA"), design.md §1 (modo `fake` en
 * memoria, forzado en test/CI → cero envíos reales) y §6 (contrato del puerto
 * `EnviarEmailPort` estable, comando extendido SOLO con opcionales retro-compatibles).
 *
 * El FAKE implementa el puerto de dominio `EnviarEmailPort` sin tocar la red:
 * registra los envíos en memoria para las aserciones y puede simular un fallo del
 * proveedor para los tests del motor. Es el adaptador que se selecciona con
 * `EMAIL_TRANSPORT=fake` (forzado en `test`/CI).
 *
 * RED: aún no existe `comunicaciones/infrastructure/fake-email.adapter.ts` ni la
 * extensión opcional del comando en `enviar-email.port.ts`; los imports/campos
 * fallan y la batería está en ROJO. GREEN = `backend-developer`.
 */
import { FakeEmailAdapter } from './fake-email.adapter';
import type { EnviarEmailComando, EnviarEmailPort } from '../domain/enviar-email.port';

describe('FakeEmailAdapter — transporte en memoria sin red (2.6)', () => {
  it('debe_implementar_el_puerto_de_dominio_EnviarEmailPort', () => {
    const fake: EnviarEmailPort = new FakeEmailAdapter();
    expect(typeof fake.enviar).toBe('function');
  });

  it('debe_registrar_en_memoria_cada_envio_sin_realizar_ninguna_llamada_de_red', async () => {
    const fake = new FakeEmailAdapter();

    await fake.enviar({
      destinatario: 'marta.soler@example.com',
      asunto: 'Hemos recibido tu consulta',
      cuerpo: 'Gracias por tu interés.',
      codigoEmail: 'E1',
    });

    expect(fake.enviados).toHaveLength(1);
    expect(fake.enviados[0]).toMatchObject({
      destinatario: 'marta.soler@example.com',
      codigoEmail: 'E1',
    });
  });

  it('debe_acumular_los_envios_en_orden_para_las_aserciones', async () => {
    const fake = new FakeEmailAdapter();

    await fake.enviar({ destinatario: 'a@e.com', asunto: 'A', cuerpo: 'a', codigoEmail: 'E1' });
    await fake.enviar({ destinatario: 'b@e.com', asunto: 'B', cuerpo: 'b', codigoEmail: 'E1' });

    expect(fake.enviados.map((c) => c.destinatario)).toEqual(['a@e.com', 'b@e.com']);
  });

  it('debe_poder_simular_un_fallo_del_proveedor_para_los_tests_del_motor', async () => {
    const fake = new FakeEmailAdapter();
    fake.forzarFallo(new Error('proveedor caído'));

    await expect(
      fake.enviar({ destinatario: 'a@e.com', asunto: 'A', cuerpo: 'a', codigoEmail: 'E1' }),
    ).rejects.toThrow('proveedor caído');
    // Un envío fallido no se contabiliza como entregado.
    expect(fake.enviados).toHaveLength(0);
  });

  it('debe_aceptar_el_comando_extendido_con_campos_opcionales_retro_compatibles', async () => {
    // design.md §6: el comando se extiende SOLO con opcionales (idioma, variables,
    // adjuntos, tenantId). Los llamadores antiguos (4 campos) siguen compilando.
    const fake = new FakeEmailAdapter();

    const comandoExtendido: EnviarEmailComando = {
      destinatario: 'marta.soler@example.com',
      asunto: 'ASUNTO-E1',
      cuerpo: '<p>Hola Marta</p>',
      codigoEmail: 'E1',
      idioma: 'es',
      tenantId: '00000000-0000-0000-0000-000000000001',
      variables: { nombre: 'Marta', codigoReserva: '26-0001' },
      adjuntos: [{ clave: 'presupuesto', nombre: 'presupuesto.pdf', pdfUrl: 'https://docs/p.pdf' }],
    };

    await fake.enviar(comandoExtendido);

    expect(fake.enviados[0]).toMatchObject({ idioma: 'es', codigoEmail: 'E1' });
  });

  it('debe_seguir_aceptando_el_comando_minimo_de_cuatro_campos_de_US_003', () => {
    // Regresión del contrato: el comando original (US-003) sigue siendo válido.
    const comandoMinimo: EnviarEmailComando = {
      destinatario: 'marta.soler@example.com',
      asunto: 'Hemos recibido tu consulta',
      cuerpo: 'Gracias por tu interés.',
      codigoEmail: 'E1',
    };

    expect(comandoMinimo.codigoEmail).toBe('E1');
  });
});
