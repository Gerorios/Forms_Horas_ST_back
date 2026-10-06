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
  // pierde presentismo, ver CalculoService. Es obligatorio solo para
  // Ausencia: confirmar una Baja de Operario (ADR-026) no lo lleva, por eso
  // la obligatoriedad se valida en el servicio, que conoce el tipo.
  @ValidateIf((dto: ResolverNovedadDto) => dto.estadoHys === 'aprobada' && dto.pierdePresentismoHys !== undefined)
  @IsBoolean()
  pierdePresentismoHys?: boolean;
}
