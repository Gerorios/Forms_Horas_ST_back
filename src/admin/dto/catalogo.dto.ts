import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

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

/** Recorta los extremos antes de validar, para que un identificador de puros
 * espacios no pase el IsNotEmpty. No toca el resto: el identificador se guarda
 * tal cual se escribe, porque no siempre es una patente ("TACHO PAÑOL", "S/N"). */
const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateMovilDto {
  // Sin identificador la fila no sirve: no se puede elegir en una carga de
  // horas ni matchear contra un ticket de combustible.
  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  identificador: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}

export class UpdateMovilDto {
  // Puede no venir (se edita solo la descripción), pero si viene no puede
  // quedar vacío: sería dejar huérfano un móvil ya en uso.
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @IsNotEmpty()
  identificador?: string;

  @IsOptional()
  @IsString()
  descripcion?: string;
}

export class CrearMovilesMasivoDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  identificadores: string[];
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
