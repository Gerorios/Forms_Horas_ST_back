import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';
import type { Request, Response } from 'express';

/**
 * Sin este filtro, un archivo demasiado grande llega al usuario como un 500
 * "Internal server error" sin explicación (multer lanza MulterError, que Nest
 * no sabe traducir). Acá se convierte en un mensaje claro y accionable
 * (revisión 2026-08-19: "informar siempre al usuario lo que el sistema hace").
 *
 * El mensaje de LIMIT_FILE_SIZE es el único que varía por endpoint (cada
 * multipart tiene su propio límite y su propio tipo de archivo esperado).
 * Se resuelve por PREFIJO de `request.url` contra `LIMITE_ARCHIVO_POR_RUTA`;
 * si ninguna entrada matchea, cae al mensaje histórico de `novedades`
 * (adjunto de fotos) para no romper ese endpoint ni el de
 * `cargas-combustible`, que comparten el default.
 */
const LIMITE_ARCHIVO_POR_RUTA: { prefijo: string; mensaje: string }[] = [
  {
    prefijo: '/certificaciones/carga/preview',
    mensaje: 'El archivo supera el máximo permitido (20 MB). Achicá el Excel/PDF o dividilo en partes más chicas.',
  },
];

const MENSAJE_LIMIT_FILE_SIZE_DEFAULT =
  'El archivo supera el máximo permitido (10 MB). Sacá la foto con menos calidad o subí un PDF más liviano.';

@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    const { status, mensaje } = this.traducir(error, req?.url ?? '');
    res.status(status).json({ statusCode: status, message: mensaje, error: 'Bad Request' });
  }

  private traducir(error: MulterError, url: string): { status: number; mensaje: string } {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return {
          status: HttpStatus.PAYLOAD_TOO_LARGE,
          mensaje: this.mensajeLimiteTamanio(url),
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

  private mensajeLimiteTamanio(url: string): string {
    const especifico = LIMITE_ARCHIVO_POR_RUTA.find((r) => url.startsWith(r.prefijo));
    return especifico?.mensaje ?? MENSAJE_LIMIT_FILE_SIZE_DEFAULT;
  }
}
