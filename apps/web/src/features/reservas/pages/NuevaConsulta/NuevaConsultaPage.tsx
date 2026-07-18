import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { esquema, valoresIniciales, type FormularioConsulta } from './schema';
import { SeccionCliente } from './components/SeccionCliente';
import { SeccionEvento } from './components/SeccionEvento';
import { AvisosResultado } from './components/AvisosResultado';
import { useCrearConsulta, type ErrorAlta } from '../../api/useCrearConsulta';
import { aplicarErroresDeCampo } from '../../lib/errores';
import type {
  CanalEntrada,
  CreateReservaRequest,
  DuracionHoras,
  ResultadoAlta,
  TipoEvento,
} from '../../model/types';

/**
 * Alta de consulta (US-003/US-004). Orquesta el formulario (RHF + Zod vía
 * `FormProvider`, las secciones leen el contexto), dispara la mutación de alta y
 * traduce el desenlace a avisos (2b/2d/2a/E1) y los errores 400 a campos. El
 * detalle visual vive en `components/`; el schema/constantes en archivos hermanos.
 */
export const NuevaConsultaPage = () => {
  const [errorApi, setErrorApi] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoAlta | null>(null);

  const methods = useForm<FormularioConsulta>({
    resolver: zodResolver(esquema),
    defaultValues: valoresIniciales,
  });
  const { handleSubmit, setError, reset } = methods;

  const mutation = useCrearConsulta();

  const onSubmit = handleSubmit((valores) => {
    setErrorApi(null);
    setResultado(null);

    const comentarios = valores.comentarios.trim();
    const fechaEvento = valores.fechaEvento.trim();
    const horario = valores.horario.trim();
    const body: CreateReservaRequest = {
      canalEntrada: valores.canalEntrada as CanalEntrada,
      cliente: {
        nombre: valores.nombre.trim(),
        apellidos: valores.apellidos.trim(),
        email: valores.email.trim(),
        telefono: valores.telefono.trim(),
      },
      ...(fechaEvento ? { fechaEvento } : {}),
      ...(comentarios ? { comentarios } : {}),
      ...(valores.tipoEvento ? { tipoEvento: valores.tipoEvento as TipoEvento } : {}),
      ...(valores.duracionHoras
        ? { duracionHoras: Number(valores.duracionHoras) as DuracionHoras }
        : {}),
      ...(valores.invitados ? { numAdultosNinosMayores4: Number(valores.invitados) } : {}),
      idioma: valores.idioma,
      ...(horario ? { horario } : {}),
    };

    mutation.mutate(
      { body, tieneComentarios: Boolean(comentarios), fechaEnviada: fechaEvento },
      {
        onSuccess: (reserva) => {
          setErrorApi(null);
          setResultado({
            reserva,
            tieneComentarios: Boolean(comentarios),
            conFecha: fechaEvento !== '',
            fechaEnviada: fechaEvento,
          });
          reset(valoresIniciales);
          if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        },
        onError: (err: ErrorAlta) => {
          setResultado(null);
          if (err.status === 400 && err.body) {
            const mensajes = Array.isArray(err.body.message) ? err.body.message : [err.body.message];
            const mapeados = aplicarErroresDeCampo(mensajes, setError);
            setErrorApi(mapeados === 0 ? mensajes.join(' ') : null);
          } else {
            setErrorApi('No se ha podido crear la consulta. Inténtalo de nuevo.');
          }
        },
      },
    );
  });

  const reserva = resultado?.reserva;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
          Nueva consulta
        </h1>
        <p className="font-body text-sm text-text-secondary sm:text-base">
          Registra un lead. Indica una fecha de evento para intentar reservarla, o déjala vacía para
          una consulta exploratoria sin fecha.
        </p>
      </header>

      {/* Enlace de conveniencia a la ficha del lead recién creado (`/reservas/:id`). */}
      {reserva && (
        <Link
          to={`/reservas/${reserva.idReserva}`}
          data-testid="enlace-ver-ficha"
          className={cn(
            'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px]',
            'border border-border-default bg-surface-muted px-4 py-3 font-body text-sm font-bold',
            'text-text-primary transition-colors hover:bg-surface-subtle sm:w-auto',
          )}
        >
          Ver ficha de la consulta {reserva.codigo}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      )}

      {resultado && <AvisosResultado resultado={resultado} onCerrar={() => setResultado(null)} />}

      {errorApi && (
        <div
          role="alert"
          data-testid="error-api"
          className="rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700"
        >
          {errorApi}
        </div>
      )}

      <FormProvider {...methods}>
        <form
          onSubmit={onSubmit}
          noValidate
          data-testid="form-nueva-consulta"
          className="flex flex-col gap-6 rounded-[24px] border border-border-default bg-white p-4 shadow-[0px_1px_2px_0px_rgba(141,77,57,0.05)] sm:p-6 lg:gap-10 lg:p-10"
        >
          <SeccionCliente />
          <SeccionEvento />

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-brand-primary px-10 font-display text-base text-brand-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:px-16"
            >
              {mutation.isPending ? 'Creando…' : 'Crear consulta'}
            </button>
          </div>
        </form>
      </FormProvider>
    </div>
  );
};
