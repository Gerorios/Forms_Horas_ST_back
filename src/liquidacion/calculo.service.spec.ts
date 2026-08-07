import { Test } from '@nestjs/testing';
import { CalculoService } from './calculo.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CalculoService — fórmula de "por tantos" (ADR-015)', () => {
  const prismaMock: any = {
    perfilLiquidacion: { findMany: jest.fn() },
    tipoNovedad: { findMany: jest.fn() },
    montoMensualizado: { findMany: jest.fn() },
    kmPorTantos: { findMany: jest.fn() },
    tarifaCategoriaUocra: { findMany: jest.fn() },
    montoNovedadPlus: { findMany: jest.fn() },
    bonoNoRemunerativo: { findMany: jest.fn() },
    rangoKmPorTantos: { findMany: jest.fn() },
    registroHoras: { groupBy: jest.fn() },
    novedad: { findMany: jest.fn() },
  };
  let service: CalculoService;

  const PERFIL_POR_TANTOS = {
    cuil: '20999999999',
    regimen: 'por_tantos',
    categoriaUocraId: 1,
    modalidadPago: null,
    empleado: { apellido_nombre: 'RELEVADOR TEST', legajo: 1, cargo: 'Relevador', provincia: 'Córdoba' },
    categoria: { id: 1, nombre: 'Oficial' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.tipoNovedad.findMany.mockResolvedValue([]);
    prismaMock.montoMensualizado.findMany.mockResolvedValue([]);
    prismaMock.montoNovedadPlus.findMany.mockResolvedValue([]);
    prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([]);
    prismaMock.registroHoras.groupBy.mockResolvedValue([]);
    prismaMock.novedad.findMany.mockResolvedValue([]);

    const mod = await Test.createTestingModule({
      providers: [CalculoService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(CalculoService);
  });

  function setupKmYTarifa({ kmTotal, tarifaHora }: { kmTotal: number; tarifaHora: number }) {
    prismaMock.perfilLiquidacion.findMany.mockResolvedValue([PERFIL_POR_TANTOS]);
    prismaMock.kmPorTantos.findMany.mockResolvedValue([{ cuil: PERFIL_POR_TANTOS.cuil, kmTotal }]);
    prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
      { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: tarifaHora },
    ]);
    prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([
      { vigenteDesde: new Date(2026, 7, 1), kmDesde: 0, kmHasta: null, precioPorKm: 100 },
    ]);
  }

  it('km × precio del rango ÷ tarifa de categoría = horas totales, y separa CCT/extra con tope 88', async () => {
    setupKmYTarifa({ kmTotal: 1000, tarifaHora: 1000 }); // monto = 100.000; horas = 100
    const [fila] = await service.calcularQuincena(2026, 8, 1);

    expect(fila.montoKmBruto).toBe(100_000); // km × precio del rango, antes de convertir a horas
    expect(fila.horasTotal).toBe(100);
    expect(fila.horasCct).toBe(88);
    expect(fila.horasExtra).toBe(12);
    expect(fila.totalBruto).toBe(88_000); // básico = tarifa × horasCct
  });

  it('el extra de "por tantos" NO lleva el multiplicador ×1.5 (a diferencia de jornalizado)', async () => {
    setupKmYTarifa({ kmTotal: 1000, tarifaHora: 1000 }); // horasExtra = 12
    const [fila] = await service.calcularQuincena(2026, 8, 1);

    // Sin multiplicador: 12 × 1000 = 12.000 (no 12 × 1000 × 1.5 = 18.000)
    expect(fila.montoHorasExtra).toBe(12_000);
  });

  it('sin horas extra (total ≤ 88), el extra da 0', async () => {
    setupKmYTarifa({ kmTotal: 500, tarifaHora: 1000 }); // monto=50.000; horas=50 (< 88)
    const [fila] = await service.calcularQuincena(2026, 8, 1);

    expect(fila.horasTotal).toBe(50);
    expect(fila.horasExtra).toBe(0);
    expect(fila.montoHorasExtra).toBe(0);
  });

  it('falta km cargado: datoFaltante, sin calcular nada', async () => {
    prismaMock.perfilLiquidacion.findMany.mockResolvedValue([PERFIL_POR_TANTOS]);
    prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
    prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
      { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 1000 },
    ]);
    prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);

    const [fila] = await service.calcularQuincena(2026, 8, 1);
    expect(fila.datoFaltante).toBe('Falta cargar los km de esta quincena');
    expect(fila.horasTotal).toBe(0);
  });

  it('falta categoría/tarifa asignada: datoFaltante distinto', async () => {
    prismaMock.perfilLiquidacion.findMany.mockResolvedValue([{ ...PERFIL_POR_TANTOS, categoriaUocraId: null, categoria: null }]);
    prismaMock.kmPorTantos.findMany.mockResolvedValue([{ cuil: PERFIL_POR_TANTOS.cuil, kmTotal: 500 }]);
    prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([]);
    prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([
      { vigenteDesde: new Date(2026, 7, 1), kmDesde: 0, kmHasta: null, precioPorKm: 100 },
    ]);

    const [fila] = await service.calcularQuincena(2026, 8, 1);
    expect(fila.datoFaltante).toBe('Sin categoría UOCRA / tarifa asignada (necesaria para convertir km a horas)');
  });

  it('jornalizado sigue con el multiplicador ×1.5 en el extra (sin cambios)', async () => {
    prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
      {
        cuil: '20111111111',
        regimen: 'jornalizado',
        categoriaUocraId: 1,
        modalidadPago: 'en_b',
        empleado: { apellido_nombre: 'JORNALIZADO TEST', legajo: 2, cargo: 'Oficial', provincia: 'Córdoba' },
        categoria: { id: 1, nombre: 'Oficial' },
      },
    ]);
    prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
    prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
      { categoriaUocraId: 1, vigenteDesde: new Date(2026, 7, 1), importeHora: 1000 },
    ]);
    prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);
    prismaMock.registroHoras.groupBy.mockResolvedValue([{ operarioCuil: '20111111111', _sum: { horas: 100 } }]);

    const [fila] = await service.calcularQuincena(2026, 8, 1);
    expect(fila.horasExtra).toBe(12);
    expect(fila.montoHorasExtra).toBe(18_000); // 12 × 1000 × 1.5, sin cambios
    expect(fila.montoKmBruto).toBeNull();
  });
});
