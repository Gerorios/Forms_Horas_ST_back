import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';

export class CreateEstacionServicioDto {
  @IsString() @IsNotEmpty() @MaxLength(191) nombre: string;
  @IsOptional() @IsString() @MaxLength(191) localidad?: string;
  // CUIT solo dígitos (11); el front normaliza los guiones antes de enviar.
  @IsOptional() @Matches(/^\d{11}$/) cuit?: string;
}
export class UpdateEstacionServicioDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(191) nombre?: string;
  @IsOptional() @IsString() @MaxLength(191) localidad?: string;
  // null borra el CUIT; undefined no lo toca.
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\d{11}$/) cuit?: string | null;
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
export class GuardarAliasDto {
  @IsArray() @IsString({ each: true }) alias: string[];
}
