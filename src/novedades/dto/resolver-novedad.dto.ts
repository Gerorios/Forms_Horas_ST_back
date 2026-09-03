import { IsBoolean, IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';

export class ResolverNovedadDto {
  @IsEnum(['aprobada', 'desaprobada'])
  estadoHys: 'aprobada' | 'desaprobada';

  @IsOptional()
  @IsString()
  descargoHys?: string;

  // Obligatorio solo al justificar (ADR-022): sin default, HyS debe elegir
  // explícitamente si esa ausencia puntual pierde presentismo pese a estar
  // justificada. No se usa (ni se guarda) para 'desaprobada' — esa siempre
  // pierde presentismo, ver CalculoService.
  @ValidateIf((dto: ResolverNovedadDto) => dto.estadoHys === 'aprobada')
  @IsBoolean()
  pierdePresentismoHys: boolean;
}
