-- CreateEnum
CREATE TYPE "EstadoReserva" AS ENUM ('consulta', 'pre_reserva', 'reserva_confirmada', 'evento_en_curso', 'post_evento', 'reserva_completada', 'reserva_cancelada');

-- CreateEnum
CREATE TYPE "SubEstadoConsulta" AS ENUM ('s2a', 's2b', 's2c', 's2d', 's2v', 's2x', 's2y', 's2z');

-- CreateEnum
CREATE TYPE "TipoBloqueo" AS ENUM ('blando', 'firme');

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('gestor', 'admin', 'operario');

-- CreateEnum
CREATE TYPE "CanalEntrada" AS ENUM ('web', 'email', 'whatsapp', 'instagram', 'telefono');

-- CreateEnum
CREATE TYPE "DuracionHoras" AS ENUM ('4', '8', '12');

-- CreateEnum
CREATE TYPE "TipoEvento" AS ENUM ('boda', 'corporativo', 'privado', 'otro');

-- CreateEnum
CREATE TYPE "PreEventoStatus" AS ENUM ('pendiente', 'en_curso', 'cerrado');

-- CreateEnum
CREATE TYPE "LiquidacionStatus" AS ENUM ('pendiente', 'facturada', 'cobrada');

-- CreateEnum
CREATE TYPE "FianzaStatus" AS ENUM ('pendiente', 'recibo_enviado', 'cobrada', 'devuelta', 'retenida_parcial');

-- CreateEnum
CREATE TYPE "Temporada" AS ENUM ('alta', 'media', 'baja');

-- CreateEnum
CREATE TYPE "OrigenExtra" AS ENUM ('presupuesto', 'anadido_post_confirmacion');

-- CreateEnum
CREATE TYPE "EstadoPresupuesto" AS ENUM ('borrador', 'enviado', 'aceptado', 'rechazado');

-- CreateEnum
CREATE TYPE "TipoFactura" AS ENUM ('senal', 'liquidacion', 'fianza', 'complementaria');

-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('borrador', 'enviada', 'cobrada');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('dni_anverso', 'dni_reverso', 'clausula_responsabilidad', 'condiciones_particulares', 'justificante_pago', 'presupuesto', 'factura', 'otro');

-- CreateEnum
CREATE TYPE "CodigoEmail" AS ENUM ('E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'manual');

-- CreateEnum
CREATE TYPE "EstadoComunicacion" AS ENUM ('borrador', 'enviado', 'fallido');

-- CreateEnum
CREATE TYPE "AccionAudit" AS ENUM ('crear', 'actualizar', 'eliminar', 'transicion', 'login', 'logout');

-- CreateTable
CREATE TABLE "tenant" (
    "id_tenant" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email_contacto" TEXT NOT NULL,
    "telefono" TEXT,
    "direccion" TEXT,
    "iban" TEXT,
    "nif" TEXT,
    "capacidad_maxima" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id_tenant")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id_settings" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pct_senal" DECIMAL(4,2) NOT NULL,
    "fianza_default_eur" DECIMAL(10,2) NOT NULL,
    "ttl_consulta_dias" INTEGER NOT NULL,
    "ttl_prereserva_dias" INTEGER NOT NULL,
    "max_dias_programar_visita" INTEGER NOT NULL,
    "idioma" TEXT NOT NULL DEFAULT 'es',
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id_settings")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id_usuario" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellidos" TEXT,
    "rol" "Rol" NOT NULL DEFAULT 'gestor',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_acceso" TIMESTAMP(3),
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id_usuario")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id_cliente" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellidos" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "dni_nif" TEXT,
    "direccion" TEXT,
    "codigo_postal" TEXT,
    "poblacion" TEXT,
    "provincia" TEXT,
    "iban_devolucion" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id_cliente")
);

-- CreateTable
CREATE TABLE "reserva" (
    "id_reserva" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "estado" "EstadoReserva" NOT NULL,
    "sub_estado" "SubEstadoConsulta",
    "canal_entrada" "CanalEntrada" NOT NULL,
    "fecha_evento" DATE,
    "duracion_horas" "DuracionHoras",
    "tipo_evento" "TipoEvento",
    "num_adultos_ninos_mayores4" INTEGER,
    "num_ninos_menores4" INTEGER,
    "num_invitados_final" INTEGER,
    "importe_total" DECIMAL(10,2),
    "importe_senal" DECIMAL(10,2),
    "importe_liquidacion" DECIMAL(10,2),
    "ttl_expiracion" TIMESTAMP(3),
    "pre_evento_status" "PreEventoStatus" NOT NULL DEFAULT 'pendiente',
    "liquidacion_status" "LiquidacionStatus" NOT NULL DEFAULT 'pendiente',
    "fianza_status" "FianzaStatus" NOT NULL DEFAULT 'pendiente',
    "posicion_cola" INTEGER,
    "consulta_bloqueante_id" TEXT,
    "visita_programada_fecha" DATE,
    "visita_programada_hora" TEXT,
    "visita_realizada" BOOLEAN NOT NULL DEFAULT false,
    "fianza_eur" DECIMAL(10,2),
    "fianza_cobrada_fecha" TIMESTAMP(3),
    "fianza_devuelta_fecha" TIMESTAMP(3),
    "fianza_devuelta_eur" DECIMAL(10,2),
    "cond_part_firmadas" BOOLEAN NOT NULL DEFAULT false,
    "cond_part_enviadas_fecha" TIMESTAMP(3),
    "cond_part_firmadas_fecha" TIMESTAMP(3),
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reserva_pkey" PRIMARY KEY ("id_reserva")
);

-- CreateTable
CREATE TABLE "fecha_bloqueada" (
    "id_bloqueo" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "reserva_id" TEXT NOT NULL,
    "tipo_bloqueo" "TipoBloqueo" NOT NULL,
    "ttl_expiracion" TIMESTAMP(3),
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fecha_bloqueada_pkey" PRIMARY KEY ("id_bloqueo")
);

-- CreateTable
CREATE TABLE "tarifa" (
    "id_tarifa" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "temporada" "Temporada" NOT NULL,
    "duracion_horas" INTEGER NOT NULL,
    "invitados_min" INTEGER NOT NULL,
    "invitados_max" INTEGER NOT NULL,
    "precio_total_eur" DECIMAL(10,2) NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "vigente_hasta" DATE,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tarifa_pkey" PRIMARY KEY ("id_tarifa")
);

-- CreateTable
CREATE TABLE "temporada_calendario" (
    "id_temporada_cal" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "temporada" "Temporada" NOT NULL,
    "mes" INTEGER NOT NULL,

    CONSTRAINT "temporada_calendario_pkey" PRIMARY KEY ("id_temporada_cal")
);

-- CreateTable
CREATE TABLE "extra" (
    "id_extra" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "precio_eur" DECIMAL(10,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extra_pkey" PRIMARY KEY ("id_extra")
);

-- CreateTable
CREATE TABLE "reserva_extra" (
    "id_reserva_extra" TEXT NOT NULL,
    "reserva_id" TEXT NOT NULL,
    "extra_id" TEXT,
    "factura_id" TEXT,
    "concepto_libre" TEXT,
    "origen" "OrigenExtra" NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precio_unitario" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserva_extra_pkey" PRIMARY KEY ("id_reserva_extra")
);

-- CreateTable
CREATE TABLE "presupuesto" (
    "id_presupuesto" TEXT NOT NULL,
    "reserva_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "base_imponible" DECIMAL(10,2) NOT NULL,
    "iva_porcentaje" DECIMAL(4,2) NOT NULL,
    "iva_importe" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "descuento_eur" DECIMAL(10,2),
    "descuento_motivo" TEXT,
    "tarifa_congelada" BOOLEAN NOT NULL DEFAULT true,
    "pdf_url" TEXT,
    "estado" "EstadoPresupuesto" NOT NULL,
    "fecha_envio" TIMESTAMP(3),
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "presupuesto_pkey" PRIMARY KEY ("id_presupuesto")
);

-- CreateTable
CREATE TABLE "factura" (
    "id_factura" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reserva_id" TEXT NOT NULL,
    "numero_factura" TEXT NOT NULL,
    "tipo" "TipoFactura" NOT NULL,
    "base_imponible" DECIMAL(10,2) NOT NULL,
    "iva_porcentaje" DECIMAL(4,2) NOT NULL,
    "iva_importe" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "concepto" TEXT,
    "pdf_url" TEXT,
    "estado" "EstadoFactura" NOT NULL,
    "fecha_emision" TIMESTAMP(3),
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factura_pkey" PRIMARY KEY ("id_factura")
);

-- CreateTable
CREATE TABLE "pago" (
    "id_pago" TEXT NOT NULL,
    "factura_id" TEXT NOT NULL,
    "importe" DECIMAL(10,2) NOT NULL,
    "fecha_cobro" DATE NOT NULL,
    "justificante_doc_id" TEXT,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pago_pkey" PRIMARY KEY ("id_pago")
);

-- CreateTable
CREATE TABLE "ficha_operativa" (
    "id_ficha" TEXT NOT NULL,
    "reserva_id" TEXT NOT NULL,
    "num_invitados_confirmado" INTEGER,
    "menu_seleccionado" TEXT,
    "timing_detallado" TEXT,
    "contacto_evento_nombre" TEXT,
    "contacto_evento_telefono" TEXT,
    "notas_operativas" TEXT,
    "briefing_equipo" TEXT,
    "ficha_cerrada" BOOLEAN NOT NULL DEFAULT false,
    "fecha_cierre" TIMESTAMP(3),
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_actualizacion" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ficha_operativa_pkey" PRIMARY KEY ("id_ficha")
);

-- CreateTable
CREATE TABLE "documento" (
    "id_documento" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reserva_id" TEXT,
    "tipo" "TipoDocumento" NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "tamano_bytes" INTEGER,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documento_pkey" PRIMARY KEY ("id_documento")
);

-- CreateTable
CREATE TABLE "comunicacion" (
    "id_comunicacion" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reserva_id" TEXT,
    "cliente_id" TEXT NOT NULL,
    "codigo_email" "CodigoEmail" NOT NULL,
    "asunto" TEXT NOT NULL,
    "cuerpo" TEXT,
    "destinatario_email" TEXT NOT NULL,
    "estado" "EstadoComunicacion" NOT NULL,
    "fecha_envio" TIMESTAMP(3),
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comunicacion_pkey" PRIMARY KEY ("id_comunicacion")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id_audit" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "usuario_id" TEXT,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "accion" "AccionAudit" NOT NULL,
    "datos_anteriores" JSONB,
    "datos_nuevos" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "fecha_creacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id_audit")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE INDEX "cliente_tenant_id_email_idx" ON "cliente"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_codigo_key" ON "reserva"("codigo");

-- CreateIndex
CREATE INDEX "reserva_tenant_id_fecha_evento_estado_idx" ON "reserva"("tenant_id", "fecha_evento", "estado");

-- CreateIndex
CREATE INDEX "reserva_tenant_id_consulta_bloqueante_id_posicion_cola_idx" ON "reserva"("tenant_id", "consulta_bloqueante_id", "posicion_cola");

-- CreateIndex
CREATE UNIQUE INDEX "fecha_bloqueada_reserva_id_key" ON "fecha_bloqueada"("reserva_id");

-- CreateIndex
CREATE UNIQUE INDEX "fecha_bloqueada_tenant_id_fecha_key" ON "fecha_bloqueada"("tenant_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "presupuesto_reserva_id_version_key" ON "presupuesto"("reserva_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "factura_numero_factura_key" ON "factura"("numero_factura");

-- CreateIndex
CREATE UNIQUE INDEX "ficha_operativa_reserva_id_key" ON "ficha_operativa"("reserva_id");

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente" ADD CONSTRAINT "cliente_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id_cliente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_consulta_bloqueante_id_fkey" FOREIGN KEY ("consulta_bloqueante_id") REFERENCES "reserva"("id_reserva") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fecha_bloqueada" ADD CONSTRAINT "fecha_bloqueada_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fecha_bloqueada" ADD CONSTRAINT "fecha_bloqueada_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id_reserva") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifa" ADD CONSTRAINT "tarifa_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "temporada_calendario" ADD CONSTRAINT "temporada_calendario_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extra" ADD CONSTRAINT "extra_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_extra" ADD CONSTRAINT "reserva_extra_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id_reserva") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_extra" ADD CONSTRAINT "reserva_extra_extra_id_fkey" FOREIGN KEY ("extra_id") REFERENCES "extra"("id_extra") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_extra" ADD CONSTRAINT "reserva_extra_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "factura"("id_factura") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presupuesto" ADD CONSTRAINT "presupuesto_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id_reserva") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura" ADD CONSTRAINT "factura_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura" ADD CONSTRAINT "factura_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id_reserva") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "factura"("id_factura") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_justificante_doc_id_fkey" FOREIGN KEY ("justificante_doc_id") REFERENCES "documento"("id_documento") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ficha_operativa" ADD CONSTRAINT "ficha_operativa_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id_reserva") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id_reserva") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacion" ADD CONSTRAINT "comunicacion_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacion" ADD CONSTRAINT "comunicacion_reserva_id_fkey" FOREIGN KEY ("reserva_id") REFERENCES "reserva"("id_reserva") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comunicacion" ADD CONSTRAINT "comunicacion_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id_cliente") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id_tenant") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id_usuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- ROW-LEVEL SECURITY (multi-tenancy)
-- Aislamiento por tenant vía SET LOCAL app.tenant_id = '<uuid>'.
-- Cada tabla de negocio con columna tenant_id filtra por current_setting('app.tenant_id').
-- La tabla raíz `tenant` se filtra por su propia PK id_tenant.
-- ============================================================

-- Tabla raíz: tenant
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant"
  USING (id_tenant = current_setting('app.tenant_id', true));

-- Tablas de negocio con tenant_id directo
ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_settings"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "usuario" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "usuario"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "cliente" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cliente"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "reserva" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reserva"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "fecha_bloqueada" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "fecha_bloqueada"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "tarifa" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tarifa"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "temporada_calendario" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "temporada_calendario"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "extra" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "extra"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "factura" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "factura"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "documento" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "documento"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "comunicacion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "comunicacion"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_log"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- Tablas hijas sin tenant_id directo: aislamiento vía la reserva/factura padre.
ALTER TABLE "reserva_extra" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "reserva_extra"
  USING (EXISTS (
    SELECT 1 FROM "reserva" r
    WHERE r.id_reserva = reserva_extra.reserva_id
      AND r.tenant_id = current_setting('app.tenant_id', true)));

ALTER TABLE "presupuesto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "presupuesto"
  USING (EXISTS (
    SELECT 1 FROM "reserva" r
    WHERE r.id_reserva = presupuesto.reserva_id
      AND r.tenant_id = current_setting('app.tenant_id', true)));

ALTER TABLE "ficha_operativa" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ficha_operativa"
  USING (EXISTS (
    SELECT 1 FROM "reserva" r
    WHERE r.id_reserva = ficha_operativa.reserva_id
      AND r.tenant_id = current_setting('app.tenant_id', true)));

ALTER TABLE "pago" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pago"
  USING (EXISTS (
    SELECT 1 FROM "factura" f
    WHERE f.id_factura = pago.factura_id
      AND f.tenant_id = current_setting('app.tenant_id', true)));

-- ============================================================
-- ÍNDICE FULL-TEXT (GIN) sobre RESERVA (histórico consultable — UC-32)
-- Indexa código, notas. Idioma español para el stemmer.
-- ============================================================
CREATE INDEX reserva_fulltext_idx ON "reserva"
  USING GIN (to_tsvector('spanish', coalesce(codigo, '') || ' ' || coalesce(notas, '')));
