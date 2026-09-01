import { ForbiddenException } from '@nestjs/common';
import { AnaliticaService } from './analitica.service';

const lectura = { nivel: 'lectura', ks: [], inc: true };
const carga = { nivel: 'carga', ks: ['K6'], inc: false };

describe('AnaliticaService', () => {
  const prisma = { $queryRaw: jest.fn() } as any;
  const service = new AnaliticaService(prisma);
  beforeEach(() => prisma.$queryRaw.mockReset());

  it('sin claim tira Forbidden', async () => {
    await expect(service.evolucionMensual({}, null)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('evolucionMensual castea los Decimal de SUM a number', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { periodo: '2026-08', monto_total: '1234.50', pgn_total: '99.9' },
    ]);
    expect(await service.evolucionMensual({}, lectura)).toEqual([
      { periodo: '2026-08', monto_total: 1234.5, pgn_total: 99.9 },
    ]);
  });

  it('nivel carga con filtro de contratos ajenos devuelve [] sin tocar la BD (fail-closed)', async () => {
    expect(await service.porContratoMes({ contratos: ['K2'] }, carga)).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('porProvincia castea lineas (BigInt de COUNT) a number', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { provincia: 'Salta', monto_total: '10', pgn_total: '1', lineas: 5n },
    ]);
    expect(await service.porProvincia({}, lectura)).toEqual([
      { provincia: 'Salta', monto_total: 10, pgn_total: 1, lineas: 5 },
    ]);
  });

  it('topItems pasa el límite como bind param (default 10)', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await service.topItems({}, lectura);
    const sql = prisma.$queryRaw.mock.calls[0][0];
    expect(sql.sql).toContain('LIMIT ?');
    expect(sql.values).toContain(10);
  });

  it('contratos con nivel carga devuelve cert.ks sin llamar a $queryRaw', async () => {
    const result = await service.contratos(carga);
    expect(result).toEqual(['K6']);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
