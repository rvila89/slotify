import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combina clases condicionales y resuelve conflictos de Tailwind (shadcn/ui). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
