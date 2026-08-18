import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

// multipart/form-data (ver NovedadesController#update). Todos los campos son
// opcionales: solo se aplican los provistos. Editar una novedad ya resuelta
// por HyS la vuelve a `pendiente` (ver NovedadesService#update).
export class UpdateNovedadDto {
  @IsOptional()
  @IsString()
  operarioCuil?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  tipoNovedadId?: number;

  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @IsString()
  justificacionTexto?: string;
}
