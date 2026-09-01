import { IsArray, IsBoolean, IsIn, IsInt } from 'class-validator';

export class UpsertAccesoDto {
  @IsIn(['admin', 'carga', 'lectura'])
  nivel: string;

  @IsBoolean()
  verIncidencia: boolean;

  @IsArray()
  @IsInt({ each: true })
  contratoIds: number[];
}
