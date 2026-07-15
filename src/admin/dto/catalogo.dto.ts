import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateTareaDto {
  @IsInt()
  contratoId: number;

  @IsString()
  nombre: string;
}

export class UpdateTareaDto {
  @IsOptional()
  @IsInt()
  contratoId?: number;

  @IsOptional()
  @IsString()
  nombre?: string;
}

export class CreateMovilDto {
  @IsString()
  identificador: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}

export class UpdateMovilDto {
  @IsOptional()
  @IsString()
  identificador?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}

export class CreateProvinciaDto {
  @IsString()
  nombre: string;
}

export class UpdateProvinciaDto {
  @IsOptional()
  @IsString()
  nombre?: string;
}

export class CreateTipoNovedadDto {
  @IsString()
  nombre: string;

  @IsOptional()
  @IsBoolean()
  requiereAprobacionHys?: boolean;

  @IsOptional()
  @IsBoolean()
  generaPlus?: boolean;
}

export class UpdateTipoNovedadDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  requiereAprobacionHys?: boolean;

  @IsOptional()
  @IsBoolean()
  generaPlus?: boolean;
}

export class ToggleActivoDto {
  @IsBoolean()
  activo: boolean;
}
