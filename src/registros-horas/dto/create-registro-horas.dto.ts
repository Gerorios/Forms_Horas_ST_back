import { IsDateString, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateRegistroHorasDto {
  @IsDateString()
  fecha: string;

  @IsString()
  operarioCuil: string;

  @IsInt()
  contratoId: number;

  @IsInt()
  tareaId: number;

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
}
