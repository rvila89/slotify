-- Change ficha-operativa-campos-operativos:
--   Añade los campos operativos `contacto_evento_correo`, `hora_llegada` y `duracion`
--   a la tabla `ficha_operativa`. Las columnas legacy `menu_seleccionado` y
--   `timing_detallado` PERMANECEN (soft-remove del contrato, no se hace DROP).
ALTER TABLE "ficha_operativa" ADD COLUMN "contacto_evento_correo" TEXT;
ALTER TABLE "ficha_operativa" ADD COLUMN "hora_llegada" TEXT;
ALTER TABLE "ficha_operativa" ADD COLUMN "duracion" TEXT;
