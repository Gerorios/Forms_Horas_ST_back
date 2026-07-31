import { IsNotEmpty, IsString } from 'class-validator';

export class AnularCargaDto {
  @IsString() @IsNotEmpty() motivo: string;
}
