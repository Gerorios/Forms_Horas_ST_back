import { avisoKNombre, avisoPeriodo } from './avisos';

describe('avisoKNombre', () => {
  it('K11 en el nombre, K2 resuelto → aviso suave con texto de acción', () => {
    const a = avisoKNombre('K11', ['K2'], 'k11.pdf');
    expect(a).toEqual({
      tipo: 'k_nombre_archivo',
      hoja: 'k11.pdf',
      fila: 0,
      fuerte: false,
      mensaje:
        'El nombre del archivo dice K11 y las filas se resolvieron en K2. Si la plata va a K11, cambiá el contrato en las filas.',
    });
  });
  it('K8 en el nombre y entre los resueltos → sin aviso', () =>
    expect(avisoKNombre('K8', ['K8', 'K5'], 'x')).toBeNull());
  it('sin K en el nombre → sin aviso', () => expect(avisoKNombre(null, ['K8'], 'x')).toBeNull());
});

describe('avisoPeriodo', () => {
  it('período del archivo agosto, elegido agosto → null', () => {
    expect(avisoPeriodo({ desde: '2026-08-01', hasta: '2026-08-30' }, 2026, 8, 'x')).toBeNull();
  });
  it('período del archivo julio, elegido agosto → aviso FUERTE', () => {
    const a = avisoPeriodo({ desde: '2026-07-01', hasta: '2026-07-31' }, 2026, 8, 'x');
    expect(a?.fuerte).toBe(true);
    expect(a?.mensaje).toBe(
      'El archivo dice período 1/7/2026 a 31/7/2026 y elegiste agosto 2026. Revisá el mes antes de confirmar.',
    );
  });
  it('sin período en el archivo → null', () => expect(avisoPeriodo(null, 2026, 8, 'x')).toBeNull());
});
