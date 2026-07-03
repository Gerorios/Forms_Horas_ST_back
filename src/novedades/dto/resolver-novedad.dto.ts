import { IsEnum } from 'class-validator';

export class ResolverNovedadDto {
  @IsEnum(['aprobada', 'desaprobada'])
  estadoHys: 'aprobada' | 'desaprobada';
}
