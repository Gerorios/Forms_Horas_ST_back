import { IsArray, IsDateString, IsInt, IsNumber, IsOptional } from 'class-validator';

/**
 * Corrección de un registro (típicamente uno desaprobado): edita la misma fila,
 * la vuelve a estado pendiente y queda auditada. No anula ni crea una fila nueva.
 */
export class UpdateRegistroHorasDto {
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @IsOptional()
  @IsInt()
  contratoId?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tareaIds?: number[];

  @IsOptional()
  @IsNumber()
  horas?: number;

  @IsOptional()
  @IsInt()
  provinciaId?: number;

  @IsOptional()
  @IsNumber()
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  gpsLng?: number;

  @IsOptional()
  @IsInt({ each: true })
  movilIds?: number[];
}
