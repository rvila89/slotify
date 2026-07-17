import { Fragment } from 'react';
import { segmentosDestacados } from '../lib/destacar';

type Props = {
  texto: string;
  termino?: string;
};

/**
 * Renderiza un texto destacando las coincidencias del término buscado con
 * `<mark>` (D-2: el highlight es responsabilidad del frontend). Sin término, o
 * sin coincidencias, renderiza el texto tal cual. El resaltado es una ayuda
 * visual local sobre lo que el backend full-text ya filtró.
 */
export const TextoDestacado = ({ texto, termino }: Props) => (
  <>
    {segmentosDestacados(texto, termino).map((seg, i) =>
      seg.match ? (
        <mark key={i} className="rounded bg-state-confirmada/30 px-0.5 text-text-primary">
          {seg.texto}
        </mark>
      ) : (
        <Fragment key={i}>{seg.texto}</Fragment>
      ),
    )}
  </>
);
