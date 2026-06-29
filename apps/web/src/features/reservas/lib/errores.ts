import type { UseFormSetError } from 'react-hook-form';
import type { FormularioConsulta } from '../pages/NuevaConsulta/schema';

/**
 * Mapea los mensajes de validación del backend (400, formato NestJS: `message`
 * string o string[]) a los campos del formulario de alta, en español. Devuelve
 * cuántos se pudieron asignar para decidir si además mostrar un aviso general.
 */
export const aplicarErroresDeCampo = (
  mensajes: string[],
  setError: UseFormSetError<FormularioConsulta>,
): number => {
  let mapeados = 0;
  for (const mensaje of mensajes) {
    const m = mensaje.toLowerCase();
    if (m.includes('apellido')) {
      setError('apellidos', { message: mensaje });
    } else if (m.includes('nombre')) {
      setError('nombre', { message: mensaje });
    } else if (m.includes('email') || m.includes('correo')) {
      setError('email', { message: mensaje });
    } else if (m.includes('tel')) {
      setError('telefono', { message: mensaje });
    } else if (m.includes('canal')) {
      setError('canalEntrada', { message: mensaje });
    } else if (m.includes('fecha')) {
      setError('fechaEvento', { message: mensaje });
    } else {
      continue;
    }
    mapeados += 1;
  }
  return mapeados;
};
