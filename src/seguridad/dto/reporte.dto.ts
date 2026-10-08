import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { TIPOS_REPORTE, PUNTAJE_MAXIMO } from '../reglas';
import type { TipoReporte } from '../reglas';

/** Alta y edición (mientras está pendiente) de un Reporte de Seguridad. Qué
 * campos pide cada tipo lo valida `erroresDeCampos` en el servicio: acá solo
 * la forma de cada dato. */
export class ReporteDto {
  @IsIn(TIPOS_REPORTE)
  tipo: TipoReporte;

  /** Día en que se vio la situación ('YYYY-MM-DD'). La fecha de envío la
   * pone el sistema. */
  @IsDateString()
  fechaReporte: string;

  @Type(() => Number) @IsInt()
  provinciaId: number;

  @Type(() => Number) @IsInt()
  contratoId: number;

  @Type(() => Number) @IsInt()
  tareaId: number;

  @IsOptional() @IsString() @MaxLength(200)
  ubicacion?: string;

  /** Punto GPS tomado con "Tomar mi ubicación": obligatorio en la
   * paralización, opcional en el resto (ADR-027, revisión 2026-10-08). */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  latitud?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  longitud?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  errorMetros?: number;

  @IsString() @IsNotEmpty()
  descripcion: string;

  @IsOptional() @Type(() => Number) @IsInt()
  naturalezaId?: number;

  @IsOptional() @Type(() => Number) @IsInt()
  motivoParalizacionId?: number;

  @IsOptional() @IsString()
  controlRiesgo?: string;

  /** CUIL de las personas de la nómina en la situación. */
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true })
  involucrados?: string[];
}

export class AnularReporteDto {
  @IsString() @IsNotEmpty()
  motivo: string;
}

/** HyS aprueba con un puntaje de 0 a 10, o desaprueba (0 puntos) explicando
 * por qué: el autor ve el comentario. */
export class CalificarReporteDto {
  @IsIn(['aprobar', 'desaprobar'])
  decision: 'aprobar' | 'desaprobar';

  @ValidateIf((d: CalificarReporteDto) => d.decision === 'aprobar')
  @Type(() => Number) @IsInt() @Min(0) @Max(PUNTAJE_MAXIMO)
  puntaje?: number;

  @ValidateIf((d: CalificarReporteDto) => d.decision === 'desaprobar')
  @IsString() @IsNotEmpty({ message: 'Para desaprobar hay que explicarle al autor por qué' })
  comentario?: string;
}

/** Campos de texto del multipart de una foto. La ubicación llega solo si la
 * foto se sacó con la cámara desde la app. */
export class FotoDto {
  @IsIn(['riesgo', 'control'])
  grupo: 'riesgo' | 'control';

  @IsIn(['camara', 'galeria'])
  origen: 'camara' | 'galeria';

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  latitud?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  longitud?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  errorMetros?: number;
}

export class FiltrosPanelDto {
  @IsOptional() @IsIn(['pendiente', 'aprobado', 'desaprobado', 'anulado'])
  estado?: string;

  @IsOptional() @IsIn(TIPOS_REPORTE)
  tipo?: TipoReporte;

  @IsOptional() @IsDateString()
  desde?: string;

  @IsOptional() @IsDateString()
  hasta?: string;
}
