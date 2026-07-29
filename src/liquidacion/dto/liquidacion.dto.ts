import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateCategoriaUocraDto {
  @IsString()
  nombre: string;
}

export class UpdateCategoriaUocraDto {
  @IsOptional()
  @IsString()
  nombre?: string;
}

export class UpsertPerfilLiquidacionDto {
  @IsIn(['jornalizado', 'fijo', 'mensualizado', 'por_tantos', 'administrativo'])
  regimen: 'jornalizado' | 'fijo' | 'mensualizado' | 'por_tantos' | 'administrativo';

  @IsOptional()
  @IsInt()
  categoriaUocraId?: number;

  /** Cómo cobra las horas extras y presentismo juntos: en B (sin descuentos) o con descuentos. */
  @IsOptional()
  @IsIn(['en_b', 'con_descuentos'])
  modalidadPago?: 'en_b' | 'con_descuentos';
}

export class UpsertPerfilesMasivoDto extends UpsertPerfilLiquidacionDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  cuils: string[];
}

// ---- Ronda mensual de tarifas (ver ADR-010 y ADR-011) ----

export class CategoriaPrecioDto {
  @IsInt()
  categoriaUocraId: number;

  @IsNumber()
  importeHora: number;
}

export class TipoNovedadMontoDto {
  @IsInt()
  tipoNovedadId: number;

  @IsNumber()
  montoPorDia: number;
}

export class RangoKmDto {
  @IsNumber()
  kmDesde: number;

  @IsOptional()
  @IsNumber()
  kmHasta?: number;

  @IsNumber()
  precioPorKm: number;
}

export class BonoNoRemunerativoDto {
  @IsInt()
  categoriaUocraId: number;

  @IsIn(['monto_fijo', 'porcentaje'])
  tipo: 'monto_fijo' | 'porcentaje';

  @IsNumber()
  valor: number;
}

export class CargarRondaTarifasDto {
  @IsInt()
  @Min(1)
  @Max(12)
  mes: number;

  @IsInt()
  anio: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoriaPrecioDto)
  categorias: CategoriaPrecioDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TipoNovedadMontoDto)
  tiposNovedad: TipoNovedadMontoDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RangoKmDto)
  rangosKm: RangoKmDto[];

  /** Opcional: 0 o ninguno si UOCRA no anunció nada ese mes. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BonoNoRemunerativoDto)
  bonosNoRemunerativos?: BonoNoRemunerativoDto[];
}

// ---- Datos variables por quincena (mensualizado / por tantos) — ver ADR-011 ----

export class QuincenaParamsDto {
  @IsInt()
  anio: number;

  @IsInt()
  @Min(1)
  @Max(12)
  mes: number;

  @IsInt()
  @Min(1)
  @Max(2)
  quincena: number;
}

export class MontoMensualizadoItemDto {
  @IsString()
  cuil: string;

  @IsNumber()
  monto: number;
}

export class CargarMontosMensualizadosDto extends QuincenaParamsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MontoMensualizadoItemDto)
  montos: MontoMensualizadoItemDto[];
}

export class KmPorTantosItemDto {
  @IsString()
  cuil: string;

  @IsNumber()
  kmTotal: number;
}

export class CargarKmPorTantosDto extends QuincenaParamsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KmPorTantosItemDto)
  kms: KmPorTantosItemDto[];
}
