/**
 * Franjas horarias de inicio de evento (09:00–23:30 en pasos de 30 min). Espejo
 * del selector ya usado en `SeccionEvento`/`ProgramarVisitaDialog`; centralizado
 * en `lib/` (regla dura: `components/` aloja SOLO `.tsx`).
 */
export const HORARIOS: readonly string[] = Array.from({ length: 30 }, (_, i) => {
  const min = 9 * 60 + i * 30;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
});
