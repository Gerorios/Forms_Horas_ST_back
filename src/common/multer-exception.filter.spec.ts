import { HttpStatus } from '@nestjs/common';
import { MulterError } from 'multer';
import { MulterExceptionFilter } from './multer-exception.filter';

function crearHostMock(url: string) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const req = { url };
  const res = { status };
  const host = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as any;
  return { host, status, json };
}

describe('MulterExceptionFilter', () => {
  const filter = new MulterExceptionFilter();

  it('LIMIT_FILE_SIZE en /certificaciones/carga/preview usa el mensaje de 20 MB', () => {
    const { host, status, json } = crearHostMock('/certificaciones/carga/preview');
    const error = new MulterError('LIMIT_FILE_SIZE');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      message: 'El archivo supera el máximo permitido (20 MB). Achicá el Excel/PDF o dividilo en partes más chicas.',
      error: 'Bad Request',
    });
  });

  it('LIMIT_FILE_SIZE en /novedades (u otra ruta sin regla propia) usa el mensaje default de fotos', () => {
    const { host, status, json } = crearHostMock('/novedades');
    const error = new MulterError('LIMIT_FILE_SIZE');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      message: 'El archivo supera el máximo permitido (10 MB). Sacá la foto con menos calidad o subí un PDF más liviano.',
      error: 'Bad Request',
    });
  });

  it('LIMIT_FILE_SIZE en /cargas-combustible (default) también conserva el mensaje de fotos', () => {
    const { host, status, json } = crearHostMock('/cargas-combustible');
    const error = new MulterError('LIMIT_FILE_SIZE');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(json.mock.calls[0][0].message).toBe(
      'El archivo supera el máximo permitido (10 MB). Sacá la foto con menos calidad o subí un PDF más liviano.',
    );
  });

  it('LIMIT_FILE_COUNT/LIMIT_UNEXPECTED_FILE devuelven 400 sin depender de la ruta', () => {
    const { host, status, json } = crearHostMock('/certificaciones/carga/preview');
    const error = new MulterError('LIMIT_UNEXPECTED_FILE');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0].message).toBe(
      'Se envió más de un archivo o con un nombre de campo inesperado. Adjuntá un solo archivo.',
    );
  });

  it('cualquier otro código de multer cae al 400 genérico con el código incluido', () => {
    const { host, status, json } = crearHostMock('/novedades');
    const error = new MulterError('LIMIT_FIELD_COUNT');

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0].message).toContain('LIMIT_FIELD_COUNT');
  });
});
