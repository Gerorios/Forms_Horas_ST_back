import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Período de medición que define HyS ("2º semestre 2026"). */
export class PeriodoDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  nombre: string;

  @IsDateString()
  desde: string;

  @IsDateString()
  hasta: string;
}

/** Rango de consulta: un período guardado, o desde/hasta libres (solo el
 * panel de HyS). Sin nada, el período actual. */
export class RangoDto {
  @IsOptional() @Type(() => Number) @IsInt()
  periodoId?: number;

  @IsOptional() @IsDateString()
  desde?: string;

  @IsOptional() @IsDateString()
  hasta?: string;
}

/** Alta o edición de una naturaleza o un motivo de paralización (Admin). */
export class CatalogoDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80)
  nombre?: string;

  @IsOptional() @IsBoolean()
  activo?: boolean;
}
