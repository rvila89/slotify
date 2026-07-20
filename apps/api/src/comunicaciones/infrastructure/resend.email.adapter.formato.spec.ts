/**
 * TESTS del BORDE DE ENVÍO — formato del cuerpo (texto plano → HTML) sin doble-escape
 * del catálogo — fase TDD RED (change `consulta-fecha-borrador-fix`, design.md §D-2).
 *
 * Trazabilidad: spec-delta `comunicaciones` — Requirement "Confirmación de envío de un
 * borrador con edición opcional de asunto y cuerpo":
 *   - Cuerpo TEXTO PLANO (E1 de transición / email manual) → el payload al proveedor lleva
 *     `html` con `<p>`/`<br>` (formato preservado) y `text` con el texto crudo.
 *   - Cuerpo YA HTML del catálogo (`<p>`/`<br>`) → `html` se envía INTACTO (sin doble-escape).
 *
 * Decisión de diseño (§D-2, alternativa preferida): flag EXPLÍCITO en `EnviarEmailComando`.
 * Estos tests asumen `cuerpoEsHtml: boolean` (opcional, retro-compatible): `true` → el cuerpo
 * ya es HTML del catálogo y NO se convierte; `false`/ausente → texto plano, se convierte con
 * `textoPlanoAHtml` en el borde de envío. Un flag explícito evita depender de una heurística
 * frágil de detección de marcado.
 *
 * El proveedor externo (Resend) se DOBLA mockeando el módulo `resend`, de modo que el test
 * inspecciona el payload que el adaptador construye (`html`/`text`) sin tocar la red.
 *
 * RED: aún NO existe el campo `cuerpoEsHtml` en `EnviarEmailComando` ni la conversión
 * texto→HTML en `ResendEmailAdapter.enviar` (hoy hace `html: cuerpo, text: cuerpo` crudo).
 * Los campos/assertions fallan → batería en ROJO. GREEN es de `backend-developer`.
 */

const sendMock = jest.fn(
  async (_payload: Record<string, unknown>) => ({ data: { id: 'resend-id-1' }, error: null }),
);

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (payload: Record<string, unknown>) => sendMock(payload) },
  })),
}));

import { ResendEmailAdapter } from './resend.email.adapter';
import type { EnviarEmailComando } from '../domain/enviar-email.port';

const crearAdapter = () =>
  new ResendEmailAdapter({
    apiKey: 'test-key',
    from: 'Masia <no-reply@masialencis.com>',
    sandbox: false,
  });

const comandoBase = (over: Partial<EnviarEmailComando>): EnviarEmailComando => ({
  destinatario: 'marta.soler@example.com',
  asunto: 'Pre-reserva confirmada',
  cuerpo: '',
  codigoEmail: 'E1',
  ...over,
});

/** Extrae el último payload enviado a `emails.send`. */
const ultimoPayload = (): { html: string; text: string } => {
  const calls = sendMock.mock.calls;
  const ultimo = calls[calls.length - 1]?.[0] as
    | { html: string; text: string }
    | undefined;
  if (ultimo === undefined) {
    throw new Error('No se registró ningún envío en el proveedor mockeado');
  }
  return ultimo;
};

beforeEach(() => {
  sendMock.mockClear();
  sendMock.mockResolvedValue({ data: { id: 'resend-id-1' }, error: null });
});

describe('ResendEmailAdapter — cuerpo TEXTO PLANO se envía como HTML preservando el formato', () => {
  it('debe_enviar_html_con_p_y_br_a_partir_del_texto_plano', async () => {
    const adapter = crearAdapter();
    const cuerpo = 'Hola Marta,\n\nLa fecha está disponible.\nQuedo a tu disposición.';

    await adapter.enviar(comandoBase({ cuerpo, cuerpoEsHtml: false }));

    const { html } = ultimoPayload();
    expect(html).toContain('<p>Hola Marta,</p>');
    expect(html).toContain('<br>');
    expect(html).toContain('<p>');
  });

  it('debe_conservar_el_texto_crudo_en_text', async () => {
    const adapter = crearAdapter();
    const cuerpo = 'Hola Marta,\n\nLa fecha está disponible.';

    await adapter.enviar(comandoBase({ cuerpo, cuerpoEsHtml: false }));

    const { text } = ultimoPayload();
    expect(text).toBe(cuerpo);
  });

  it('sin_flag_trata_el_cuerpo_como_texto_plano_por_defecto', async () => {
    const adapter = crearAdapter();
    const cuerpo = 'Primera línea\n\nSegunda línea';

    // Ausencia del flag ⇒ texto plano (retro-compatible con los llamadores existentes).
    await adapter.enviar(comandoBase({ cuerpo }));

    const { html } = ultimoPayload();
    expect(html).toContain('<p>Primera línea</p>');
    expect(html).toContain('<p>Segunda línea</p>');
  });
});

describe('ResendEmailAdapter — cuerpo YA HTML del catálogo NO se doble-escapa', () => {
  it('debe_enviar_el_html_del_catalogo_intacto_cuando_cuerpoEsHtml_true', async () => {
    const adapter = crearAdapter();
    const cuerpoHtml = '<p>Hola Marta,</p><p>Adjuntamos el presupuesto.<br>Un saludo.</p>';

    await adapter.enviar(comandoBase({ cuerpo: cuerpoHtml, cuerpoEsHtml: true }));

    const { html } = ultimoPayload();
    // El marcado del catálogo llega tal cual: sin escapar ni re-envolver.
    expect(html).toBe(cuerpoHtml);
    expect(html).not.toContain('&lt;p&gt;');
  });

  it.each([
    ['E1', '<p>Hola,</p><p>Tu fecha está disponible.</p>'],
    ['E2', '<p>Hola,</p><ul><li>Revisa el presupuesto.</li></ul>'],
    ['E3', '<p>Hola,</p><p>Confirmación y factura de señal.</p>'],
  ] as const)(
    'no_regresion_%s_del_catalogo_llega_intacto_sin_doble_escape',
    async (codigo, cuerpoHtml) => {
      const adapter = crearAdapter();

      await adapter.enviar(
        comandoBase({ codigoEmail: codigo, cuerpo: cuerpoHtml, cuerpoEsHtml: true }),
      );

      const { html } = ultimoPayload();
      expect(html).toBe(cuerpoHtml);
      expect(html).not.toContain('&lt;');
    },
  );
});
