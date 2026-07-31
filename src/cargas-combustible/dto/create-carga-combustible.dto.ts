import { Transform, Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class CreateCargaCombustibleDto {
  @IsDateString() fechaCarga: string;
  @Type(() => Number) @IsInt() movilId: number;
  @Type(() => Number) @IsPositive() litros: number;
  @Type(() => Number) @IsPositive() monto: number;
  @Type(() => Number) @IsInt() @Min(0) km: number;
  @IsIn(['cuenta_corriente', 'caja']) medioPago: 'cuenta_corriente' | 'caja';
  @IsString() @IsNotEmpty() @MaxLength(50) nroComprobante: string;
  @Type(() => Number) @IsInt() estacionId: number;
  @Type(() => Number) @IsInt() tipoCombustibleId: number;
  @Type(() => Number) @IsInt() provinciaId: number;
  @IsOptional() @IsString() observaciones?: string;
  @Transform(({ value }) => (typeof value === 'string' ? JSON.parse(value) : value))
  @IsArray() @ArrayNotEmpty() @IsInt({ each: true }) tareaIds: number[];
}
