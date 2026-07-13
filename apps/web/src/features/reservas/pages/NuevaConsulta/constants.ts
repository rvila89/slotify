import type { CanalEntrada, TipoEvento } from '../../model/types';

export const CANALES: { value: CanalEntrada; label: string }[] = [
  { value: 'web', label: 'Web' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'telefono', label: 'Teléfono' },
  { value: 'cocopool', label: 'Cocopool' },
  { value: 'holaplace', label: 'HolaPlace' },
];

export const TIPOS: { value: TipoEvento; label: string }[] = [
  { value: 'boda', label: 'Boda' },
  { value: 'corporativo', label: 'Corporativo' },
  { value: 'privado', label: 'Privado' },
  { value: 'cumpleanos', label: 'Cumpleaños' },
  { value: 'otro', label: 'Otro' },
];

export const DURACIONES = ['4', '8', '12'] as const;

export const CANAL_VALUES = CANALES.map((c) => c.value) as CanalEntrada[];

// RFC 5322 básico, alineado al `pattern` del contrato (local@dominio.tld).
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
