import { describe, expect, it } from 'vitest';
import {
  aUpdateReservaRequest,
  valoresDeReserva,
  type FormularioEditarConsulta,
} from '../editarConsultaSchema';
import type { Reserva } from '../../model/types';

/**
 * US-051 §D-1: el editor de campos simples NUNCA emite `fechaEvento` en el body
 * del PATCH (la fecha se muta por el flujo atómico). El mapper omite los campos
 * vacíos para no pisar datos con `undefined`.
 */
const base: FormularioEditarConsulta = {
  tipoEvento: '',
  duracionHoras: '',
  numAdultosNinosMayores4: '',
  numNinosMenores4: '',
  numInvitadosFinal: '',
  horario: '',
  notas: '',
};

describe('aUpdateReservaRequest', () => {
  it('nunca_incluye_fechaEvento_en_el_body', () => {
    const body = aUpdateReservaRequest({ ...base, duracionHoras: '8', horario: '11:00' });
    expect('fechaEvento' in body).toBe(false);
  });

  it('convierte_duracion_y_numeros_a_number', () => {
    const body = aUpdateReservaRequest({
      ...base,
      duracionHoras: '8',
      numAdultosNinosMayores4: '30',
      numNinosMenores4: '5',
      numInvitadosFinal: '35',
      horario: '11:00',
    });
    expect(body.duracionHoras).toBe(8);
    expect(body.numAdultosNinosMayores4).toBe(30);
    expect(body.numNinosMenores4).toBe(5);
    expect(body.numInvitadosFinal).toBe(35);
    expect(body.horario).toBe('11:00');
  });

  it('omite_los_campos_opcionales_vacios', () => {
    const body = aUpdateReservaRequest(base);
    expect('duracionHoras' in body).toBe(false);
    expect('numAdultosNinosMayores4' in body).toBe(false);
    expect('horario' in body).toBe(false);
    expect('tipoEvento' in body).toBe(false);
  });

  it('siempre_envia_notas_para_permitir_limpiarlas', () => {
    expect(aUpdateReservaRequest(base).notas).toBe('');
    expect(aUpdateReservaRequest({ ...base, notas: 'jardín' }).notas).toBe('jardín');
  });
});

describe('valoresDeReserva', () => {
  it('deriva_los_valores_iniciales_de_la_reserva', () => {
    const reserva = {
      tipoEvento: 'boda',
      duracionHoras: 12,
      numAdultosNinosMayores4: 40,
      numNinosMenores4: 2,
      numInvitadosFinal: null,
      horario: '10:00',
      notas: 'nota',
    } as Reserva;
    expect(valoresDeReserva(reserva)).toEqual({
      tipoEvento: 'boda',
      duracionHoras: '12',
      numAdultosNinosMayores4: '40',
      numNinosMenores4: '2',
      numInvitadosFinal: '',
      horario: '10:00',
      notas: 'nota',
    });
  });

  it('usa_vacios_para_los_ausentes', () => {
    expect(valoresDeReserva({} as Reserva)).toEqual({
      tipoEvento: '',
      duracionHoras: '',
      numAdultosNinosMayores4: '',
      numNinosMenores4: '',
      numInvitadosFinal: '',
      horario: '',
      notas: '',
    });
  });
});
