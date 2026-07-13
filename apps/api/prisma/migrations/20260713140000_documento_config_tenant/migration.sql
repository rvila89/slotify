-- Épico #6, rebanada 6.1a (documentos-config-tenant-storage): tabla de configuración de
-- documento por tenant. Relación 1-1 con Tenant (tenant_id UNIQUE + FK), PK uuid. Guarda
-- su propia copia de los datos fiscales (decisión A1): NO se tocan Tenant.nombre/nif/direccion.
-- RLS habilitada con la misma política que el resto de tablas de negocio
-- (current_setting('app.tenant_id')).

-- 1) Tabla.
CREATE TABLE "plantilla_documento_tenant" (
    "id_plantilla" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "logo_url" TEXT,
    "color_primario" TEXT NOT NULL,
    "color_texto" TEXT NOT NULL,
    "razon_social_fiscal" TEXT NOT NULL,
    "nombre_comercial" TEXT NOT NULL,
    "nif" TEXT NOT NULL,
    "direccion_fiscal" TEXT NOT NULL,
    "web" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "beneficiario_transferencia" TEXT NOT NULL,
    "concepto_transferencia" TEXT NOT NULL,
    "plantilla_concepto_fiscal" TEXT NOT NULL,
    "validesa_texto" TEXT NOT NULL,
    "pie_legal" TEXT NOT NULL,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plantilla_documento_tenant_pkey" PRIMARY KEY ("id_plantilla")
);

-- 2) UNIQUE(tenant_id): garantía de relación 1-1 con Tenant.
CREATE UNIQUE INDEX "plantilla_documento_tenant_tenant_id_key" ON "plantilla_documento_tenant"("tenant_id");

-- 3) FK a Tenant.
ALTER TABLE "plantilla_documento_tenant" ADD CONSTRAINT "plantilla_documento_tenant_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) RLS: aislamiento multi-tenant por current_setting('app.tenant_id') (patrón del resto de tablas).
ALTER TABLE "plantilla_documento_tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "plantilla_documento_tenant"
  USING (tenant_id = current_setting('app.tenant_id', true));
