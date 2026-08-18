import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ResolverNovedadDto {
  @IsEnum(['aprobada', 'desaprobada'])
  estadoHys: 'aprobada' | 'desaprobada';

  @IsOptional()
  @IsString()
  descargoHys?: string;
}
