import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LiquidacionService — edición de rondas cargadas (amendment ADR-010)', () => {
  const prismaMock: any = {
    rondaTarifas: { findUnique: jest.fn(), findFirst: jest.fn() },
    categoriaUocra: { findMany: jest.fn() },
    tarifaCategoriaUocra: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    bonoNoRemunerativo: { findMany: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn() },
    tipoNovedad: { findMany: jest.fn() },
    montoNovedadPlus: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    rangoKmPorTantos: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    auditoria: { create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prismaMock)),
  };
  let service: LiquidacionService;

  const fecha = new Date(2026, 6, 1); // 1/7/2026

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction = jest.fn((fn: any) => fn(prismaMock));
    const mod = await Test.createTestingModule({
      providers: [LiquidacionService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(LiquidacionService);
  });

  describe('getRondaTarifas', () => {
    it('404 si el período no tiene RondaTarifas', async () => {
      prismaMock.rondaTarifas.findUnique.mockResolvedValue(null);
      await expect(service.getRondaTarifas(2026, 7)).rejects.toThrow(NotFoundException);
    });

    it('arma el shape con los valores del período', async () => {
      prismaMock.rondaTarifas.findUnique.mockResolvedValue({ anio: 2026, mes: 7 });
      prismaMock.categoriaUocra.findMany.mockResolvedValue([{ id: 1, nombre: 'Oficial', activo: true }]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
        { id: 10, categoriaUocraId: 1, vigenteDesde: fecha, importeHora: 100 },
      ]);
      prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([]);
      prismaMock.tipoNovedad.findMany.mockResolvedValue([{ id: 5, nombre: 'Guardia', generaPlus: true }]);
      prismaMock.montoNovedadPlus.findMany.mockResolvedValue([]);
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);

      const r = await service.getRondaTarifas(2026, 7);
      expect(r.categorias).toEqual([{ categoriaUocraId: 1, nombre: 'Oficial', importeHora: '100' }]);
      expect(r.tiposNovedad).toEqual([{ tipoNovedadId: 5, nombre: 'Guardia', montoPorDia: null }]);
      expect(r.bonosNoRemunerativos).toEqual([{ categoriaUocraId: 1, bono: null }]);
    });
  });

  describe('editarRondaTarifas', () => {
    beforeEach(() => {
      prismaMock.rondaTarifas.findUnique.mockResolvedValue({ anio: 2026, mes: 7 });
      // getRondaTarifas() called at the end to build the return value
      prismaMock.categoriaUocra.findMany.mockResolvedValue([]);
      prismaMock.tipoNovedad.findMany.mockResolvedValue([]);
      prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([]);
      prismaMock.montoNovedadPlus.findMany.mockResolvedValue([]);
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.rangoKmPorTantos.deleteMany.mockResolvedValue({ count: 0 });
      prismaMock.rangoKmPorTantos.createMany.mockResolvedValue({ count: 0 });
    });

    it('404 si el período no tiene RondaTarifas', async () => {
      prismaMock.rondaTarifas.findUnique.mockResolvedValue(null);
      await expect(
        service.editarRondaTarifas(2026, 7, { categorias: [], tiposNovedad: [], rangosKm: [] } as any, 'cuil'),
      ).rejects.toThrow(NotFoundException);
    });

    it('cambia un importeHora: update + auditoría editar con valorAnterior/valorNuevo', async () => {
      prismaMock.tarifaCategoriaUocra.findUnique.mockResolvedValue({ id: 10, importeHora: 100 });
      await service.editarRondaTarifas(
        2026,
        7,
        { categorias: [{ categoriaUocraId: 1, importeHora: 150 }], tiposNovedad: [], rangosKm: [] } as any,
        '20-1-1',
      );
      expect(prismaMock.tarifaCategoriaUocra.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { importeHora: 150 },
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tabla: 'sth_tarifas_categoria_uocra',
          registroId: 10,
          usuarioCuil: '20-1-1',
          accion: 'editar',
          campo: 'importeHora',
          valorAnterior: '100',
          valorNuevo: '150',
        }),
      });
    });

    it('no audita si el importeHora no cambió', async () => {
      prismaMock.tarifaCategoriaUocra.findUnique.mockResolvedValue({ id: 10, importeHora: 150 });
      await service.editarRondaTarifas(
        2026,
        7,
        { categorias: [{ categoriaUocraId: 1, importeHora: 150 }], tiposNovedad: [], rangosKm: [] } as any,
        '20-1-1',
      );
      expect(prismaMock.tarifaCategoriaUocra.update).not.toHaveBeenCalled();
      expect(prismaMock.auditoria.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ tabla: 'sth_tarifas_categoria_uocra' }) }),
      );
    });

    it('crea una tarifa donde no había: create + auditoría crear', async () => {
      prismaMock.tarifaCategoriaUocra.findUnique.mockResolvedValue(null);
      prismaMock.tarifaCategoriaUocra.create.mockResolvedValue({ id: 20 });
      await service.editarRondaTarifas(
        2026,
        7,
        { categorias: [{ categoriaUocraId: 2, importeHora: 200 }], tiposNovedad: [], rangosKm: [] } as any,
        '20-1-1',
      );
      expect(prismaMock.tarifaCategoriaUocra.create).toHaveBeenCalledWith({
        data: { categoriaUocraId: 2, vigenteDesde: fecha, importeHora: 200 },
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tabla: 'sth_tarifas_categoria_uocra',
          registroId: 20,
          accion: 'crear',
          campo: 'importeHora',
          valorNuevo: '200',
        }),
      });
    });

    it('agrega un bono donde no había: create + auditoría crear', async () => {
      prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([]);
      prismaMock.bonoNoRemunerativo.create.mockResolvedValue({ id: 30 });
      await service.editarRondaTarifas(
        2026,
        7,
        {
          categorias: [],
          tiposNovedad: [],
          rangosKm: [],
          bonosNoRemunerativos: [{ categoriaUocraId: 1, tipo: 'monto_fijo', valor: 5000 }],
        } as any,
        '20-1-1',
      );
      expect(prismaMock.bonoNoRemunerativo.create).toHaveBeenCalledWith({
        data: { categoriaUocraId: 1, vigenteDesde: fecha, tipo: 'monto_fijo', valor: 5000 },
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tabla: 'sth_bonos_no_remunerativos',
          registroId: 30,
          accion: 'crear',
          campo: 'valor',
          valorNuevo: '5000',
        }),
      });
    });

    it('quita un bono existente: delete + auditoría editar con valorNuevo null', async () => {
      prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([
        { id: 40, categoriaUocraId: 1, tipo: 'monto_fijo', valor: 5000 },
      ]);
      await service.editarRondaTarifas(2026, 7, { categorias: [], tiposNovedad: [], rangosKm: [] } as any, '20-1-1');
      expect(prismaMock.bonoNoRemunerativo.delete).toHaveBeenCalledWith({ where: { id: 40 } });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tabla: 'sth_bonos_no_remunerativos',
          registroId: 40,
          accion: 'editar',
          campo: 'valor',
          valorAnterior: '5000',
          valorNuevo: null,
        }),
      });
    });

    it('reemplaza los rangos km con una única fila de auditoría JSON', async () => {
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([
        { kmDesde: 0, kmHasta: 100, precioPorKm: 10 },
      ]);
      const nuevos = [{ kmDesde: 0, kmHasta: 100, precioPorKm: 12 }];
      await service.editarRondaTarifas(2026, 7, { categorias: [], tiposNovedad: [], rangosKm: nuevos } as any, '20-1-1');

      expect(prismaMock.rangoKmPorTantos.deleteMany).toHaveBeenCalledWith({ where: { vigenteDesde: fecha } });
      expect(prismaMock.rangoKmPorTantos.createMany).toHaveBeenCalledWith({
        data: [{ vigenteDesde: fecha, kmDesde: 0, kmHasta: 100, precioPorKm: 12 }],
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tabla: 'sth_rangos_km_por_tantos',
          registroId: 0,
          accion: 'editar',
          valorAnterior: JSON.stringify([{ kmDesde: '0', kmHasta: '100', precioPorKm: '10' }]),
          valorNuevo: JSON.stringify(nuevos),
        }),
      });
    });
  });
});
