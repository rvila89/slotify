/**
 * DTOs HTTP de la FICHA_OPERATIVA (US-025 / UC-20). Nombres camelCase ALINEADOS con el
 * contrato OpenAPI congelado (`FichaOperativa`, `GuardarFichaOperativaRequest`,
 * `CerrarFichaOperativaResponse`). Fechas `date-time` en string ISO. El guardado es
 * PARCIAL: todos los campos son opcionales (`class-validator` valida el formato → 400;
 * las guardas de negocio viven en el use-case → 409/404).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

/** Salta la validación de tipo cuando el valor es `null` (borrado explícito). */
const salvoNull = (_: object, valor: unknown): boolean => valor !== null;

/** Valores del enum `PreEventoStatus` del contrato OpenAPI congelado. */
export const PRE_EVENTO_STATUS = ['pendiente', 'en_curso', 'cerrado'] as const;

/**
 * Valores del enum `DuracionHoras {4,8,12}` del contrato: INTEGER (no string). El SDK y el
 * contrato OpenAPI tipan `duracionHoras` como `integer enum [4,8,12]`.
 */
export const DURACION_HORAS = [4, 8, 12] as const;

/** Respuesta 200 de `GET`/`PATCH` (`FichaOperativa` del contrato). */
export class FichaOperativaResponseDto {
  @ApiProperty({ format: 'uuid' })
  idFicha!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  numInvitadosConfirmado!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactoEventoNombre!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactoEventoTelefono!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactoEventoCorreo!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  horaLlegada!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  duracion!: string | null;

  @ApiPropertyOptional({
    enum: DURACION_HORAS,
    type: Number,
    nullable: true,
    description:
      'Duración estructurada de la RESERVA (enum integer 4/8/12). Editable en la ventana viva.',
  })
  duracionHoras!: (typeof DURACION_HORAS)[number] | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Desglose de aforo: adultos + niños > 4 años (fiel al motor de tarifa).',
  })
  numAdultosNinosMayores4!: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Desglose de aforo: niños < 4 años.',
  })
  numNinosMenores4!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  notasOperativas!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  briefingEquipo!: string | null;

  @ApiProperty()
  fichaCerrada!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  fechaCierre!: string | null;

  @ApiProperty({ enum: PRE_EVENTO_STATUS })
  preEventoStatus!: (typeof PRE_EVENTO_STATUS)[number];
}

/** Respuesta 200 del cierre (`CerrarFichaOperativaResponse`: ficha + avisos). */
export class CerrarFichaOperativaResponseDto extends FichaOperativaResponseDto {
  @ApiProperty({
    type: [String],
    description:
      'Nombres (camelCase) de los campos de contenido vacíos al cerrar (aviso informativo, no error). Vacío si estaban todos rellenos.',
    example: ['duracion', 'briefingEquipo'],
  })
  avisosCamposVacios!: string[];
}

/**
 * Snapshot del RECÁLCULO en cascada (`RecalculoResultado` del contrato). Importes como
 * Decimal(10,2) string; `null` en el caso `tarifaAConsultar=true` sin `precioManualEur`.
 */
export class RecalculoResultadoDto {
  @ApiProperty({
    type: Boolean,
    description:
      '`true` cuando >50 invitados o sin TARIFA configurada: exige precioManualEur.',
  })
  @IsBoolean()
  tarifaAConsultar!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  nuevoTotal!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  pagoInicial!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  liquidacionRestante!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  versionPresupuesto!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  versionLiquidacion!: number | null;
}

/**
 * Respuesta 200 del PATCH (`GuardarFichaOperativaResponse`): la ficha (con pre-relleno y
 * campos estructurados) MÁS el resultado del recálculo. `recalculo` es `null` cuando el
 * guardado no tocó aforo/duración estructural (no hubo recálculo).
 */
export class GuardarFichaOperativaResponseDto extends FichaOperativaResponseDto {
  @ApiPropertyOptional({
    type: RecalculoResultadoDto,
    nullable: true,
    description:
      'Resultado del recálculo en cascada, o null si el guardado no cambió aforo/duración.',
  })
  recalculo!: RecalculoResultadoDto | null;
}

/**
 * Cuerpo de `PATCH /reservas/{id}/ficha-operativa`: guardado PARCIAL
 * (`GuardarFichaOperativaRequest`). Todos los campos son opcionales; solo se persiste
 * el subconjunto presente. `numInvitadosConfirmado` admite `null` (borrar el valor).
 */
export class GuardarFichaOperativaRequestDto {
  /**
   * SOFT-DEPRECATED (change `reserva-viva-edicion-recalculo-ficha` §D-1): el nº de invitados
   * confirmado pasa a ser DERIVADO del desglose de la RESERVA (`numAdultosNinosMayores4` +
   * `numNinosMenores4`). Se mantiene por compatibilidad, pero YA NO edita el aforo estructural.
   */
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    deprecated: true,
    description: 'SOFT-DEPRECATED: usa numAdultosNinosMayores4 + numNinosMenores4.',
  })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsInt()
  numInvitadosConfirmado?: number | null;

  /**
   * Duración estructurada de la RESERVA (enum INTEGER 4/8/12, alineado con el contrato/SDK).
   * Dispara recálculo en la ventana viva. Un valor fuera de `{4,8,12}` → 400.
   */
  @ApiPropertyOptional({ enum: DURACION_HORAS, type: Number })
  @IsOptional()
  @IsInt()
  @IsIn(DURACION_HORAS)
  duracionHoras?: (typeof DURACION_HORAS)[number];

  /** Desglose de aforo: adultos + niños > 4 años. Dispara recálculo en la ventana viva. */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  numAdultosNinosMayores4?: number;

  /** Desglose de aforo: niños < 4 años. Dispara recálculo en la ventana viva. */
  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  numNinosMenores4?: number;

  /**
   * Precio total manual (IVA incluido) para el caso `tarifaAConsultar` (>50 invitados o sin
   * tarifa configurada). Decimal string.
   */
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsNumberString()
  precioManualEur?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  contactoEventoNombre?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  contactoEventoTelefono?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  contactoEventoCorreo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  horaLlegada?: string | null;

  /**
   * SOFT-DEPRECATED (§D-1): la duración pasa a `duracionHoras` (enum estructural). Se mantiene
   * el texto libre por compatibilidad, pero YA NO edita la duración estructural de la RESERVA.
   */
  @ApiPropertyOptional({ type: String, nullable: true, deprecated: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  duracion?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  notasOperativas?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  briefingEquipo?: string | null;
}
