-- Épico #6, rebanada 6.4a (documentos-condiciones-particulares-pdf): columna JSON
-- "condiciones" en plantilla_documento_tenant para las "Condicions particulars"
-- ({ titulo, secciones: [{ titulo, cuerpo }] }).
--
-- Estrategia D2 (no destructiva): NOT NULL con DEFAULT '{}' para no romper las filas
-- existentes ni los create. El piloto se rellena con el texto real vía reseed
-- (construirConfiguracionDocumentoPiloto).

ALTER TABLE "plantilla_documento_tenant" ADD COLUMN "condiciones" JSONB NOT NULL DEFAULT '{}';
