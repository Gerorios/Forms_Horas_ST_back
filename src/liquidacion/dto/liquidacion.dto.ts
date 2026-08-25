import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
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
  @IsIn(['jornalizado', 'fijo', 'fijo_105', 'mensualizado', 'por_tantos', 'administrativo'])
  regimen: 'jornalizado' | 'fijo' | 'fijo_105' | 'mensualizado' | 'por_tantos' | 'administrativo';

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

  /** Solo aplica con regimen='mensualizado': además del monto fijo, cobra horas extra sobre lo declarado (ver ADR-017). */
  @IsOptional()
  @IsBoolean()
  permiteHorasExtra?: boolean;
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

export class CategoriasPeriodoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoriaPrecioDto)
  categorias: CategoriaPrecioDto[];
}

export class BonosPeriodoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BonoNoRemunerativoDto)
  bonos: BonoNoRemunerativoDto[];
}

export class NovedadesPlusPeriodoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TipoNovedadMontoDto)
  tiposNovedad: TipoNovedadMontoDto[];
}

export class RangosKmPeriodoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RangoKmDto)
  rangosKm: RangoKmDto[];
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

// ---- Plus individual (ver ADR-018): monto puntual por empleado/quincena,
// con motivo — independiente de categoría, no versionado por período. ----

export class CargarPlusIndividualDto extends QuincenaParamsDto {
  @IsString()
  cuil: string;

  @IsNumber()
  monto: number;

  @IsString()
  motivo: string;
}
