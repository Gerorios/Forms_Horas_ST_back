import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Formato aceptado en los tres campos de dinero/cantidad (`cantidades`,
 * `precio_unitario`, `total_mes`): entero con hasta 4 decimales, coma o
 * punto como separador. Rechaza notación científica ('1e3'), 'Infinity',
 * 'NaN', espacios y cualquier otra cosa que `Number()` aceptaría pero que
 * no es una cifra que una persona haya tipeado. El service normaliza la
 * coma a punto antes de guardar en la fila (ver CargaService.confirmar).
 */
const RE_CIFRA = /^\d+([.,]\d{1,4})?$/;
const msgCifra = (campo: string) => `${campo} debe ser un número (hasta 4 decimales)`;

/**
 * Body de /certificaciones/carga/preview (multipart, campos de texto junto
 * al archivo). Rango de año igual al resto del módulo de certificaciones
 * (2022 en adelante); mes 1..12.
 */
export class PreviewCargaDto {
  @Type(() => Number)
  @IsInt()
  @Min(2022)
  @Max(2100)
  periodo_anio: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodo_mes: number;
}

/**
 * Edición de UNA fila del preview, aplicada en el confirmar. SOLO estos 8
 * campos son editables (whitelist — fix B8 del portal: el navegador ya no
 * es fuente de verdad de ítem/hoja/fila_excel/etc., que viven en la sesión
 * server-side y nunca se leen del body). `@ValidationPipe({ whitelist:
 * true })` (main.ts) descarta cualquier campo extra a nivel HTTP; el
 * service, además, nunca hace spread del DTO sobre la fila — solo lee
 * estos 8 campos explícitamente, así el whitelist no depende únicamente
 * de la config global.
 *
 * CONTRATO CON EL CLIENTE (idempotencia del confirmar): cada `confirmar`
 * parte de los valores ORIGINALES del preview — el server resetea todas
 * las filas de la sesión a como las produjo el preview antes de aplicar
 * `ediciones`. Por eso el cliente manda TODAS las ediciones vigentes en
 * cada intento, no solo las nuevas: omitir un campo (o una fila entera)
 * significa "valor original", no "dejá lo del intento anterior". Así un
 * reintento después de un 422 no arrastra estado de la llamada fallida.
 */
export class EdicionFilaDto {
  @IsUUID()
  rowId: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contrato?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  provincia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(RE_CIFRA, { message: msgCifra('cantidades') })
  cantidades?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(RE_CIFRA, { message: msgCifra('total_mes') })
  total_mes?: string;

  @IsOptional()
  @IsBoolean()
  excluida?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(RE_CIFRA, { message: msgCifra('precio_unitario') })
  precio_unitario?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  item_codigo?: string;

  @IsOptional()
  @IsBoolean()
  confirmada?: boolean;
}

/**
 * Fila agregada a mano en el preview porque el parser no la reconoció
 * (origen = 'manual', decisión 8/9 de la carga controlada). A diferencia de
 * `EdicionFilaDto` no tiene `rowId` — no existe en la sesión server-side
 * hasta que se confirma la carga.
 */
export class FilaManualDto {
  @IsInt()
  @Min(1)
  id_item: number;

  @IsString()
  @MaxLength(50)
  provincia: string;

  @IsString()
  @MaxLength(30)
  @Matches(RE_CIFRA, { message: msgCifra('cantidades') })
  cantidades: string;

  @IsString()
  @MaxLength(30)
  @Matches(RE_CIFRA, { message: msgCifra('precio_unitario') })
  precio_unitario: string;

  @IsString()
  @MaxLength(30)
  @Matches(RE_CIFRA, { message: msgCifra('total_mes') })
  total_mes: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  observaciones?: string;

  @IsOptional()
  @IsBoolean()
  confirmada?: boolean;
}

export class ConfirmarCargaDto {
  @IsUUID()
  previewId: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => EdicionFilaDto)
  ediciones: EdicionFilaDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FilaManualDto)
  manuales?: FilaManualDto[];
}
