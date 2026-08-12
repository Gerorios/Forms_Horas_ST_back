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

  /**
   * Contratos de imputación para el Análisis (solo regímenes mensualizado/
   * fijo/por_tantos). Presente = reemplaza el set completo; ausente = no
   * tocar. El upsert masivo NO usa este campo (addendum plan 2026-08-12).
   */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  contratosImputacionIds?: number[];
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

// ---- Edición de rondas ya cargadas (amendment 2026-08-04 al ADR-010) ----

export class EditarRondaTarifasDto {
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

  /** Opcional: una categoría ausente acá que antes tenía bono se elimina. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BonoNoRemunerativoDto)
  bonosNoRemunerativos?: BonoNoRemunerativoDto[];
}

// ---- Datos variables por quincena (por tantos) — ver ADR-011 ----

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

// ---- Sueldos mensualizados (vigentes, versionados por mes — ver ADR-016) ----

export class SueldoMensualizadoItemDto {
  @IsString()
  cuil: string;

  @IsNumber()
  monto: number;
}

export class GuardarSueldosMensualizadosDto {
  @IsInt()
  @Min(1)
  @Max(12)
  mes: number;

  @IsInt()
  anio: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SueldoMensualizadoItemDto)
  sueldos: SueldoMensualizadoItemDto[];
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
