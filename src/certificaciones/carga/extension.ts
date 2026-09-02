import { BadRequestException } from '@nestjs/common';

/**
 * Ruteo del archivo subido en /certificaciones/carga/preview según su
 * extensión (brief T5). Función pura para poder testear el ruteo sin pasar
 * por multer/Nest. Lanza BadRequestException (no un Error genérico) porque
 * el controller la llama directo y deja que el ExceptionFilter de Nest la
 * traduzca — mismo criterio que el resto del módulo (ver CargaService).
 */
export function elegirTipoArchivo(nombreArchivo: string): 'excel' | 'pdf' {
  const match = /\.[^.]+$/.exec(nombreArchivo.toLowerCase());
  const ext = match ? match[0] : '';

  if (ext === '.xlsx' || ext === '.xlsm') return 'excel';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.xls') {
    throw new BadRequestException('Formato .xls no soportado: convertí el archivo a .xlsx.');
  }
  throw new BadRequestException(
    `Formato de archivo no soportado (${ext || 'sin extensión'}). Usá .xlsx, .xlsm o .pdf.`,
  );
}
