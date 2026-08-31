import { ForbiddenException } from '@nestjs/common';
import { IncidenciaService } from './incidencia.service';

const contratos = (a: { contratoId: number | null; codigo: string; monto: number }[]) =>
  a.map((c) => ({ ...c, nombre: c.codigo, horas: 0, pctDelTotal: 0 }));

describe('IncidenciaService.obtenerIncidencia', () => {
  const analisisMock = { getAnalisis: jest.fn() } as any;
  const service = new IncidenciaService(analisisMock);

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
});
