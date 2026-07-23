import { IsInt, IsNumber, IsString, MinLength } from 'class-validator';

/**
 * Corrección de horas de una línea (contrato) dentro de un lote pendiente.
 * Rechaza todas las filas de esos operarios en esa línea y crea filas nuevas
 * con la hora corregida, ya aprobadas por quien corrige. Ver ADR-006.
 */
export class CorregirLoteDto {
  @IsInt()
  contratoId: number;

  @IsNumber()
  horasCorregidas: number;

  @IsString()
  @MinLength(1)
  motivo: string;
}
