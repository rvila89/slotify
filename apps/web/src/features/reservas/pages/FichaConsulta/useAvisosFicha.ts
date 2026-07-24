import { useCallback, useState } from 'react';
import type { ConfirmarPresupuestoResponse } from '@/features/presupuestos';
import type { ConfirmarSenalResponse } from '@/features/confirmacion';
import type { PendienteInvitadosResultado, Reserva } from '../../model/types';
import type { ResultadoEdicion } from './components/AvisosEdicionPresupuesto';
import type { components } from '@/api-client';

type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];
type ForzarInicioEventoResponse = components['schemas']['ForzarInicioEventoResponse'];

/** Desenlace terminal de descarte (consulta US-013 / pre-reserva). */
type Descarte = { reserva: Reserva; tipo: 'consulta' | 'prereserva' };

/**
 * Centraliza el estado de TODOS los avisos de desenlace de la Ficha de consulta y
 * garantiza el INVARIANTE de "como máximo un aviso visible a la vez (el último)":
 * cada `mostrarX` limpia los demás antes de fijar el suyo; `cerrar()` los limpia todos.
 *
 * Antes, `FichaConsultaPage` tenía ~14 estados independientes y `AvisosFicha` pintaba
 * cada uno si no era null, así que podían coexistir. El invariante vive aquí (change
 * `2026-07-20-descarte-aviso-inline-ficha`).
 */
export const useAvisosFicha = () => {
  const [resultado, setResultado] = useState<Reserva | null>(null);
  const [invitados, setInvitados] = useState<PendienteInvitadosResultado | null>(null);
  const [visita, setVisita] = useState<Reserva | null>(null);
  const [interesado, setInteresado] = useState<Reserva | null>(null);
  const [reservaInmediata, setReservaInmediata] = useState<Reserva | null>(null);
  const [extension, setExtension] = useState<Reserva | null>(null);
  const [presupuesto, setPresupuesto] = useState<ConfirmarPresupuestoResponse | null>(null);
  const [edicion, setEdicion] = useState<ResultadoEdicion | null>(null);
  const [senal, setSenal] = useState<ConfirmarSenalResponse | null>(null);
  const [forzar, setForzar] = useState<ForzarInicioEventoResponse | null>(null);
  const [finalizar, setFinalizar] = useState<FinalizarEventoResponse | null>(null);
  const [descarte, setDescarte] = useState<Descarte | null>(null);
  const [emailEnviado, setEmailEnviado] = useState(false);
  const [firma, setFirma] = useState<'registrada' | 'reregistrada' | null>(null);
  /** Código de la reserva editada (banner emerald tras editar campos simples). */
  const [edicionConsulta, setEdicionConsulta] = useState<string | null>(null);
  /** Factura de señal enviada exitosamente (E3 inicial): banner arriba de la ficha. */
  const [facturaEnviada, setFacturaEnviada] = useState(false);
  /** Borrador de solicitud de datos fiscales creado (change
      solicitud-datos-presupuesto-borrador): banner arriba de la ficha. */
  const [solicitudDatos, setSolicitudDatos] = useState(false);

  // Limpia TODOS los avisos. Es la base del invariante: cada `mostrarX` la invoca
  // antes de fijar el suyo, de modo que solo el último queda no nulo.
  const cerrar = useCallback(() => {
    setResultado(null);
    setInvitados(null);
    setVisita(null);
    setInteresado(null);
    setReservaInmediata(null);
    setExtension(null);
    setPresupuesto(null);
    setEdicion(null);
    setSenal(null);
    setForzar(null);
    setFinalizar(null);
    setDescarte(null);
    setEmailEnviado(false);
    setFirma(null);
    setEdicionConsulta(null);
    setFacturaEnviada(false);
    setSolicitudDatos(false);
  }, []);

  const mostrarResultado = useCallback(
    (r: Reserva) => {
      cerrar();
      setResultado(r);
    },
    [cerrar],
  );
  const mostrarInvitados = useCallback(
    (r: PendienteInvitadosResultado) => {
      cerrar();
      setInvitados(r);
    },
    [cerrar],
  );
  const mostrarVisita = useCallback(
    (r: Reserva) => {
      cerrar();
      setVisita(r);
    },
    [cerrar],
  );
  const mostrarInteresado = useCallback(
    (r: Reserva) => {
      cerrar();
      setInteresado(r);
    },
    [cerrar],
  );
  const mostrarReservaInmediata = useCallback(
    (r: Reserva) => {
      cerrar();
      setReservaInmediata(r);
    },
    [cerrar],
  );
  const mostrarExtension = useCallback(
    (r: Reserva) => {
      cerrar();
      setExtension(r);
    },
    [cerrar],
  );
  const mostrarPresupuesto = useCallback(
    (r: ConfirmarPresupuestoResponse) => {
      cerrar();
      setPresupuesto(r);
    },
    [cerrar],
  );
  const mostrarEdicion = useCallback(
    (r: ResultadoEdicion) => {
      cerrar();
      setEdicion(r);
    },
    [cerrar],
  );
  const mostrarSenal = useCallback(
    (r: ConfirmarSenalResponse) => {
      cerrar();
      setSenal(r);
    },
    [cerrar],
  );
  const mostrarForzar = useCallback(
    (r: ForzarInicioEventoResponse) => {
      cerrar();
      setForzar(r);
    },
    [cerrar],
  );
  const mostrarFinalizar = useCallback(
    (r: FinalizarEventoResponse) => {
      cerrar();
      setFinalizar(r);
    },
    [cerrar],
  );
  const mostrarDescarte = useCallback(
    (d: Descarte) => {
      cerrar();
      setDescarte(d);
    },
    [cerrar],
  );
  const mostrarEmailEnviado = useCallback(() => {
    cerrar();
    setEmailEnviado(true);
  }, [cerrar]);
  const mostrarFirma = useCallback(
    (tipo: 'registrada' | 'reregistrada') => {
      cerrar();
      setFirma(tipo);
    },
    [cerrar],
  );
  const mostrarEdicionConsulta = useCallback(
    (codigo: string) => {
      cerrar();
      setEdicionConsulta(codigo);
    },
    [cerrar],
  );
  const mostrarFacturaSenalEnviada = useCallback(() => {
    cerrar();
    setFacturaEnviada(true);
  }, [cerrar]);
  const mostrarSolicitudDatosBorrador = useCallback(() => {
    cerrar();
    setSolicitudDatos(true);
  }, [cerrar]);

  return {
    resultado,
    invitados,
    visita,
    interesado,
    reservaInmediata,
    extension,
    presupuesto,
    edicion,
    senal,
    forzar,
    finalizar,
    descarte,
    emailEnviado,
    firma,
    edicionConsulta,
    mostrarResultado,
    mostrarInvitados,
    mostrarVisita,
    mostrarInteresado,
    mostrarReservaInmediata,
    mostrarExtension,
    mostrarPresupuesto,
    mostrarEdicion,
    mostrarSenal,
    mostrarForzar,
    mostrarFinalizar,
    mostrarDescarte,
    mostrarEmailEnviado,
    mostrarFirma,
    facturaEnviada,
    mostrarEdicionConsulta,
    mostrarFacturaSenalEnviada,
    solicitudDatos,
    mostrarSolicitudDatosBorrador,
    cerrar,
  };
};
