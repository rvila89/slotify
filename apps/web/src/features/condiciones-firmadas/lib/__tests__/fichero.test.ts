import { describe, expect, it } from 'vitest';
import {
  MAX_BYTES_CONDICIONES,
  MENSAJE_CONDICIONES_REQUERIDAS,
  MENSAJE_FORMATO_NO_PERMITIDO,
  MENSAJE_TAMANO_EXCEDIDO,
  validarFicheroFirmado,
} from '../fichero';

const ficheroFalso = (type: string, size: number): File =>
  ({ type, size, name: 'doc' }) as unknown as File;

/** US-024 — validación de cliente del fichero (JPEG/PNG/PDF ≤ 10 MB). */
describe('validarFicheroFirmado', () => {
  it('exige fichero cuando falta', () => {
    expect(validarFicheroFirmado(null)).toBe(MENSAJE_CONDICIONES_REQUERIDAS);
    expect(validarFicheroFirmado(undefined)).toBe(MENSAJE_CONDICIONES_REQUERIDAS);
  });

  it.each(['image/jpeg', 'image/png', 'application/pdf'])('acepta %s dentro del tamaño', (mime) => {
    expect(validarFicheroFirmado(ficheroFalso(mime, 1024))).toBeNull();
  });

  it('rechaza mime no permitido', () => {
    expect(
      validarFicheroFirmado(
        ficheroFalso('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10),
      ),
    ).toBe(MENSAJE_FORMATO_NO_PERMITIDO);
  });

  it('rechaza fichero mayor de 10 MB', () => {
    expect(validarFicheroFirmado(ficheroFalso('application/pdf', MAX_BYTES_CONDICIONES + 1))).toBe(
      MENSAJE_TAMANO_EXCEDIDO,
    );
  });

  it('acepta exactamente 10 MB', () => {
    expect(validarFicheroFirmado(ficheroFalso('application/pdf', MAX_BYTES_CONDICIONES))).toBeNull();
  });
});
