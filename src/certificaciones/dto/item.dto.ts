import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CrearItemDto {
  @IsString() @IsNotEmpty() @MaxLength(20) item_codigo: string;
  @IsString() @IsNotEmpty() codigo_k: string;
  @IsString() @IsNotEmpty() @MaxLength(500) tarea: string; // NOT NULL en la BD (fix #7)
  @IsOptional() @IsString() @MaxLength(100) grupo?: string | null;
  @IsOptional() @IsString() @MaxLength(200) subgrupo?: string | null;
  @IsOptional() @IsString() @MaxLength(20) frecuencia?: string | null;
  @IsOptional() @IsString() @MaxLength(60) contratista?: string | null;
  @IsOptional() @IsNumber() ptos_gasnor?: number | null;
  @IsOptional() @IsString() @MaxLength(20) unidad_medida?: string | null;
  @IsOptional() @IsIn(['OPEX', 'CAPEX']) tipo?: string | null;
  @IsOptional() @IsString() @MaxLength(300) contrato_nombre?: string | null;
}

// PATCH semántico real (fix #2): ausente = no tocar; null = borrar.
// item_codigo NO está (inmutable, paridad con el portal — el desempate del
// parser usa id_item). tarea editable pero NO nullable (columna NOT NULL).
export class ActualizarItemDto {
  @IsOptional() @IsString() @IsNotEmpty() codigo_k?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) tarea?: string;
  @IsOptional() @IsString() @MaxLength(100) grupo?: string | null;
  @IsOptional() @IsString() @MaxLength(200) subgrupo?: string | null;
  @IsOptional() @IsString() @MaxLength(20) frecuencia?: string | null;
  @IsOptional() @IsString() @MaxLength(60) contratista?: string | null;
  @IsOptional() @IsNumber() ptos_gasnor?: number | null;
  @IsOptional() @IsString() @MaxLength(20) unidad_medida?: string | null;
  @IsOptional() @IsIn(['OPEX', 'CAPEX']) tipo?: string | null;
  @IsOptional() @IsString() @MaxLength(300) contrato_nombre?: string | null;
}
