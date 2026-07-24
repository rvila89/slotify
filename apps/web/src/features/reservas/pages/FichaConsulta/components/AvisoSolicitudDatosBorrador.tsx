import { MailCheck, X } from 'lucide-react';

/**
 * Aviso de éxito tras dejar EN BORRADOR la solicitud de datos fiscales al cliente desde el
 * modal de presupuesto (change solicitud-datos-presupuesto-borrador). Se muestra arriba de
 * la ficha con scroll al inicio, siguiendo el mismo patrón que `AvisoFacturaSenalEnviada`.
 * El borrador aparece en la sección Comunicaciones para revisarlo y enviarlo. Cerrable.
 */
export const AvisoSolicitudDatosBorrador = ({ onCerrar }: { onCerrar: () => void }) => (
  <div
    role="status"
    data-testid="aviso-solicitud-datos-borrador"
    className="flex items-start gap-3 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
  >
    <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-emerald-600" />
    <div className="flex-1">
      <p className="font-body text-sm font-bold">Solicitud de datos creada</p>
      <p className="font-body text-sm">
        Borrador de solicitud de datos creado en Comunicaciones. Revísalo y envíalo cuando
        quieras.
      </p>
    </div>
    <button
      type="button"
      aria-label="Cerrar aviso"
      onClick={onCerrar}
      className="rounded-full p-1 text-emerald-700 transition hover:bg-emerald-100"
    >
      <X aria-hidden className="size-4" />
    </button>
  </div>
);
