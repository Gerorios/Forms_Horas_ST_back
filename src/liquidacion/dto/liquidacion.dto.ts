import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateCategoriaUocraDto {
  @IsString()
  nombre: string;
}

export class UpdateCategoriaUocraDto {
  @IsOptional()
  @IsString()
  nombre?: string;
}

export class CreateTarifaCategoriaDto {
  @IsInt()
  categoriaUocraId: number;

  @IsDateString()
  vigenteDesde: string;

  @IsNumber()
  importeHora: number;
}

export class CreateMontoNovedadPlusDto {
  @IsInt()
  tipoNovedadId: number;

  @IsDateString()
  vigenteDesde: string;

  @IsNumber()
  montoPorDia: number;
}

export class CreateRangoKmDto {
  @IsDateString()
  vigenteDesde: string;

  @IsNumber()
  kmDesde: number;

  @IsOptional()
  @IsNumber()
  kmHasta?: number;

  @IsNumber()
  precioPorKm: number;
}

export class UpsertPerfilLiquidacionDto {
  @IsIn(['jornalizado', 'fijo', 'por_tantos'])
  regimen: 'jornalizado' | 'fijo' | 'por_tantos';

  @IsOptional()
  @IsInt()
  categoriaUocraId?: number;

  /** Cómo cobra las horas extras: en B (sin descuentos) o con descuentos (sueldo formal). */
  @IsOptional()
  @IsIn(['en_b', 'con_descuentos'])
  modalidadHoraExtra?: 'en_b' | 'con_descuentos';
}
