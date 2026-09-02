import { BadRequestException } from '@nestjs/common';
import { elegirTipoArchivo } from './extension';

describe('elegirTipoArchivo', () => {
  it('.xlsx -> excel', () => {
    expect(elegirTipoArchivo('certificacion.xlsx')).toBe('excel');
  });

  it('.xlsm -> excel', () => {
    expect(elegirTipoArchivo('CERTIFICACION.XLSM')).toBe('excel');
  });

  it('.pdf -> pdf', () => {
    expect(elegirTipoArchivo('certificacion.pdf')).toBe('pdf');
  });

  it('.xls rechaza con mensaje de conversión', () => {
    expect(() => elegirTipoArchivo('viejo.xls')).toThrow(BadRequestException);
    try {
      elegirTipoArchivo('viejo.xls');
      fail('debía lanzar');
    } catch (e) {
      expect((e as BadRequestException).message).toBe(
        'Formato .xls no soportado: convertí el archivo a .xlsx.',
      );
    }
  });

  it('extensión desconocida rechaza con 400', () => {
    expect(() => elegirTipoArchivo('documento.docx')).toThrow(BadRequestException);
  });

  it('sin extensión rechaza con 400', () => {
    expect(() => elegirTipoArchivo('archivo')).toThrow(BadRequestException);
  });
});
