import { ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUsuarioDto {
  @IsString()
  cuil: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsInt()
  rolId: number;

  /** Nombre cargado a mano para usuarios sin fila en snuempleados (ver ADR-008). */
  @IsOptional()
  @IsString()
  nombreFueraNomina?: string;

  @IsOptional()
  @IsInt({ each: true })
  contratosIds?: number[];

  /** Contratos de los que este usuario es Jefe de Contrato (aprueba/desaprueba). */
  @IsOptional()
  @IsInt({ each: true })
  contratosJefeIds?: number[];

  /** Tipos de novedad que puede cargar (solo aplica hoy a JefeCuadrilla; ver ADR-007). */
  @IsOptional()
  @IsInt({ each: true })
  tiposNovedadIds?: number[];

  /** Habilita la carga de km "por tantos" (solo tiene sentido para JefeContrato; ver ADR-014). */
  @IsOptional()
  @IsBoolean()
  puedeCargarKmPorTantos?: boolean;
}

export class UpdateUsuarioDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsInt()
  rolId?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;

  /** Nombre cargado a mano para usuarios sin fila en snuempleados (ver ADR-008). */
  @IsOptional()
  @IsString()
  nombreFueraNomina?: string;

  @IsOptional()
  @IsInt({ each: true })
  contratosIds?: number[];

  /** Contratos de los que este usuario es Jefe de Contrato (aprueba/desaprueba). */
  @IsOptional()
  @IsInt({ each: true })
  contratosJefeIds?: number[];

  /** Tipos de novedad que puede cargar (solo aplica hoy a JefeCuadrilla; ver ADR-007). */
  @IsOptional()
  @IsInt({ each: true })
  tiposNovedadIds?: number[];

  /** Habilita la carga de km "por tantos" (solo tiene sentido para JefeContrato; ver ADR-014). */
  @IsOptional()
  @IsBoolean()
  puedeCargarKmPorTantos?: boolean;
}

export class CrearUsuariosMasivoDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  cuils: string[];
}
