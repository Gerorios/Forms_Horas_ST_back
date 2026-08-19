import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';
import type { Response } from 'express';

/**
 * Sin este filtro, un archivo demasiado grande llega al usuario como un 500
 * "Internal server error" sin explicación (multer lanza MulterError, que Nest
 * no sabe traducir). Acá se convierte en un mensaje claro y accionable
 * (revisión 2026-08-19: "informar siempre al usuario lo que el sistema hace").
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, mensaje } = this.traducir(error);
    res.status(status).json({ statusCode: status, message: mensaje, error: 'Bad Request' });
  }

  private traducir(error: MulterError): { status: number; mensaje: string } {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return {
          status: HttpStatus.PAYLOAD_TOO_LARGE,
          mensaje: 'El archivo supera el máximo permitido (10 MB). Sacá la foto con menos calidad o subí un PDF más liviano.',
        };
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return {
          status: HttpStatus.BAD_REQUEST,
          mensaje: 'Se envió más de un archivo o con un nombre de campo inesperado. Adjuntá un solo archivo.',
        };
      default:
        return {
          status: HttpStatus.BAD_REQUEST,
          mensaje: `No se pudo procesar el archivo adjunto (${error.code}). Probá de nuevo con otro archivo.`,
        };
    }
  }
}
