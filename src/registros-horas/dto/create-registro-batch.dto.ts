import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class LineaRegistroDto {
  @IsInt()
  contratoId: number;

  @IsNumber()
  horas: number;

  // Varias tareas del maestro por línea (sin horas por tarea). Ver ADR-002.
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  tareaIds: number[];
}

/**
 * Carga masiva: una carga produce (N operarios × M líneas) filas atómicas.
 * fecha, provincia, GPS y móviles son compartidos por toda la carga.
 */
export class CreateRegistroBatchDto {
  @IsDateString()
  fecha: string;

  @IsInt()
  provinciaId: number;

  @IsOptional()
  @IsNumber()
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  gpsLng?: number;

  @IsOptional()
  @IsInt({ each: true })
  movilIds?: number[];

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  operarioCuils: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => LineaRegistroDto)
  lineas: LineaRegistroDto[];
}
