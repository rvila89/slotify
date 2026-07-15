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
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

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

  @ApiProperty({ enum: ['senal', 'liquidacion', 'fianza', 'complementaria'] })
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
export class FacturaSenalDto extends FacturaDto {}

/** Cuerpo vacío de la aprobación (contrato `AprobarFacturaRequest`). */
export class AprobarFacturaRequestDto {}

/** Cuerpo VACÍO del envío de la factura de señal (contrato `EnviarFacturaSenalRequest`, 6.4b). */
export class EnviarFacturaSenalDto {}

/**
 * Respuesta del envío de la factura de señal + condicions particulars por E3 (contrato
 * `EnviarFacturaSenalResponse`, 6.4b / US-023). Devuelve la factura de señal emitida
 * (`estado=enviada`, `numeroFactura`, `fechaEmision`), el timestamp del envío de E3
 * (`condPartEnviadasFecha`) y si las condicions particulars se adjuntaron (`condPartAdjuntada`).
 */
export class EnviarFacturaSenalResponseDto {
  @ApiProperty({
    type: FacturaDto,
    description: 'Factura de señal emitida (estado=enviada, numeroFactura, fechaEmision).',
  })
  factura!: FacturaDto;

  @ApiProperty({
    format: 'date-time',
    description: 'Timestamp del envío de E3 (RESERVA.cond_part_enviadas_fecha).',
  })
  condPartEnviadasFecha!: string;

  @ApiProperty({
    description: 'true si las condicions particulars se adjuntaron a E3; false si se omitieron.',
  })
  condPartAdjuntada!: boolean;
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
export type FianzaStatusDto =
  | 'pendiente'
  | 'recibo_enviado'
  | 'cobrada'
  | 'devuelta'
  | 'retenida_parcial';

/**
 * Cuerpo OPCIONAL de "Aprobar y enviar" la liquidación (contrato `AprobarEnviarLiquidacionRequest`,
 * US-028 / UC-21). Sin body emite la liquidación tal cual; con body aplica el descuento negociado
 * (D-2) y registra el motivo en AUDIT_LOG.
 */
export class AprobarEnviarLiquidacionDto {
  @ApiPropertyOptional({
    example: '200.00',
    description: 'Descuento negociado (> 0 y < total). Inválido → 422 DESCUENTO_INVALIDO.',
  })
  @IsOptional()
  @IsString()
  descuento?: string;

  @ApiPropertyOptional({ description: 'Motivo del descuento, registrado en AUDIT_LOG.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  motivo?: string;
}

/**
 * Respuesta de "Aprobar y enviar" la liquidación (contrato `AprobarEnviarLiquidacionResponse`).
 * Devuelve ambas facturas emitidas (`fianza=null` si no se emitió aquí) + los status resultantes.
 */
export class AprobarEnviarLiquidacionResponseDto {
  @ApiProperty({ type: FacturaDto })
  liquidacion!: FacturaDto;

  @ApiProperty({ type: FacturaDto, nullable: true })
  fianza!: FacturaDto | null;

  @ApiProperty({ enum: ['pendiente', 'facturada', 'cobrada'] })
  liquidacionStatus!: LiquidacionStatusDto;

  @ApiProperty({
    enum: ['pendiente', 'recibo_enviado', 'cobrada', 'devuelta', 'retenida_parcial'],
  })
  fianzaStatus!: FianzaStatusDto;
}

/**
 * Respuesta del envío separado del recibo de fianza (contrato `EnviarReciboFianzaResponse`).
 */
export class EnviarReciboFianzaResponseDto {
  @ApiProperty({ type: FacturaDto })
  fianza!: FacturaDto;

  @ApiProperty({
    enum: ['pendiente', 'recibo_enviado', 'cobrada', 'devuelta', 'retenida_parcial'],
  })
  fianzaStatus!: FianzaStatusDto;
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

/**
 * Cuerpo de "Registrar el cobro de la fianza" (contrato `RegistrarCobroFianzaRequest`,
 * US-030 / UC-22 pasos 5-9). `importe` Decimal(10,2) como string `> 0`; `fechaCobro` DATE
 * `<= RESERVA.fechaEvento` (validación de negocio en dominio, relativa al evento, NO a hoy);
 * `justificanteDocId` OPCIONAL (referencia a un DOCUMENTO `tipo='justificante_pago'` ya subido;
 * `null` si no se adjunta); `confirmarSinRecibo` materializa la política "Negociable" (design.md
 * §D-2) para `fianzaStatus='pendiente'`. `tenant_id` viaja en el JWT.
 */
export class RegistrarCobroFianzaDto {
  @ApiProperty({ example: '1000.00', description: 'Importe real cobrado, Decimal(10,2) string > 0.' })
  @IsString()
  @Matches(IMPORTE_PATTERN, { message: 'importe debe ser Decimal(10,2) como string' })
  importe!: string;

  @ApiProperty({
    format: 'date',
    example: '2026-07-10',
    description: 'Fecha del cobro, <= RESERVA.fechaEvento (relativo al evento).',
  })
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

  @ApiPropertyOptional({
    default: false,
    description:
      'Política "Negociable": confirma el cobro sobre fianzaStatus=pendiente (recibo no enviado). ' +
      'Ausente/false sobre pendiente => respuesta confirmacion_requerida sin crear PAGO.',
  })
  @IsOptional()
  @IsBoolean()
  confirmarSinRecibo?: boolean;
}

/**
 * Forma "cobro registrado" de la respuesta discriminada de cobro de fianza (contrato
 * `RegistrarCobroFianzaCobrado`). `resultado='cobrado'`. Devuelve el PAGO creado, la FACTURA
 * (fianza) actualizada (`estado=cobrada`), el `fianzaStatus` resultante (`cobrada`), y
 * `fianzaEur`/`fianzaCobradaFecha` de la RESERVA.
 */
export class RegistrarCobroFianzaCobradoDto {
  @ApiProperty({ enum: ['cobrado'] })
  resultado!: 'cobrado';

  @ApiProperty({ type: PagoLiquidacionDto })
  pago!: PagoLiquidacionDto;

  @ApiProperty({ type: FacturaDto })
  facturaFianza!: FacturaDto;

  @ApiProperty({
    enum: ['pendiente', 'recibo_enviado', 'cobrada', 'devuelta', 'retenida_parcial'],
  })
  fianzaStatus!: FianzaStatusDto;

  @ApiProperty({ example: '1000.00', description: 'RESERVA.fianzaEur (Decimal(10,2) string).' })
  fianzaEur!: string;

  @ApiProperty({ format: 'date', example: '2026-07-10', description: 'RESERVA.fianzaCobradaFecha.' })
  fianzaCobradaFecha!: string;
}

/** Indica al frontend cómo reintentar el cobro tras confirmar la política "Negociable". */
export class RegistrarCobroFianzaReintentarConDto {
  @ApiProperty({ enum: [true], description: 'Reenviar con confirmarSinRecibo: true.' })
  confirmarSinRecibo!: true;
}

/**
 * Forma "confirmación requerida" de la respuesta discriminada (contrato
 * `RegistrarCobroFianzaConfirmacionRequerida`). Política "Negociable": `fianzaStatus='pendiente'`
 * sin `confirmarSinRecibo=true`. NO crea PAGO ni FACTURA ni cambia el estado; el frontend muestra
 * el aviso y reintenta con el flag. `resultado='confirmacion_requerida'`.
 */
export class RegistrarCobroFianzaConfirmacionRequeridaDto {
  @ApiProperty({ enum: ['confirmacion_requerida'] })
  resultado!: 'confirmacion_requerida';

  @ApiProperty({ enum: ['RECIBO_FIANZA_NO_ENVIADO'] })
  codigo!: 'RECIBO_FIANZA_NO_ENVIADO';

  @ApiProperty({
    example: 'El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar el cobro igualmente?',
  })
  mensaje!: string;

  @ApiProperty({ type: RegistrarCobroFianzaReintentarConDto })
  reintentarCon!: RegistrarCobroFianzaReintentarConDto;
}

/**
 * Respuesta discriminada por `resultado` de "Registrar el cobro de la fianza" (contrato
 * `RegistrarCobroFianzaResponse`, oneOf). El frontend distingue el cobro efectivo
 * (`RegistrarCobroFianzaCobradoDto`) de la respuesta "confirmación requerida" de la política
 * "Negociable" (`RegistrarCobroFianzaConfirmacionRequeridaDto`) para mostrar el diálogo y reintentar.
 */
@ApiExtraModels(RegistrarCobroFianzaCobradoDto, RegistrarCobroFianzaConfirmacionRequeridaDto)
export class RegistrarCobroFianzaResponseDto {
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(RegistrarCobroFianzaCobradoDto) },
      { $ref: getSchemaPath(RegistrarCobroFianzaConfirmacionRequeridaDto) },
    ],
    discriminator: {
      propertyName: 'resultado',
      mapping: {
        cobrado: getSchemaPath(RegistrarCobroFianzaCobradoDto),
        confirmacion_requerida: getSchemaPath(RegistrarCobroFianzaConfirmacionRequeridaDto),
      },
    },
  })
  value!: RegistrarCobroFianzaCobradoDto | RegistrarCobroFianzaConfirmacionRequeridaDto;
}
