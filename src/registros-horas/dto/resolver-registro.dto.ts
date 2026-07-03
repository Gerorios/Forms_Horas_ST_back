import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ResolverRegistroDto {
  @IsEnum(['aprobado', 'desaprobado'])
  estado: 'aprobado' | 'desaprobado';

  @IsOptional()
  @IsString()
  motivoDesaprobacion?: string;
}
