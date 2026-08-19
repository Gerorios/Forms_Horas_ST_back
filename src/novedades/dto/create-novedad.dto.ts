import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString } from 'class-validator';

// multipart/form-data (ver NovedadesController#create): el adjunto llega como
// archivo (@UploadedFile), nunca como URL — adjuntoUrl se calcula en el
// servidor a partir del archivo subido.
export class CreateNovedadDto {
  @IsString()
  operarioCuil: string;

  @Type(() => Number)
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
}
