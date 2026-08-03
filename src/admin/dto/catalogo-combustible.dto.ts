import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEstacionServicioDto {
  @IsString() @IsNotEmpty() @MaxLength(191) nombre: string;
  @IsOptional() @IsString() @MaxLength(191) localidad?: string;
}
export class UpdateEstacionServicioDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) nombre?: string;
  @IsOptional() @IsString() @MaxLength(191) localidad?: string;
}
export class CreateTipoCombustibleDto {
  @IsString() @IsNotEmpty() @MaxLength(191) nombre: string;
}
export class UpdateTipoCombustibleDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) nombre?: string;
}
export class ToggleActivoCombustibleDto {
  @IsBoolean() activo: boolean;
}
