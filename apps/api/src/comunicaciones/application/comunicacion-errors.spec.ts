/**
 * Regresión (QA US-046): los errores de aplicación que el controller mapea por
 * `instanceof` DEBEN ser la MISMA clase en todos los use-cases. Antes, el email `manual`
 * definía su propio `DestinatarioInvalidoError`/`ProveedorEmailError`, distinto del que
 * comprobaba el controller → el 422/502 del endpoint `manual` caía a un 500 genérico.
 * Este test bloquea que vuelva a divergir.
 */
import {
  DestinatarioInvalidoError as ErrCanonicoDestinatario,
  ProveedorEmailError as ErrCanonicoProveedor,
} from './comunicacion-errors';
import {
  DestinatarioInvalidoError as ErrEnviarDestinatario,
  ProveedorEmailError as ErrEnviarProveedor,
} from './enviar-borrador.use-case';
import {
  DestinatarioInvalidoError as ErrManualDestinatario,
  ProveedorEmailError as ErrManualProveedor,
} from './crear-email-manual.use-case';

describe('Errores compartidos de comunicaciones (mapeo del controller por instanceof)', () => {
  it('DestinatarioInvalidoError es la misma clase en el módulo canónico, enviar y manual', () => {
    expect(ErrEnviarDestinatario).toBe(ErrCanonicoDestinatario);
    expect(ErrManualDestinatario).toBe(ErrCanonicoDestinatario);
    // Una instancia lanzada por el use-case `manual` es reconocida por el `instanceof`
    // que usa el controller (importado vía `enviar-borrador`).
    expect(new ErrManualDestinatario()).toBeInstanceOf(ErrEnviarDestinatario);
  });

  it('ProveedorEmailError es la misma clase en el módulo canónico, enviar y manual', () => {
    expect(ErrEnviarProveedor).toBe(ErrCanonicoProveedor);
    expect(ErrManualProveedor).toBe(ErrCanonicoProveedor);
    expect(new ErrManualProveedor()).toBeInstanceOf(ErrEnviarProveedor);
  });
});
