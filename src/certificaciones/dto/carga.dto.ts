import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

/**
 * Edición de UNA fila del preview, aplicada en el confirmar. SOLO estos 5
 * campos son editables (whitelist — fix B8 del portal: el navegador ya no
 * es fuente de verdad de ítem/hoja/fila_excel/etc., que viven en la sesión
 * server-side y nunca se leen del body). `@ValidationPipe({ whitelist:
 * true })` (main.ts) descarta cualquier campo extra a nivel HTTP; el
 * service, además, nunca hace spread del DTO sobre la fila — solo lee
 * estos 5 campos explícitamente, así el whitelist no depende únicamente
 * de la config global.
 */
export class EdicionFilaDto {
  @IsUUID()
  rowId: string;

  @IsOptional()
  @IsString()
  contrato?: string;

  @IsOptional()
  @IsString()
  provincia?: string;

  @IsOptional()
  @IsString()
  cantidades?: string;

  @IsOptional()
  @IsString()
  total_mes?: string;

  @IsOptional()
  @IsBoolean()
  excluida?: boolean;
}

export class ConfirmarCargaDto {
  @IsUUID()
  previewId: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => EdicionFilaDto)
  ediciones: EdicionFilaDto[];
}
