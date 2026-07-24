import { FileText, Mail } from 'lucide-react';
import { DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { claseBotonPrimario, claseBotonSecundario } from '../lib/estilos';

/**
 * Pie del diálogo "Generar presupuesto": "Solicitar datos al cliente" (solo con datos
 * fiscales incompletos), "Cancelar" y "Confirmar presupuesto". Extraído de
 * `GenerarPresupuestoDialog` para mantenerlo ≤300 líneas (regla dura `max-lines`).
 *
 * Mobile-first: en `<sm` los botones se apilan a ancho completo (sin overflow); en `sm+`
 * se alinean en fila con "Solicitar datos" a la izquierda (`sm:mr-auto`) y las acciones
 * del presupuesto a la derecha. Táctiles ≥ 44px (los `clase*` fijan `h-12`).
 */
type Props = {
  /** Muestra el botón "Solicitar datos al cliente" (datos fiscales incompletos). */
  datosIncompletos: boolean;
  solicitando: boolean;
  onSolicitarDatos: () => void;
  onCancelar: () => void;
  confirmando: boolean;
  confirmarDeshabilitado: boolean;
};

export const PresupuestoDialogFooter = ({
  datosIncompletos,
  solicitando,
  onSolicitarDatos,
  onCancelar,
  confirmando,
  confirmarDeshabilitado,
}: Props) => (
  <DialogFooter className="flex-col gap-2 sm:flex-row">
    {datosIncompletos && (
      <button
        type="button"
        onClick={onSolicitarDatos}
        disabled={solicitando || confirmando}
        data-testid="solicitar-datos-cliente"
        className={cn(claseBotonSecundario, 'w-full sm:mr-auto sm:w-auto')}
      >
        <Mail aria-hidden className="size-5" />
        {solicitando ? 'Solicitando…' : 'Solicitar datos al cliente'}
      </button>
    )}
    <button
      type="button"
      onClick={onCancelar}
      disabled={confirmando}
      data-testid="cancelar-presupuesto"
      className={cn(claseBotonSecundario, 'w-full sm:w-auto')}
    >
      Cancelar
    </button>
    <button
      type="submit"
      disabled={confirmarDeshabilitado}
      data-testid="confirmar-presupuesto"
      className={cn(claseBotonPrimario, 'w-full sm:w-auto')}
    >
      <FileText aria-hidden className="size-5" />
      {confirmando ? 'Confirmando…' : 'Confirmar presupuesto'}
    </button>
  </DialogFooter>
);
