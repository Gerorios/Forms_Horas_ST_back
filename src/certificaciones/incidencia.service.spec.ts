import { ForbiddenException } from '@nestjs/common';
import { IncidenciaService } from './incidencia.service';

const contratos = (a: { contratoId: number | null; codigo: string; monto: number }[]) =>
  a.map((c) => ({ ...c, nombre: c.codigo, horas: 0, pctDelTotal: 0 }));

describe('IncidenciaService.obtenerIncidencia', () => {
  const analisisMock = { getAnalisis: jest.fn() } as any;
  const service = new IncidenciaService(analisisMock);

  // Fija "hoy" dentro de agosto 2026 para que (2026, 8) sea el mes corriente
  // y nunca se cachee: los tests reutilizan ese mismo período con distintos
  // mocks, y el cache de meses cerrados (ver obtenerSerie) rompería eso si
  // la fecha real del sistema avanza más allá de agosto.
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-15'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    analisisMock.getAnalisis.mockReset();
    analisisMock.getAnalisis.mockImplementation((_anio: number, _mes: number, quincena: number) => {
      if (quincena === 1) {
        return Promise.resolve({
          contratos: contratos([
            { contratoId: 1, codigo: 'K6', monto: 100 },
            { contratoId: 2, codigo: 'K9', monto: 30 },
            { contratoId: null, codigo: 'Sin contrato asignable', monto: 10 },
          ]),
        });
      }
      return Promise.resolve({
        contratos: contratos([
          { contratoId: 1, codigo: 'K6', monto: 50 },
          { contratoId: 2, codigo: 'K9', monto: 0 },
          { contratoId: null, codigo: 'Sin contrato asignable', monto: 5 },
        ]),
      });
    });
  });

  it('suma quincena 1 + quincena 2 por código (admin ve todo)', async () => {
    const resultado = await service.obtenerIncidencia(2026, 8, { nivel: 'admin', ks: [], inc: false });

    expect(resultado.contratos).toEqual(
      expect.arrayContaining([
        { codigo: 'K6', montoMo: 150 },
        { codigo: 'K9', montoMo: 30 },
      ]),
    );
    expect(resultado.contratos).toHaveLength(2);
    expect(analisisMock.getAnalisis).toHaveBeenCalledWith(2026, 8, 1);
    expect(analisisMock.getAnalisis).toHaveBeenCalledWith(2026, 8, 2);
  });

  it('carga con inc:true ve solo sus ks y sinAsignar null', async () => {
    const resultado = await service.obtenerIncidencia(2026, 8, { nivel: 'carga', ks: ['K6'], inc: true });

    expect(resultado).toEqual({ contratos: [{ codigo: 'K6', montoMo: 150 }], sinAsignar: null });
  });

  it('admin ve todos los K y sinAsignar con el monto del bucket', async () => {
    const resultado = await service.obtenerIncidencia(2026, 8, { nivel: 'admin', ks: [], inc: false });

    expect(resultado.sinAsignar).toBe(15);
  });

  it('lectura ve todos los K y sinAsignar con el monto del bucket', async () => {
    const resultado = await service.obtenerIncidencia(2026, 8, { nivel: 'lectura', ks: [], inc: false });

    expect(resultado.sinAsignar).toBe(15);
    expect(resultado.contratos).toHaveLength(2);
  });

  it('carga con inc:false lanza ForbiddenException', async () => {
    await expect(
      service.obtenerIncidencia(2026, 8, { nivel: 'carga', ks: ['K6'], inc: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(analisisMock.getAnalisis).not.toHaveBeenCalled();
  });

  it('cert null lanza ForbiddenException', async () => {
    await expect(service.obtenerIncidencia(2026, 8, null)).rejects.toBeInstanceOf(ForbiddenException);
    expect(analisisMock.getAnalisis).not.toHaveBeenCalled();
  });

  it('redondea la suma de floats a 2 decimales (evita restos de precisión binaria)', async () => {
    analisisMock.getAnalisis.mockImplementation((_anio: number, _mes: number, quincena: number) => {
      if (quincena === 1) {
        return Promise.resolve({
          contratos: contratos([
            { contratoId: 1, codigo: 'K6', monto: 1.1 },
            { contratoId: null, codigo: 'Sin contrato asignable', monto: 1.1 },
          ]),
        });
      }
      return Promise.resolve({
        contratos: contratos([
          { contratoId: 1, codigo: 'K6', monto: 2.2 },
          { contratoId: null, codigo: 'Sin contrato asignable', monto: 2.2 },
        ]),
      });
    });

    const resultado = await service.obtenerIncidencia(2026, 8, { nivel: 'admin', ks: [], inc: false });

    expect(1.1 + 2.2).not.toBe(3.3); // documenta el problema de precisión que motiva el redondeo
    expect(resultado.contratos).toEqual([{ codigo: 'K6', montoMo: 3.3 }]);
    expect(resultado.sinAsignar).toBe(3.3);
  });
});

describe('IncidenciaService.obtenerSerie', () => {
  const CERT_ADMIN = { nivel: 'admin', ks: [] as string[], inc: true };
  const analisisMock = { getAnalisis: jest.fn() } as any;
  const service = new IncidenciaService(analisisMock);

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-15'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    analisisMock.getAnalisis.mockReset();
    analisisMock.getAnalisis.mockImplementation((_anio: number, _mes: number, _quincena: number) => {
      return Promise.resolve({
        contratos: contratos([{ contratoId: 1, codigo: 'K6', monto: 10 }]),
      });
    });
  });

  it('devuelve N meses en orden cronológico terminando en (anio, mes)', async () => {
    const serie = await service.obtenerSerie(2026, 8, 3, CERT_ADMIN);
    expect(serie.map((m) => `${m.anio}-${m.mes}`)).toEqual(['2026-6', '2026-7', '2026-8']);
    expect(serie[2].contratos).toEqual([{ codigo: 'K6', montoMo: 20 }]); // 10 + 10 quincenas
  });

  it('cruza el límite de año hacia atrás', async () => {
    const serie = await service.obtenerSerie(2026, 1, 3, CERT_ADMIN);
    expect(serie.map((m) => `${m.anio}-${m.mes}`)).toEqual(['2025-11', '2025-12', '2026-1']);
  });

  it('cachea meses cerrados: dos llamadas no recalculan meses pasados', async () => {
    await service.obtenerSerie(2026, 8, 2, CERT_ADMIN); // calcula jul y ago
    const llamadasTrasPrimera = analisisMock.getAnalisis.mock.calls.length;
    await service.obtenerSerie(2026, 8, 2, CERT_ADMIN);
    // solo el mes corriente (2026,8) se recalcula: +2 llamadas (q1 y q2), no +4
    expect(analisisMock.getAnalisis.mock.calls.length).toBe(llamadasTrasPrimera + 2);
  });

  it('aplica visibilidad por claim en cada mes (carga: sus ks, sinAsignar null)', async () => {
    const serie = await service.obtenerSerie(2026, 8, 2, { nivel: 'carga', ks: ['K6'], inc: true });
    for (const m of serie) {
      expect(m.sinAsignar).toBeNull();
      expect(m.contratos.every((c) => c.codigo === 'K6')).toBe(true);
    }
  });

  it('sin acceso lanza Forbidden y meses se acota a 1..24', async () => {
    await expect(service.obtenerSerie(2026, 8, 12, null)).rejects.toBeInstanceOf(ForbiddenException);
    const serie = await service.obtenerSerie(2026, 8, 99, CERT_ADMIN);
    expect(serie.length).toBe(24);
  });
});
