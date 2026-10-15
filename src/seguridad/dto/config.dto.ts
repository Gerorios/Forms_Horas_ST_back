import { IsBoolean, IsDateString, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Rango de consulta de puntos, ranking y tableros. Sin nada, el año en
 * curso (no hay períodos guardados, ADR-027 revisión 2026-10-08). */
export class RangoDto {
  @IsOptional() @IsDateString()
  desde?: string;

  @IsOptional() @IsDateString()
  hasta?: string;
}

/** Alta o edición de una naturaleza o un motivo de paralización (Admin). */
export class CatalogoDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80)
  nombre?: string;

  @IsOptional() @IsBoolean()
  activo?: boolean;
}

/** Habilitar a un usuario como inspector (HyS/Admin). */
export class InspectorDto {
  @IsString() @Matches(/^\d{11}$/, { message: 'CUIL inválido: 11 dígitos sin guiones' })
  cuil: string;
}
