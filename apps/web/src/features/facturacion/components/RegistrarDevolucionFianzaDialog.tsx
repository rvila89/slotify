import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { hoyISO } from '../lib/fecha';
import { validarJustificante } from '../lib/justificante';
import { derivarResultadoDevolucion, esDevolucionParcial } from '../lib/devolucionFianza';
import { useRegistrarDevolucionFianza } from '../api/useRegistrarDevolucionFianza';
import { useSubirJustificante } from '../api/useSubirJustificante';
import { normalizarErrorDevolucionFianza } from '../api/normalizarErrorDevolucionFianza';
import { AvisoErrorDevolucionFianza } from './AvisoErrorDevolucionFianza';
import { ConfirmacionDevolucionFianza } from './ConfirmacionDevolucionFianza';
import { DevolucionFianzaFormFields } from './DevolucionFianzaFormFields';
import { aImporte, construirEsquemaDevolucion, type FormularioDevolucion } from '../lib/devolucionFianzaSchema';
import type { DevolucionFianzaError, RegistrarDevolucionFianzaResponse } from '../model/types';

/**
 * Diálogo de **registro de la devolución de fianza** (US-036 · UC-27). Acción simétrica inversa del
 * cobro de fianza (US-030): el Gestor registra la transferencia de devolución que realizó fuera de
 * Slotify, indicando `importeDevuelto`, `fechaCobro`, `motivoRetencion` (si es parcial) y —opcional
 * (FA-04)— adjuntando el justificante.
 *
 * Justificante en dos pasos (G1-3, alineado con US-030): el fichero se sube primero por
 * `POST /documentos` (multipart), y su `idDocumento` se pasa como `justificanteDocId` en el body
 * JSON de `POST /reservas/{id}/fianza/devolucion`. Este endpoint NO recibe multipart.
 *
 * Flujo: formulario → confirmación irreversible (resumen) → sube justificante (si hay) → registra.
 * En tiempo real muestra si la devolución será completa (`devuelta`) o parcial (`retenida_parcial`).
 * Validación en cliente (RHF + Zod) reflejando FA-02 (importe ≤ fianzaEur) y FA-03 (fecha ≥
 * fianzaCobradaFecha); el backend revalida y es la fuente de verdad.
 *
 * Diseño: sin frame propio en el archivo Figma "Slotify" (solo contiene los frames de Login); se
 * ADAPTA con los tokens del proyecto reutilizando el tratamiento del diálogo de cobro de US-030.
 * `Dialog` (shadcn/Radix) mobile-first: los campos apilan en columna y el pie pasa a fila en `sm:`;
 * objetivos táctiles ≥ 48px; sin overflow horizontal.
 */
type Props = {
  reservaId: string;
  /** Fianza cobrada (`RESERVA.fianzaEur`) — tope del importe (FA-02) e indicador completa/parcial. */
  fianzaEur?: string | null;
  /** Fecha de cobro de la fianza (`RESERVA.fianzaCobradaFecha`) — mínimo de la fecha de devolución (FA-03). */
  fianzaCobradaFecha?: string | null;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se invoca con la respuesta tras un registro efectivo (200). */
  onRegistrado?: (resultado: RegistrarDevolucionFianzaResponse) => void;
};

const claseBotonPrimario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-8 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

const claseBotonSecundario =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-default bg-canvas px-8 font-body text-base font-medium text-text-secondary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto';

type DatosConfirmados = {
  importeDevuelto: string;
  fechaCobro: string;
  motivoRetencion?: string;
};

export const RegistrarDevolucionFianzaDialog = ({
  reservaId,
  fianzaEur,
  fianzaCobradaFecha,
  abierto,
  onAbiertoChange,
  onRegistrado,
}: Props) => {
  const esquema = useMemo(
    () => construirEsquemaDevolucion(fianzaEur, fianzaCobradaFecha),
    [fianzaEur, fianzaCobradaFecha],
  );

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormularioDevolucion>({
    resolver: zodResolver(esquema),
    defaultValues: { importeDevuelto: '', fechaCobro: hoyISO(), motivoRetencion: '' },
  });

  const inputFicheroRef = useRef<HTMLInputElement>(null);
  const [fichero, setFichero] = useState<File | null>(null);
  const [errorFichero, setErrorFichero] = useState<string | null>(null);
  // Datos validados que pasan al paso de confirmación; null = mostrando el formulario.
  const [confirmando, setConfirmando] = useState<DatosConfirmados | null>(null);
  const [errorRegistro, setErrorRegistro] = useState<DevolucionFianzaError | null>(null);

  const subir = useSubirJustificante();
  const registrar = useRegistrarDevolucionFianza();
  const pendiente = subir.isPending || registrar.isPending;

  const importeActual = watch('importeDevuelto');
  const importeNormalizado = importeActual ? aImporte(importeActual) : '';
  const resultado = useMemo(
    () => derivarResultadoDevolucion(importeNormalizado, fianzaEur),
    [importeNormalizado, fianzaEur],
  );
  const mostrarMotivo = esDevolucionParcial(importeNormalizado, fianzaEur);

  useEffect(() => {
    if (!abierto) {
      reset({ importeDevuelto: '', fechaCobro: hoyISO(), motivoRetencion: '' });
      setFichero(null);
      setErrorFichero(null);
      setConfirmando(null);
      setErrorRegistro(null);
      subir.reset();
      registrar.reset();
      if (inputFicheroRef.current) inputFicheroRef.current.value = '';
    }
    // Solo debe re-ejecutarse al abrir/cerrar; reset/mutations son estables por referencia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const onCambioFichero = (event: React.ChangeEvent<HTMLInputElement>) => {
    const seleccionado = event.target.files?.[0] ?? null;
    const mensaje = validarJustificante(seleccionado);
    if (mensaje) {
      setFichero(null);
      setErrorFichero(mensaje);
      return;
    }
    setErrorFichero(null);
    setFichero(seleccionado);
  };

  const irAConfirmacion = handleSubmit(({ importeDevuelto, fechaCobro, motivoRetencion }) => {
    if (errorFichero) return;
    setErrorRegistro(null);
    setConfirmando({
      importeDevuelto: aImporte(importeDevuelto),
      fechaCobro,
      ...(motivoRetencion?.trim() ? { motivoRetencion: motivoRetencion.trim() } : {}),
    });
  });

  const registrarDevolucion = async () => {
    if (!confirmando) return;
    setErrorRegistro(null);

    let justificanteDocId: string | undefined;
    if (fichero) {
      try {
        const documento = await subir.mutateAsync({ fichero, reservaId });
        justificanteDocId = documento.idDocumento;
      } catch (error) {
        setErrorRegistro(normalizarErrorDevolucionFianza(undefined, error));
        return;
      }
    }

    registrar.mutate(
      { reservaId, ...confirmando, ...(justificanteDocId ? { justificanteDocId } : {}) },
      {
        onSuccess: (respuesta) => {
          onRegistrado?.(respuesta);
          onAbiertoChange(false);
        },
        onError: (error) => setErrorRegistro(error),
      },
    );
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent
        data-testid="dialog-registrar-devolucion-fianza"
        className="max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Registrar devolución de fianza</DialogTitle>
          <DialogDescription>
            Registra la transferencia de devolución que ya has realizado al cliente. Indica el
            importe y la fecha reales del abono; el justificante es opcional.
          </DialogDescription>
        </DialogHeader>

        {confirmando ? (
          <ConfirmacionDevolucionFianza
            importe={confirmando.importeDevuelto}
            fechaCobro={confirmando.fechaCobro}
            resultado={resultado ?? 'retenida_parcial'}
            motivoRetencion={confirmando.motivoRetencion}
            nombreJustificante={fichero?.name ?? null}
            error={errorRegistro}
            pendiente={pendiente}
            onCancelar={() => setConfirmando(null)}
            onConfirmar={registrarDevolucion}
          />
        ) : (
          <form onSubmit={irAConfirmacion} noValidate className="flex flex-col gap-5">
            {errorRegistro && <AvisoErrorDevolucionFianza error={errorRegistro} />}

            <DevolucionFianzaFormFields
              register={register}
              errors={errors}
              pendiente={pendiente}
              fianzaEur={fianzaEur}
              fianzaCobradaFecha={fianzaCobradaFecha}
              resultado={resultado}
              mostrarMotivo={mostrarMotivo}
              inputFicheroRef={inputFicheroRef}
              fichero={fichero}
              errorFichero={errorFichero}
              onCambioFichero={onCambioFichero}
            />

            <DialogFooter className="flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => onAbiertoChange(false)}
                disabled={pendiente}
                data-testid="cancelar-devolucion-fianza"
                className={claseBotonSecundario}
              >
                <X aria-hidden className="size-5" />
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pendiente || Boolean(errorFichero)}
                data-testid="continuar-devolucion-fianza"
                className={claseBotonPrimario}
              >
                <Banknote aria-hidden className="size-5" />
                Revisar y confirmar
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
