import { extraerKDeNombre } from './nombre-archivo';

describe('extraerKDeNombre', () => {
  it.each([
    ['CERTIFICADO AGOSTO 2026 SERTEC - K11 - Capex (Inspecciones).pdf', 'K11'],
    ['CERTIFICADOS SERTEC (K8) -agosto 26 -Opex.pdf', 'K8'],
    ['CERTIFICADO JUNIO 2026 SERTEC - K2- ODORIZACION.xlsx', 'K2'],
    ['CERTIFICADO AGRUPADO SERTEC ADECUACION CAPEX-1JUL31JUL ..xlsm', null],
    ['k 5 algo.pdf', 'K5'],
  ])('%s -> %s', (nombre, esperado) => {
    expect(extraerKDeNombre(nombre)).toBe(esperado);
  });
});
