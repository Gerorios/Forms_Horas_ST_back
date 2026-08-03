import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateContratoDto {
  @IsString()
  codigo: string;

  @IsString()
  nombre: string;
}

export class UpdateContratoDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  /**
   * Reemplaza el set COMPLETO de Jefes de Contrato de este contrato (M:N, ver
   * ADR-012). `[]` lo deja sin jefes; `undefined` no toca la relación.
   */
  @IsOptional()
  @IsString({ each: true })
  jefesCuils?: string[];
}
