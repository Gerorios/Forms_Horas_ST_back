import { IsArray, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export class ResolverLoteDto {
  @IsEnum(['aprobado', 'desaprobado'])
  estado: 'aprobado' | 'desaprobado';

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  ids?: number[];

  @IsOptional()
  @IsString()
  motivoDesaprobacion?: string;
}
