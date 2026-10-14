import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

/** Query params del panel Control general (ADR-030). El período se valida
 * entero en `resolverPeriodo` (año+mes con quincena opcional, o desde/hasta);
 * los filtros llegan como listas separadas por coma. */
export class PanelQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() anio?: number;
  @IsOptional() @Type(() => Number) @IsInt() mes?: number;
  @IsOptional() @Type(() => Number) @IsInt() quincena?: number;
  @IsOptional() @IsString() desde?: string;
  @IsOptional() @IsString() hasta?: string;
  @IsOptional() @IsString() contratoIds?: string;
  @IsOptional() @IsString() provinciaIds?: string;
  @IsOptional() @IsString() tareaIds?: string;
  @IsOptional() @IsString() operarioCuils?: string;
}
