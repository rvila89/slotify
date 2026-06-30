/** Par etiqueta/valor para el detalle de la ficha de consulta. */
export const Dato = ({ etiqueta, valor }: { etiqueta: string; valor: string }) => (
  <div className="flex flex-col gap-1">
    <dt className="font-body text-xs font-medium tracking-[0.48px] text-text-secondary">
      {etiqueta}
    </dt>
    <dd className="font-body text-base text-text-primary">{valor}</dd>
  </div>
);
