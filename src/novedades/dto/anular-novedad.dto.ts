import { IsNotEmpty, IsString } from 'class-validator';

export class AnularNovedadDto {
  @IsString() @IsNotEmpty() motivo: string;
}
