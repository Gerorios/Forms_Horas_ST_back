import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional } from 'class-validator';

export class FiltroCargasDto {
  @IsOptional() @IsDateString() desde?: string;
  @IsOptional() @IsDateString() hasta?: string;
  @IsOptional() @Type(() => Number) @IsInt() movilId?: number;
  @IsOptional() @IsIn(['activa', 'anulada']) estado?: 'activa' | 'anulada';
}
