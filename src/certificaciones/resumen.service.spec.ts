import { ForbiddenException } from '@nestjs/common';
import { ResumenService } from './resumen.service';

const lectura = { nivel: 'lectura', ks: [], inc: true };

describe('ResumenService.resumen', () => {
  const prisma = { $queryRaw: jest.fn() } as any;
  const service = new ResumenService(prisma);
  beforeEach(() => prisma.$queryRaw.mockReset());

  it('castea lineas y monto_total a number', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { periodo: '2026-08', contrato: 'K6', tipo: 'OPEX', lineas: 3n, monto_total: '150.5' },
    ]);
    expect(await service.resumen(lectura)).toEqual([
      { periodo: '2026-08', contrato: 'K6', tipo: 'OPEX', lineas: 3, monto_total: 150.5 },
    ]);
  });

  it('nivel carga con ks vacío devuelve [] sin tocar la BD (fix del IN () del portal)', async () => {
    expect(await service.resumen({ nivel: 'carga', ks: [], inc: false })).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('sin claim tira Forbidden', async () => {
    await expect(service.resumen(null)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ResumenService.presupuesto', () => {
  const prisma = { $queryRaw: jest.fn() } as any;
  const service = new ResumenService(prisma);
  beforeEach(() => prisma.$queryRaw.mockReset());

  it('nivel carga → Forbidden (el hook usePresupuesto espera este 403)', async () => {
    await expect(service.presupuesto({ nivel: 'carga', ks: ['K6'], inc: true }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('calcula pct a 1 decimal y serializa fechas YYYY-MM-DD', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      contrato: 'K6', descripcion: 'Mant.', periodo_desde: '2026-01-01',
      periodo_hasta: '2026-12-31', monto_presupuesto: '3000', consumido: '1000',
    }]);
    expect(await service.presupuesto(lectura)).toEqual([{
      contrato: 'K6', descripcion: 'Mant.', periodo_desde: '2026-01-01', periodo_hasta: '2026-12-31',
      monto_presupuesto: 3000, consumido: 1000, pct: 33.3,
    }]);
  });

  it('monto_presupuesto 0 → pct 0 (sin división por cero)', async () => {
    prisma.$queryRaw.mockResolvedValue([{
      contrato: 'K6', descripcion: 'x', periodo_desde: '2026-01-01',
      periodo_hasta: '2026-01-02', monto_presupuesto: '0', consumido: '10',
    }]);
    expect((await service.presupuesto(lectura))[0].pct).toBe(0);
  });
});
