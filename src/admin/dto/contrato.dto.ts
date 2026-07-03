import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateContratoDto {
  @IsString()
  codigo: string;

  @IsString()
  nombre: string;

  @IsOptional()
  @IsString()
  jefeContratoCuil?: string;
}

export class UpdateContratoDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  jefeContratoCuil?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
