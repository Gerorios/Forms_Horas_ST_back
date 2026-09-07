import { parsearMontoTexto, montoANumero } from './montos';

describe('parsearMontoTexto (es-AR estricto: punto = miles, coma = decimal)', () => {
  it.each([
    ['3.840.113', '3840113'],
    ['400.012', '400012'],
    ['60.608', '60608'],
    ['254.552,96', '254552.96'],
    ['$ 22.535.209,93', '22535209.93'],
    ['22.535.210', '22535210'],
    ['677.910', '677910'],
    ['52,76', '52.76'],
    ['922', '922'],
    ['1.5', '15'], // regla estricta: el punto NUNCA es decimal
    ['-', null],
    ['', null],
    [null, null],
    ['abc', null],
  ])('%s -> %s', (entrada, esperado) => {
    expect(parsearMontoTexto(entrada)).toBe(esperado);
  });

  it('toma solo el primer bloque numérico y descarta la cola de texto', () => {
    expect(parsearMontoTexto('3.840.113 12 servicios')).toBe('3840113');
  });

  it('montoANumero devuelve number o null', () => {
    expect(montoANumero('400.012')).toBe(400012);
    expect(montoANumero('-')).toBeNull();
  });
});
