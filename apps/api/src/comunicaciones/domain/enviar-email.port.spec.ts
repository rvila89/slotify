/**
 * Test de CONTRATO del puerto de dominio `EnviarEmailPort` (US-003 / UC-03).
 *
 * El puerto es una interfaz PURA (sin lógica ejecutable): su comportamiento real
 * se ejercita en `alta-consulta.use-case.spec.ts` mediante un doble. Aquí se fija
 * el CONTRATO de forma: una implementación conforme expone `enviar(...)` que
 * acepta `{ destinatario, asunto, cuerpo, codigoEmail }` y devuelve `Promise<void>`.
 */
import type {
  EnviarEmailComando,
  EnviarEmailPort,
} from './enviar-email.port';

describe('EnviarEmailPort — contrato del puerto de dominio', () => {
  it('debe_aceptar_una_implementacion_que_envie_el_comando_completo', async () => {
    const recibidos: EnviarEmailComando[] = [];
    const adaptador: EnviarEmailPort = {
      enviar: async (comando) => {
        recibidos.push(comando);
      },
    };

    await adaptador.enviar({
      destinatario: 'marta.soler@example.com',
      asunto: 'Hemos recibido tu consulta',
      cuerpo: 'Gracias por tu interés.',
      codigoEmail: 'E1',
    });

    expect(recibidos).toHaveLength(1);
    expect(recibidos[0]).toMatchObject({
      destinatario: 'marta.soler@example.com',
      codigoEmail: 'E1',
    });
  });
});
