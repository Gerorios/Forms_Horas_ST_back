import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateNovedadDto {
  @IsString()
  operarioCuil: string;

  @IsInt()
  tipoNovedadId: number;

  @IsDateString()
  fechaInicio: string;

  @IsOptional()
  @IsDateString()
  fechaFin?: string;

  @IsOptional()
  @IsString()
  justificacionTexto?: string;

  @IsOptional()
  @IsString()
  adjuntoUrl?: string;
}
