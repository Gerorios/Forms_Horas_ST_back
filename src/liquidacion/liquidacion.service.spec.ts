import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LiquidacionService — precios por período (ADR-018)', () => {
  const prismaMock: any = {
    categoriaUocra: { findMany: jest.fn() },
    tarifaCategoriaUocra: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    bonoNoRemunerativo: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    tipoNovedad: { findMany: jest.fn() },
    montoNovedadPlus: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    rangoKmPorTantos: { findMany: jest.fn(), findFirst: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    kmPorTantos: { findMany: jest.fn(), upsert: jest.fn() },
    plusIndividual: { findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    perfilLiquidacion: { findMany: jest.fn(), upsert: jest.fn() },
    perfilContratoImputacion: { deleteMany: jest.fn(), createMany: jest.fn() },
    contrato: { findMany: jest.fn() },
    snuempleados: { findUnique: jest.fn() },
    sueldoMensualizado: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    usuario: { findUnique: jest.fn() },
    auditoria: { create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prismaMock)),
  };
  let service: LiquidacionService;

  const fecha = new Date(Date.UTC(2026, 7, 1)); // 1/8/2026

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction = jest.fn((fn: any) => fn(prismaMock));
    const mod = await Test.createTestingModule({
      providers: [LiquidacionService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = mod.get(LiquidacionService);
  });

  describe('categorías (obligatorio)', () => {
    it('sin fila propia del período: resuelto=false, con sugerencia del último anterior', async () => {
      prismaMock.categoriaUocra.findMany.mockResolvedValue([{ id: 1, nombre: 'Oficial' }]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
        { categoriaUocraId: 1, vigenteDesde: new Date(Date.UTC(2026, 6, 1)), importeHora: 5817 }, // julio
      ]);

      const r = await service.getCategoriasPeriodo(2026, 8);
      expect(r).toEqual([
        {
          id: 1,
          nombre: 'Oficial',
          resuelto: false,
          importeHora: null,
          sugerencia: { valor: '5817', periodo: { anio: 2026, mes: 7 } },
        },
      ]);
    });

    it('con fila propia del período: resuelto=true, sin sugerencia (no hereda de meses futuros ni pasados)', async () => {
      prismaMock.categoriaUocra.findMany.mockResolvedValue([{ id: 1, nombre: 'Oficial' }]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([
        { categoriaUocraId: 1, vigenteDesde: new Date(Date.UTC(2026, 6, 1)), importeHora: 5817 },
        { categoriaUocraId: 1, vigenteDesde: fecha, importeHora: 6348 },
      ]);

      const r = await service.getCategoriasPeriodo(2026, 8);
      expect(r).toEqual([{ id: 1, nombre: 'Oficial', resuelto: true, importeHora: '6348', sugerencia: null }]);
    });

    it('guardar: sin fila previa del período → create + auditoría crear', async () => {
      prismaMock.tarifaCategoriaUocra.findUnique.mockResolvedValue(null);
      prismaMock.tarifaCategoriaUocra.create.mockResolvedValue({ id: 20 });
      prismaMock.categoriaUocra.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([]);

      await service.guardarCategoriasPeriodo(2026, 8, { categorias: [{ categoriaUocraId: 1, importeHora: 6348 }] }, '20-1-1');

      expect(prismaMock.tarifaCategoriaUocra.create).toHaveBeenCalledWith({
        data: { categoriaUocraId: 1, vigenteDesde: fecha, importeHora: 6348 },
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tabla: 'sth_tarifas_categoria_uocra', registroId: 20, accion: 'crear', valorNuevo: '6348' }),
      });
    });

    it('guardar: fila ya existe con otro valor → update + auditoría editar', async () => {
      prismaMock.tarifaCategoriaUocra.findUnique.mockResolvedValue({ id: 10, importeHora: 6000 });
      prismaMock.categoriaUocra.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([]);

      await service.guardarCategoriasPeriodo(2026, 8, { categorias: [{ categoriaUocraId: 1, importeHora: 6348 }] }, '20-1-1');

      expect(prismaMock.tarifaCategoriaUocra.update).toHaveBeenCalledWith({ where: { id: 10 }, data: { importeHora: 6348 } });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ accion: 'editar', valorAnterior: '6000', valorNuevo: '6348' }),
      });
    });

    it('guardar: mismo valor → no audita ni actualiza', async () => {
      prismaMock.tarifaCategoriaUocra.findUnique.mockResolvedValue({ id: 10, importeHora: 6348 });
      prismaMock.categoriaUocra.findMany.mockResolvedValue([]);
      prismaMock.tarifaCategoriaUocra.findMany.mockResolvedValue([]);

      await service.guardarCategoriasPeriodo(2026, 8, { categorias: [{ categoriaUocraId: 1, importeHora: 6348 }] }, '20-1-1');

      expect(prismaMock.tarifaCategoriaUocra.update).not.toHaveBeenCalled();
      expect(prismaMock.auditoria.create).not.toHaveBeenCalled();
    });
  });

  describe('bono no remunerativo (único campo opcional)', () => {
    it('sin fila propia: resuelto=false (no se infiere "sin bono" de la ausencia)', async () => {
      prismaMock.categoriaUocra.findMany.mockResolvedValue([{ id: 1, nombre: 'Oficial' }]);
      prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([
        { categoriaUocraId: 1, vigenteDesde: new Date(Date.UTC(2026, 6, 1)), tipo: 'monto_fijo', valor: 33550 },
      ]);

      const r = await service.getBonosPeriodo(2026, 8);
      expect(r).toEqual([
        {
          categoriaUocraId: 1,
          nombre: 'Oficial',
          resuelto: false,
          bono: null,
          sugerencia: { tipo: 'monto_fijo', valor: '33550', periodo: { anio: 2026, mes: 7 } },
        },
      ]);
    });

    it('guardar con valor 0: crea una fila real (decisión explícita "sin bono este mes")', async () => {
      prismaMock.bonoNoRemunerativo.findUnique.mockResolvedValue(null);
      prismaMock.bonoNoRemunerativo.create.mockResolvedValue({ id: 5 });
      prismaMock.categoriaUocra.findMany.mockResolvedValue([]);
      prismaMock.bonoNoRemunerativo.findMany.mockResolvedValue([]);

      await service.guardarBonosPeriodo(2026, 8, { bonos: [{ categoriaUocraId: 1, tipo: 'monto_fijo', valor: 0 }] }, '20-1-1');

      expect(prismaMock.bonoNoRemunerativo.create).toHaveBeenCalledWith({
        data: { categoriaUocraId: 1, vigenteDesde: fecha, tipo: 'monto_fijo', valor: 0 },
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tabla: 'sth_bonos_no_remunerativos', accion: 'crear', valorNuevo: '0' }),
      });
    });
  });

  describe('novedades con plus (obligatorio)', () => {
    it('sin fila propia: resuelto=false, con sugerencia', async () => {
      prismaMock.tipoNovedad.findMany.mockResolvedValue([{ id: 5, nombre: 'Guardia Pasiva' }]);
      prismaMock.montoNovedadPlus.findMany.mockResolvedValue([
        { tipoNovedadId: 5, vigenteDesde: new Date(Date.UTC(2026, 6, 1)), montoPorDia: 8000 },
      ]);

      const r = await service.getNovedadesPlusPeriodo(2026, 8);
      expect(r).toEqual([
        {
          tipoNovedadId: 5,
          nombre: 'Guardia Pasiva',
          resuelto: false,
          montoPorDia: null,
          sugerencia: { valor: '8000', periodo: { anio: 2026, mes: 7 } },
        },
      ]);
    });
  });

  describe('rangos de km (obligatorio, reemplazo completo del período)', () => {
    it('sin filas propias: resuelto=false, sugiere el set completo del último período anterior', async () => {
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValueOnce([]); // propios del período
      prismaMock.rangoKmPorTantos.findFirst.mockResolvedValue({ vigenteDesde: new Date(Date.UTC(2026, 6, 1)) });
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValueOnce([
        { kmDesde: 0, kmHasta: 60, precioPorKm: 100 },
      ]);

      const r = await service.getRangosKmPeriodo(2026, 8);
      expect(r.resuelto).toBe(false);
      expect(r.sugerencia).toEqual({
        rangosKm: [{ kmDesde: '0', kmHasta: '60', precioPorKm: '100' }],
        periodo: { anio: 2026, mes: 7 },
      });
    });

    it('reemplaza los rangos km con una única fila de auditoría JSON', async () => {
      prismaMock.rangoKmPorTantos.findMany.mockResolvedValue([{ kmDesde: 0, kmHasta: 100, precioPorKm: 10 }]);
      const nuevos = [{ kmDesde: 0, kmHasta: 100, precioPorKm: 12 }];

      await service.guardarRangosKmPeriodo(2026, 8, { rangosKm: nuevos } as any, '20-1-1');

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

  describe('cargarKmPorTantos (ADR-014)', () => {
    const dto = { anio: 2026, mes: 8, quincena: 1, kms: [{ cuil: '20111111111', kmTotal: 150 }] };

    beforeEach(() => {
      prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
      prismaMock.kmPorTantos.upsert.mockResolvedValue({});
    });

    it('Admin puede cargar sin chequear el flag', async () => {
      await service.cargarKmPorTantos(dto as any, { cuil: 'admin-cuil', rol: 'Admin' });
      expect(prismaMock.usuario.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.kmPorTantos.upsert).toHaveBeenCalledWith({
        where: { cuil_anio_mes_quincena: { cuil: '20111111111', anio: 2026, mes: 8, quincena: 1 } },
        create: { cuil: '20111111111', anio: 2026, mes: 8, quincena: 1, kmTotal: 150 },
        update: { kmTotal: 150 },
      });
    });

    it('JefeContrato sin el flag habilitado: 403, no escribe nada', async () => {
      prismaMock.usuario.findUnique.mockResolvedValue({ puedeCargarKmPorTantos: false });
      await expect(
        service.cargarKmPorTantos(dto as any, { cuil: 'jdc-cuil', rol: 'JefeContrato' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.kmPorTantos.upsert).not.toHaveBeenCalled();
    });

    it('JefeContrato con el flag habilitado puede cargar', async () => {
      prismaMock.usuario.findUnique.mockResolvedValue({ puedeCargarKmPorTantos: true });
      await service.cargarKmPorTantos(dto as any, { cuil: 'jdc-cuil', rol: 'JefeContrato' });
      expect(prismaMock.kmPorTantos.upsert).toHaveBeenCalled();
    });
  });

  describe('guardarSueldosMensualizados (ADR-018, reemplaza ADR-016)', () => {
    beforeEach(() => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        { cuil: '20111111111', empleado: { apellido_nombre: 'PEREZ JUAN' }, categoria: null },
      ]);
      prismaMock.sueldoMensualizado.findMany.mockResolvedValue([]);
    });

    it('sin fila previa del período: crea + auditoría crear, sin RondaTarifas de por medio', async () => {
      prismaMock.sueldoMensualizado.findUnique.mockResolvedValue(null);
      prismaMock.sueldoMensualizado.create.mockResolvedValue({ id: 1 });

      await service.guardarSueldosMensualizados(
        { anio: 2026, mes: 8, sueldos: [{ cuil: '20111111111', monto: 500000 }] } as any,
        'admin-cuil',
      );

      expect(prismaMock.sueldoMensualizado.create).toHaveBeenCalledWith({
        data: { cuil: '20111111111', vigenteDesde: fecha, monto: 500000 },
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tabla: 'sth_sueldos_mensualizados', accion: 'crear', valorNuevo: '500000' }),
      });
    });

    it('período anterior o posterior al último cargado: no bloquea (períodos independientes)', async () => {
      prismaMock.sueldoMensualizado.findUnique.mockResolvedValue(null);
      prismaMock.sueldoMensualizado.create.mockResolvedValue({ id: 1 });

      await expect(
        service.guardarSueldosMensualizados({ anio: 2026, mes: 6, sueldos: [{ cuil: '20111111111', monto: 400000 }] } as any, 'admin-cuil'),
      ).resolves.toBeDefined();
    });
  });

  describe('getSueldosMensualizados (ADR-018)', () => {
    it('sin fila propia del período: resuelto=false, con sugerencia del último anterior', async () => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        { cuil: '20111111111', empleado: { apellido_nombre: 'PEREZ JUAN' }, categoria: { nombre: 'Oficial' } },
      ]);
      prismaMock.sueldoMensualizado.findMany.mockResolvedValue([
        { cuil: '20111111111', vigenteDesde: new Date(Date.UTC(2026, 6, 1)), monto: 500000 },
      ]);

      const r = await service.getSueldosMensualizados(2026, 8);
      expect(r).toEqual([
        {
          cuil: '20111111111',
          apellidoNombre: 'PEREZ JUAN',
          categoria: 'Oficial',
          resuelto: false,
          monto: null,
          sugerencia: { valor: '500000', periodo: { anio: 2026, mes: 7 } },
        },
      ]);
    });
  });

  describe('plus individual (ADR-018)', () => {
    it('cargarPlusIndividual: 404 si el CUIL no existe', async () => {
      prismaMock.snuempleados.findUnique.mockResolvedValue(null);
      await expect(
        service.cargarPlusIndividual(
          { cuil: '20111111111', anio: 2026, mes: 8, quincena: 1, monto: 5000, motivo: 'Manejo de máquina X' },
          'admin-cuil',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('cargarPlusIndividual: crea el registro con quien lo cargó', async () => {
      prismaMock.snuempleados.findUnique.mockResolvedValue({ cuil: '20111111111' });
      prismaMock.plusIndividual.create.mockResolvedValue({ id: 1 });

      await service.cargarPlusIndividual(
        { cuil: '20111111111', anio: 2026, mes: 8, quincena: 1, monto: 5000, motivo: 'Manejo de máquina X' },
        'admin-cuil',
      );

      expect(prismaMock.plusIndividual.create).toHaveBeenCalledWith({
        data: {
          cuil: '20111111111',
          anio: 2026,
          mes: 8,
          quincena: 1,
          monto: 5000,
          motivo: 'Manejo de máquina X',
          cargadoPorCuil: 'admin-cuil',
        },
      });
    });

    it('getPlusIndividual: filtra por período', async () => {
      prismaMock.plusIndividual.findMany.mockResolvedValue([]);
      await service.getPlusIndividual(2026, 8, 1);
      expect(prismaMock.plusIndividual.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { anio: 2026, mes: 8, quincena: 1 } }),
      );
    });

    it('eliminarPlusIndividual: borra por id', async () => {
      prismaMock.plusIndividual.delete.mockResolvedValue({ id: 9 });
      await service.eliminarPlusIndividual(9);
      expect(prismaMock.plusIndividual.delete).toHaveBeenCalledWith({ where: { id: 9 } });
    });
  });

  describe('perfiles — contratos de imputación (addendum plan 2026-08-12)', () => {
    beforeEach(() => {
      prismaMock.snuempleados.findUnique.mockResolvedValue({ cuil: '20111111111' });
      prismaMock.perfilLiquidacion.upsert.mockResolvedValue({ cuil: '20111111111', regimen: 'mensualizado' });
    });

    it('getPerfiles devuelve contratosImputacionIds sin romper los campos existentes', async () => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        {
          cuil: '20111111111',
          regimen: 'mensualizado',
          categoriaUocraId: null,
          modalidadPago: null,
          empleado: { apellido_nombre: 'PEREZ JUAN', legajo: '12', cargo: 'chofer' },
          categoria: null,
          contratosImputacion: [{ contratoId: 3 }, { contratoId: 7 }],
        },
      ]);

      const r = await service.getPerfiles();
      expect(r[0]).toMatchObject({
        cuil: '20111111111',
        regimen: 'mensualizado',
        contratosImputacionIds: [3, 7],
      });
      expect((r[0] as any).contratosImputacion).toBeUndefined();
    });

    it('upsertPerfil con contratosImputacionIds reemplaza el set completo (deleteMany + createMany)', async () => {
      await service.upsertPerfil('20111111111', {
        regimen: 'mensualizado',
        contratosImputacionIds: [3, 7],
      } as any);

      expect(prismaMock.perfilContratoImputacion.deleteMany).toHaveBeenCalledWith({
        where: { cuil: '20111111111' },
      });
      expect(prismaMock.perfilContratoImputacion.createMany).toHaveBeenCalledWith({
        data: [
          { cuil: '20111111111', contratoId: 3 },
          { cuil: '20111111111', contratoId: 7 },
        ],
      });
    });

    it('upsertPerfil sin contratosImputacionIds no toca las asignaciones', async () => {
      await service.upsertPerfil('20111111111', { regimen: 'jornalizado' } as any);

      expect(prismaMock.perfilContratoImputacion.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.perfilContratoImputacion.createMany).not.toHaveBeenCalled();
    });

    it('getContratos lista los activos ordenados por código', async () => {
      prismaMock.contrato.findMany.mockResolvedValue([{ id: 1, codigo: 'K5', nombre: 'Gasnor K5' }]);
      const r = await service.getContratos();
      expect(r).toEqual([{ id: 1, codigo: 'K5', nombre: 'Gasnor K5' }]);
    });
  });
});
