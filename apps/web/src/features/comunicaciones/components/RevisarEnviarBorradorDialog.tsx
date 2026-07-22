import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Send, X } from 'lucide-react';
import { notify } from '@/lib/notify';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useEnviarBorrador } from '../api/useEnviarBorrador';
import { esquemaEnviarBorrador, type FormularioEnviarBorrador } from '../lib/schema';
import { etiquetaCodigoEmail } from '../lib/estado';
import { AvisoErrorComunicacion } from './AvisoErrorComunicacion';
import type { ComunicacionListItem } from '../model/types';

/**
 * Convierte HTML del catálogo de plantillas a texto plano editable.
 * Invierte `textoPlanoAHtml` + `htmlEscape` del backend para que el gestor vea y edite
 * contenido legible en el textarea. Al enviar, el backend detecta texto plano
 * (heurística `contieneMarcadoHtml`) y lo re-convierte a HTML para el cliente de correo.
 *
 * Equivalencia: `<p>pár1<br>línea2</p><p>pár2</p>` → `"pár1\nlínea2\n\npár2"`
 */
const htmlATextoPlano = (html: string): string => {
  if (!html.trimStart().startsWith('<')) return html; // ya es texto plano
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
};

/**
 * Diálogo "Revisar y enviar borrador" (US-046 · UC-36). Muestra el borrador
 * (`codigoEmail` y `destinatarioEmail` en SOLO LECTURA) y permite EDITAR opcionalmente
 * `asunto` y `cuerpo` (React Hook Form + Zod, regla dura). Al confirmar envía por el
 * SDK generado; lo persistido refleja lo efectivamente enviado.
 *
 * Errores del contrato (design.md §D-2), inline:
 *  - 422 destinatario inválido → aviso recuperable (ámbar); el borrador permanece.
 *  - 409 conflicto de estado → aviso + toast (ya enviado/descartado); la lista se refresca.
 *  - 502 fallo del proveedor → aviso; la fila queda `fallido`, reintentable.
 *
 * Diseño: sin frame propio en Figma "Slotify"; se ADAPTA con los tokens del proyecto,
 * reutilizando el patrón de diálogos de la app. Mobile-first (pie apila en `<sm`).
 */
type Props = {
  reservaId: string;
  borrador: ComunicacionListItem | null;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /**
   * Se invoca tras enviar el borrador con éxito. La ficha lo usa para mostrar el aviso
   * de éxito arriba y hacer scroll, replicando la UX del E1 automático
   * (mejoras-detalle-consulta §D-3). Si se omite, no hay aviso en la página.
   */
  onEnviado?: () => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseInput =
  'w-full rounded-[16px] border bg-canvas px-4 py-3 font-body text-sm text-text-primary transition placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-brand-primary';

export const RevisarEnviarBorradorDialog = ({
  reservaId,
  borrador,
  abierto,
  onAbiertoChange,
  onEnviado,
}: Props) => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormularioEnviarBorrador>({
    resolver: zodResolver(esquemaEnviarBorrador),
    defaultValues: { asunto: '', cuerpo: '' },
  });

  const enviar = useEnviarBorrador();
  const { reset: resetEnviar } = enviar;

  // Al abrir con un borrador, precarga sus valores actuales para revisar/editar.
  // Si el cuerpo almacenado es HTML del catálogo, se convierte a texto plano para
  // que el gestor vea y edite contenido legible sin etiquetas. Al enviar, el backend
  // detecta texto plano (heurística `contieneMarcadoHtml`) y lo re-convierte a HTML.
  useEffect(() => {
    if (abierto && borrador) {
      reset({ asunto: borrador.asunto ?? '', cuerpo: htmlATextoPlano(borrador.cuerpo ?? '') });
    }
    if (!abierto) {
      resetEnviar();
      reset({ asunto: '', cuerpo: '' });
    }
  }, [abierto, borrador, reset, resetEnviar]);

  if (!borrador) return null;

  const onSubmit = handleSubmit(({ asunto, cuerpo }) => {
    enviar.mutate(
      { reservaId, idComunicacion: borrador.idComunicacion, asunto, cuerpo },
      {
        onSuccess: () => {
          // El aviso de éxito lo muestra la ficha arriba (con scroll), replicando la UX
          // del E1 automático; por eso aquí no se usa toast (mejoras-detalle-consulta §D-3).
          onAbiertoChange(false);
          onEnviado?.();
        },
        onError: (err) => {
          // El conflicto de estado ya invalidó la lista; se avisa y se cierra.
          if (err.tipo === 'conflicto') {
            notify.info(err.mensaje);
            onAbiertoChange(false);
          }
        },
      },
    );
  });

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-revisar-borrador"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Revisar y enviar borrador</DialogTitle>
          <DialogDescription>
            Revisa el contenido y edítalo si es necesario antes de enviarlo al cliente. El
            destinatario y el tipo de email no son editables.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {enviar.error && (
            <AvisoErrorComunicacion
              mensaje={enviar.error.mensaje}
              recuperable={enviar.error.tipo === 'destinatario'}
              testId="aviso-error-enviar-borrador"
            />
          )}

          {/* Solo lectura: tipo de email + destinatario (no editables por el gestor). */}
          <dl className="grid grid-cols-1 gap-3 rounded-[16px] border border-border-default/40 bg-surface-muted/30 p-4 sm:grid-cols-2">
            <div className="flex flex-col">
              <dt className="font-body text-xs text-text-secondary">Tipo de email</dt>
              <dd className="font-body text-sm font-medium text-text-primary">
                {etiquetaCodigoEmail(borrador.codigoEmail)}
              </dd>
            </div>
            <div className="flex min-w-0 flex-col">
              <dt className="font-body text-xs text-text-secondary">Destinatario</dt>
              <dd
                data-testid="revisar-destinatario"
                className="break-words font-body text-sm font-medium text-text-primary"
              >
                {borrador.destinatarioEmail ?? 'Sin email registrado'}
              </dd>
            </div>
          </dl>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="revisar-borrador-asunto"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Asunto
            </label>
            <input
              id="revisar-borrador-asunto"
              type="text"
              disabled={enviar.isPending}
              data-testid="input-asunto-borrador"
              aria-invalid={errors.asunto ? 'true' : undefined}
              aria-describedby={errors.asunto ? 'revisar-borrador-asunto-error' : undefined}
              className={cn(claseInput, errors.asunto ? 'border-red-400' : 'border-border-default')}
              {...register('asunto')}
            />
            {errors.asunto && (
              <p
                id="revisar-borrador-asunto-error"
                role="alert"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.asunto.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="revisar-borrador-cuerpo"
              className="px-1 font-body text-xs font-medium tracking-[0.48px] text-text-secondary"
            >
              Cuerpo del email
            </label>
            <textarea
              id="revisar-borrador-cuerpo"
              rows={8}
              disabled={enviar.isPending}
              data-testid="input-cuerpo-borrador"
              aria-invalid={errors.cuerpo ? 'true' : undefined}
              aria-describedby={errors.cuerpo ? 'revisar-borrador-cuerpo-error' : undefined}
              className={cn(
                claseInput,
                'resize-y',
                errors.cuerpo ? 'border-red-400' : 'border-border-default',
              )}
              {...register('cuerpo')}
            />
            {errors.cuerpo && (
              <p
                id="revisar-borrador-cuerpo-error"
                role="alert"
                className="px-1 font-body text-[13px] text-red-600"
              >
                {errors.cuerpo.message}
              </p>
            )}
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => onAbiertoChange(false)}
              disabled={enviar.isPending}
              data-testid="cancelar-revisar-borrador"
              className={claseBotonSecundario}
            >
              <X aria-hidden className="size-5" />
              Cancelar
            </button>
            <button
              type="submit"
              disabled={enviar.isPending}
              data-testid="confirmar-enviar-borrador"
              className={claseBotonPrimario}
            >
              <Send aria-hidden className="size-5" />
              {enviar.isPending ? 'Enviando…' : 'Enviar email'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
