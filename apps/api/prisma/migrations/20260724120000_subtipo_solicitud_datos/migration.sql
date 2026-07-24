-- Migración aditiva (change solicitud-datos-presupuesto-borrador): nuevo valor del enum
-- `SubtipoEmail` para el E1 que solicita al cliente los datos fiscales del presupuesto.
-- No destructiva: solo añade un valor al tipo enum existente.

-- AlterEnum
ALTER TYPE "SubtipoEmail" ADD VALUE 'solicitud_datos';
