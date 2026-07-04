import { ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUsuarioDto {
  @IsString()
  cuil: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsInt()
  rolId: number;

  @IsOptional()
  @IsInt({ each: true })
  contratosIds?: number[];
}

export class UpdateUsuarioDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsInt()
  rolId?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  @IsOptional()
  @IsInt({ each: true })
  contratosIds?: number[];
}

export class CrearUsuariosMasivoDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  cuils: string[];
}
