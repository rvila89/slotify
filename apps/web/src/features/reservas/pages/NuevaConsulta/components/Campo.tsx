import { cn } from '@/lib/utils';
import { claseLabel } from '../styles';

/** Envoltorio de campo de formulario: label + slot de control + mensaje de error. */
export const Campo = ({
  id,
  label,
  opcional,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  opcional?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('flex flex-col gap-2', className)}>
    <label htmlFor={id} className={claseLabel}>
      {label}
      {opcional && <span className="ml-1 font-normal text-text-muted">(opcional)</span>}
    </label>
    {children}
    {error && (
      <p id={`${id}-error`} role="alert" className="px-1 font-body text-[13px] text-red-600">
        {error}
      </p>
    )}
  </div>
);
