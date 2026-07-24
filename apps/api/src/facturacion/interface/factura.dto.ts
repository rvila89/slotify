/**
 * DTOs HTTP de la capability `facturacion` (US-022 / UC-18 / US-027 / UC-21 / UC-22).
 * Reproducen EXACTAMENTE los schemas del contrato `docs/api-spec.yml` (tag `Facturacion`):
 * `FacturaDto` (vista canónica generalizada de una FACTURA de cualquier tipo), `FacturaSenalDto`
 * (alias de señal, misma forma), `RechazarFacturaRequest`, `AprobarFacturaRequest`,
 * `RegenerarPdfFacturaRequest`.
 *
 * Los importes viajan como string Decimal de 2 decimales (wrapper `Importe`/`Porcentaje`,
 * F2-01). Los flags `esBorradorInvalido`/`pdfPendiente` son DERIVADOS (design.md §D-9).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ReservaDetalleResponseDto } from '../../reservas/interface/reserva-detalle.dto';

/** Patrón de importe Decimal(10,2) serializado como string (contrato `Importe`, F2-01). */
const IMPORTE_PATTERN = /^-?\d+\.\d{2}$/;

/** Estado del ciclo de vida de la factura (contrato `EstadoFactura`). */
export type EstadoFacturaDto = 'borrador' | 'enviada' | 'cobrada';

/**
 * Vista de lectura CANÓNICA y GENERALIZADA de una FACTURA de cualquier tipo (`senal`,
 * `liquidacion`, `fianza`, `complementaria`). Espejo del schema `FacturaDto` del contrato
 * (US-027 §D-5). Es el item de la colección `GET /reservas/{id}/facturas`.
 */
export class FacturaDto {
  @ApiProperty({ format: 'uuid' })
  idFactura!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiProperty({ nullable: true, example: 'F-2026-0001' })
  numeroFactura!: string | null;

  @ApiProperty({ enum: ['senal', 'liquidacion', 'complementaria'] })
  tipo!: string;

  @ApiProperty({ example: '991.74' })
  baseImponible!: string;

  @ApiProperty({ example: '21.00' })
  ivaPorcentaje!: string;

  @ApiProperty({ example: '208.26' })
  ivaImporte!: string;

  @ApiProperty({ example: '1200.00' })
  total!: string;

  @ApiPropertyOptional({ nullable: true })
  concepto?: string | null;

  @ApiProperty({ nullable: true })
  pdfUrl!: string | null;

  @ApiProperty({ enum: ['borrador', 'enviada', 'cobrada'] })
  estado!: EstadoFacturaDto;

  @ApiProperty({ format: 'date-time', nullable: true })
  fechaEmision!: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  fechaCreacion?: string;

  @ApiProperty({ description: 'Faltan datos fiscales del cliente (bloqueo por datos).' })
  esBorradorInvalido!: boolean;

  @ApiProperty({ description: 'pdfUrl=null por fallo transitorio del PDF (reintenta solo).' })
  pdfPendiente!: boolean;
}

/**
 * Vista de lectura de la factura de señal (contrato `FacturaSenalDto`). Misma forma que
 * `FacturaDto`; se conserva como nombre estable de los endpoints de US-022
 * (obtener/aprobar/rechazar/regenerar-pdf).
 */
export class FacturaSenalDto extends FacturaDto {
  /** Flag derivado: `true` cuando E3 (enviado, es_reenvio=false) existe para la reserva. */
  @ApiProperty({ description: 'Flag e3Enviado: primera emisión E3 confirmada', type: Boolean })
  e3Enviado!: boolean;
}

/**
 * Vista de lectura de la factura de liquidación (contrato `FacturaLiquidacionDto`,
 * fix-liquidacion-fianza-independientes). Misma forma que `FacturaDto` + flag derivado
 * `e4Enviado` para el banner permanente "Liquidación enviada el {fecha/hora}".
 */
export class FacturaLiquidacionDto extends FacturaDto {
  /** Flag derivado: `true` cuando E4 (enviado, es_reenvio=false) existe para la reserva. */
  @ApiProperty({ description: 'Flag e4Enviado: primera emisión E4 confirmada', type: Boolean })
  e4Enviado!: boolean;
}

/** Cuerpo vacío de la aprobación (contrato `AprobarFacturaRequest`). */
export class AprobarFacturaRequestDto {}

/** Cuerpo VACÍO del envío de la factura de señal (contrato `EnviarFacturaSenalRequest`, 6.4b). */
export class EnviarFacturaSenalDto {}

/**
 * Respuesta del envío de la factura de señal por E3 (contrato `EnviarFacturaSenalResponse`,
 * US-023 / change `condiciones-idioma-e2-firma-banner`). Devuelve la factura de señal emitida
 * (`estado=enviada`, `numeroFactura`, `fechaEmision`) y el timestamp `condPartEnviadasFecha`
 * (fijado al enviar las condiciones en E2, confirmar presupuesto). Mejora B: las condicions
 * particulars YA NO se adjuntan en E3.
 */
export class EnviarFacturaSenalResponseDto {
  @ApiProperty({
    type: FacturaDto,
    description: 'Factura de señal emitida (estado=enviada, numeroFactura, fechaEmision).',
  })
  factura!: FacturaDto;

  @ApiProperty({
    format: 'date-time',
    description:
      'Timestamp del envío de las condiciones (RESERVA.cond_part_enviadas_fecha), fijado en E2.',
  })
  condPartEnviadasFecha!: string;
}

/** Cuerpo del rechazo: motivo obligatorio (contrato `RechazarFacturaRequest`). */
export class RechazarFacturaRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  motivo!: string;
}

/** Cuerpo vacío del reintento de PDF (contrato `RegenerarPdfFacturaRequest`). */
export class RegenerarPdfFacturaRequestDto {}

/** Sub-estados de liquidación de la RESERVA (contrato `LiquidacionStatus`). */
export type LiquidacionStatusDto = 'pendiente' | 'facturada' | 'cobrada';

/** Sub-estados de fianza de la RESERVA (contrato `FianzaStatus`). */
export type FianzaStatusDto = 'pendiente' | 'cobrada' | 'devuelta';

/**
 * Cuerpo VACÍO de "Aprobar y enviar" la liquidación (contrato `EnviarFacturaLiquidacionRequest`,
 * fix-liquidacion-fianza-independientes / UC-21). El endpoint no requiere parámetros.
 */
export class EnviarFacturaLiquidacionDto {}

/**
 * Respuesta de "Aprobar y enviar" la liquidación (contrato `EnviarFacturaLiquidacionResponse`).
 * E4 = solo liquidación: devuelve la factura de liquidación emitida + `liquidacionStatus`.
 */
export class EnviarFacturaLiquidacionResponseDto {
  @ApiProperty({ type: FacturaDto })
  liquidacion!: FacturaDto;

  @ApiProperty({ enum: ['pendiente', 'facturada', 'cobrada'] })
  liquidacionStatus!: LiquidacionStatusDto;
}

/** Proyección de la NUEVA COMUNICACION creada por el reenvío. */
export class ComunicacionReenvioDto {
  @ApiProperty({ format: 'uuid' })
  idComunicacion!: string;

  @ApiPropertyOptional({ example: 'enviado' })
  estado?: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  fechaEnvio?: string | null;
}

/**
 * Respuesta del reenvío de la liquidación (contrato `ReenviarLiquidacionResponse`). Devuelve la
 * factura de liquidación SIN cambios y la NUEVA COMUNICACION creada por el reenvío (D-4).
 */
export class ReenviarLiquidacionResponseDto {
  @ApiProperty({ type: FacturaDto })
  liquidacion!: FacturaDto;

  @ApiProperty({ type: ComunicacionReenvioDto })
  comunicacion!: ComunicacionReenvioDto;
}

/** Cuerpo VACÍO del reenvío de E3 (contrato `ReenviarE3Request`, US-023 GAP 3). */
export class ReenviarE3RequestDto {}

/** Proyección de la NUEVA COMUNICACION E3 creada por el reenvío (`esReenvio=true`). */
export class ComunicacionReenvioE3Dto {
  @ApiProperty({ format: 'uuid' })
  idComunicacion!: string;

  @ApiPropertyOptional({ example: 'enviado' })
  estado?: string;

  @ApiPropertyOptional({ example: true })
  esReenvio?: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  fechaEnvio?: string | null;
}

/**
 * Respuesta del reenvío de E3 (contrato `ReenviarE3Response`, US-023 GAP 3). Devuelve la factura
 * de señal SIN cambios, la NUEVA COMUNICACION E3 del reenvío (`esReenvio=true`) y el nuevo
 * timestamp `condPartEnviadasFecha`.
 */
export class ReenviarE3ResponseDto {
  @ApiProperty({ type: FacturaDto })
  factura!: FacturaDto;

  @ApiProperty({ type: ComunicacionReenvioE3Dto })
  comunicacion!: ComunicacionReenvioE3Dto;

  @ApiProperty({
    format: 'date-time',
    description: 'Nuevo timestamp fijado en RESERVA.cond_part_enviadas_fecha al reenviar E3.',
  })
  condPartEnviadasFecha!: string;
}

/**
 * Cuerpo de "Registrar el cobro de la liquidación" (contrato `RegistrarCobroLiquidacionRequest`,
 * US-029 / UC-21 pasos 7-10). `importe` Decimal(10,2) como string `> 0`; `fechaCobro` DATE `<= hoy`
 * (validación de negocio en dominio); `justificanteDocId` OPCIONAL (referencia a un DOCUMENTO
 * `tipo='justificante_pago'` ya subido; `null` si no se adjunta). `tenant_id` viaja en el JWT.
 */
export class RegistrarCobroLiquidacionDto {
  @ApiProperty({ example: '4100.00', description: 'Importe real cobrado, Decimal(10,2) string > 0.' })
  @IsString()
  @Matches(IMPORTE_PATTERN, { message: 'importe debe ser Decimal(10,2) como string' })
  importe!: string;

  @ApiProperty({ format: 'date', example: '2026-06-15', description: 'Fecha del cobro, <= hoy.' })
  @IsDateString()
  fechaCobro!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'DOCUMENTO justificante ya subido (tipo=justificante_pago). null si no se adjunta.',
  })
  @IsOptional()
  @IsUUID()
  justificanteDocId?: string | null;
}

/**
 * Vista de lectura del PAGO conciliado contra la factura de liquidación (contrato `PagoLiquidacion`,
 * espejo de la tabla PAGO, er-diagram §3.13). `tenant_id` NO se expone (RLS, deriva del JWT).
 */
export class PagoLiquidacionDto {
  @ApiProperty({ format: 'uuid' })
  idPago!: string;

  @ApiProperty({ format: 'uuid' })
  facturaId!: string;

  @ApiProperty({ example: '4100.00' })
  importe!: string;

  @ApiProperty({ format: 'date', example: '2026-06-15' })
  fechaCobro!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  justificanteDocId!: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  fechaCreacion?: string;
}

/**
 * Alerta informativa de discrepancia de importe (contrato `AlertaDiscrepanciaCobro`, US-029 §D-3).
 * Presente SOLO si el importe cobrado difiere del facturado. NO es un error: el cobro se registra.
 */
export class AlertaDiscrepanciaCobroDto {
  @ApiProperty({ example: '4100.00', description: 'Total de la factura de liquidación.' })
  importeFacturado!: string;

  @ApiProperty({ example: '4000.00', description: 'Importe realmente cobrado.' })
  importeCobrado!: string;

  @ApiProperty({ example: '100.00', description: 'importeFacturado - importeCobrado.' })
  diferencia!: string;
}

/**
 * Respuesta de "Registrar el cobro de la liquidación" (contrato `RegistrarCobroLiquidacionResponse`).
 * Devuelve el PAGO creado, la FACTURA de liquidación actualizada (`estado=cobrada`), el
 * `liquidacionStatus` resultante (`cobrada`) y, SOLO si hubo discrepancia, `alertaDiscrepancia`.
 */
export class RegistrarCobroLiquidacionResponseDto {
  @ApiProperty({ type: PagoLiquidacionDto })
  pago!: PagoLiquidacionDto;

  @ApiProperty({ type: FacturaDto })
  liquidacion!: FacturaDto;

  @ApiProperty({ enum: ['pendiente', 'facturada', 'cobrada'] })
  liquidacionStatus!: LiquidacionStatusDto;

  @ApiPropertyOptional({ type: AlertaDiscrepanciaCobroDto, nullable: true })
  alertaDiscrepancia?: AlertaDiscrepanciaCobroDto | null;
}

// ---------------------------------------------------------------------------
// fix-liquidacion-fianza-independientes: fianza pasiva (comprobante) + devolución completa
// ---------------------------------------------------------------------------

/** DOCUMENTO comprobante de la fianza creado (contrato `Documento`). */
export class DocumentoComprobanteFianzaDto {
  @ApiProperty({ format: 'uuid' })
  idDocumento!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  reservaId?: string | null;

  @ApiProperty({ example: 'comprobante_fianza' })
  tipo!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;
}

/**
 * Respuesta de la subida del comprobante de la fianza (contrato `SubirComprobanteFianzaResponse`).
 * Devuelve la RESERVA con `fianzaStatus='cobrada'` + `fianzaComprobanteFecha` y el DOCUMENTO creado.
 */
export class SubirComprobanteFianzaResponseDto {
  @ApiProperty({ type: ReservaDetalleResponseDto })
  reserva!: ReservaDetalleResponseDto;

  @ApiProperty({ type: DocumentoComprobanteFianzaDto })
  comprobante!: DocumentoComprobanteFianzaDto;
}

/** Cuerpo VACÍO de "Devolver fianza" (contrato `DevolverFianzaRequest`). */
export class DevolverFianzaRequestDto {}

/** Aviso best-effort cuando la devolución se registró pero E10 no pudo enviarse. */
export class DevolverFianzaAvisoEmailDto {
  @ApiProperty({ enum: ['e10_fallido'] })
  codigo!: 'e10_fallido';

  @ApiProperty()
  mensaje!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  comunicacionId?: string | null;
}

/**
 * Respuesta de "Devolver fianza" (contrato `DevolverFianzaResponse`). Devuelve la RESERVA
 * (`fianzaStatus='devuelta'`, `fianzaDevueltaFecha`) y `avisoEmail` (nulo si E10 se envió).
 */
export class DevolverFianzaResponseDto {
  @ApiProperty({ type: ReservaDetalleResponseDto })
  reserva!: ReservaDetalleResponseDto;

  @ApiPropertyOptional({ type: DevolverFianzaAvisoEmailDto, nullable: true })
  avisoEmail!: DevolverFianzaAvisoEmailDto | null;
}
