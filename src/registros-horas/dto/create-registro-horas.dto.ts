import { ArrayNotEmpty, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateRegistroHorasDto {
  @IsDateString()
  fecha: string;

  @IsString()
  operarioCuil: string;

  @IsInt()
  contratoId: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  tareaIds: number[];

  @IsNumber()
  horas: number;

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

  @IsOptional()
  @IsString()
  observacion?: string;
}
