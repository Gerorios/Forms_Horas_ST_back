import { Transform, Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { parseJsonArraySeguro } from './parse-json-array-seguro';

export class UpdateCargaCombustibleDto {
  @IsOptional() @IsDateString() fechaCarga?: string;
  @IsOptional() @Type(() => Number) @IsInt() movilId?: number;
  @IsOptional() @Type(() => Number) @IsPositive() litros?: number;
  @IsOptional() @Type(() => Number) @IsPositive() monto?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) km?: number;
  @IsOptional() @IsIn(['cuenta_corriente', 'caja']) medioPago?: 'cuenta_corriente' | 'caja';
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(50) nroComprobante?: string;
  @IsOptional() @Type(() => Number) @IsInt() estacionId?: number;
  @IsOptional() @Type(() => Number) @IsInt() tipoCombustibleId?: number;
  @IsOptional() @Type(() => Number) @IsInt() provinciaId?: number;
  @IsOptional() @IsString() observaciones?: string;
  @IsOptional() @Transform(parseJsonArraySeguro)
  @IsArray() @ArrayNotEmpty() @IsInt({ each: true }) tareaIds?: number[];
}
