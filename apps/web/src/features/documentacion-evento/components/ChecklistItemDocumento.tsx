import { useRef, useState } from 'react';
import { CheckCircle2, Circle, Loader2, Paperclip, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSubirDocumentoEvento } from '../api/useSubirDocumentoEvento';
import {
  AYUDA_TIPO,
  ETIQUETA_TIPO,
  acceptPorTipo,
  formatearTamano,
  validarDocumento,
} from '../lib/fichero';
import { CLASE_BOTON_RESUBIR, CLASE_BOTON_SUBIR } from '../lib/estilos';
import { AvisoErrorDocumentacion } from './AvisoErrorDocumentacion';
import type {
  ChecklistItemDocumentacionEvento,
  SubirDocumentoEventoError,
  TipoDocumentoEvento,
} from '../model/types';

/**
 * Fila del checklist de documentación del evento (US-033 · UC-24) para un tipo
 * obligatorio. Muestra su estado (✅ completado / pendiente), el documento de
 * referencia si existe (N3) y la acción de subida por ítem.
 *
 * La captura desde móvil se ofrece con `<input type="file" capture="environment">`
 * para las fotos de DNI (cámara trasera); la cláusula admite también PDF. La
 * validación de formato/tamaño se hace en cliente ANTES de enviar (JPEG/PNG/PDF);
 * la autoritativa es el servidor (422). Permite re-subir un tipo ya completado
 * (histórico preservado en backend).
 *
 * Diseño: no hay frame propio en el archivo Figma "Slotify" para esta pantalla; se
 * ADAPTA con los tokens del proyecto (`index.css` + `DESIGN.md`), reutilizando el
 * tratamiento visual de la subida de justificante (US-021) y de la tarjeta de
 * condiciones firmadas (US-024). Mobile-first: la fila apila en `<sm`, la acción
 * pasa a fila en `sm:`; objetivos táctiles ≥ 48px; sin overflow horizontal.
 */
type Props = {
  reservaId: string;
  tipo: TipoDocumentoEvento;
  item: ChecklistItemDocumentacionEvento | undefined;
  /** `false` cuando la reserva ya no admite subida (p. ej. `post_evento`): solo lectura. */
  puedeSubir: boolean;
};

export const ChecklistItemDocumento = ({ reservaId, tipo, item, puedeSubir }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [errorCliente, setErrorCliente] = useState<string | null>(null);
  const subir = useSubirDocumentoEvento();
  const completado = item?.completado ?? false;
  const documento = item?.documento ?? null;

  const errorServidor: SubirDocumentoEventoError | null = subir.error ?? null;

  const onCambioFichero = (event: React.ChangeEvent<HTMLInputElement>) => {
    setErrorCliente(null);
    subir.reset();
    const fichero = event.target.files?.[0] ?? null;
    if (!fichero) return;

    const mensaje = validarDocumento(fichero, tipo);
    if (mensaje) {
      setErrorCliente(mensaje);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    subir.mutate({ id: reservaId, tipo, archivo: fichero });
    if (inputRef.current) inputRef.current.value = '';
  };

  const inputId = `documento-evento-${tipo}`;

  return (
    <li
      data-testid={`checklist-item-${tipo}`}
      data-completado={completado ? 'true' : 'false'}
      className="flex flex-col gap-4 rounded-[16px] border border-border-default/30 bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <div className="flex min-w-0 items-start gap-3">
        {completado ? (
          <CheckCircle2
            aria-hidden
            data-testid={`estado-${tipo}-completado`}
            className="mt-0.5 size-6 shrink-0 text-emerald-600"
          />
        ) : (
          <Circle
            aria-hidden
            data-testid={`estado-${tipo}-pendiente`}
            className="mt-0.5 size-6 shrink-0 text-text-secondary/50"
          />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-body text-sm font-semibold text-text-primary">{ETIQUETA_TIPO[tipo]}</p>
          <p className="font-body text-xs text-text-secondary">
            {completado ? (
              <span data-testid={`etiqueta-${tipo}-completado`}>
                Documento registrado.
                {documento && (
                  <>
                    {' '}
                    <a
                      href={documento.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-brand-primary underline underline-offset-2"
                    >
                      <Paperclip aria-hidden className="size-3.5" />
                      <span className="truncate">{documento.nombreArchivo}</span>
                    </a>
                    <span className="text-text-secondary/80"> ({formatearTamano(documento.tamanoBytes)})</span>
                  </>
                )}
              </span>
            ) : (
              AYUDA_TIPO[tipo]
            )}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 sm:items-end">
        {puedeSubir && (
          <>
            <label
              htmlFor={inputId}
              className={cn(completado ? CLASE_BOTON_RESUBIR : CLASE_BOTON_SUBIR)}
              aria-disabled={subir.isPending ? 'true' : undefined}
            >
              {subir.isPending ? (
                <>
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  Subiendo…
                </>
              ) : (
                <>
                  <Upload aria-hidden className="size-4" />
                  {completado ? 'Volver a subir' : 'Subir documento'}
                </>
              )}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={acceptPorTipo(tipo)}
              // Fotos de DNI: en móvil abre la cámara trasera. La cláusula no fuerza
              // captura (suele ser un PDF/escaneo desde el sistema de archivos).
              {...(tipo === 'clausula_responsabilidad' ? {} : { capture: 'environment' as const })}
              disabled={subir.isPending}
              onChange={onCambioFichero}
              data-testid={`input-${tipo}`}
              className="sr-only"
            />
          </>
        )}
      </div>

      {(errorCliente || errorServidor) && (
        <div className="sm:basis-full">
          {errorCliente ? (
            <p
              role="alert"
              data-testid={`error-cliente-${tipo}`}
              className="rounded-[12px] border border-red-200 bg-red-50 px-3 py-2 font-body text-[13px] text-red-700"
            >
              {errorCliente}
            </p>
          ) : (
            errorServidor && <AvisoErrorDocumentacion error={errorServidor} />
          )}
        </div>
      )}
    </li>
  );
};
