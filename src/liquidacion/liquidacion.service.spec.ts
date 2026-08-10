import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LiquidacionService — edición de rondas cargadas (amendment ADR-010)', () => {
  const prismaMock: any = {
    rondaTarifas: { findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn() },
    categoriaUocra: { findMany: jest.fn() },
    tarifaCategoriaUocra: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    bonoNoRemunerativo: { findMany: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn() },
    tipoNovedad: { findMany: jest.fn() },
    montoNovedadPlus: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    rangoKmPorTantos: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    kmPorTantos: { findMany: jest.fn(), upsert: jest.fn() },
    perfilLiquidacion: { findMany: jest.fn() },
    sueldoMensualizado: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn(), create: jest.fn() },
    usuario: { findUnique: jest.fn() },
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

    it('carga nueva (sin fila previa): auditoría accion=crear', async () => {
      await service.cargarKmPorTantos(dto as any, { cuil: 'admin-cuil', rol: 'Admin' });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: {
          tabla: 'sth_km_por_tantos',
          registroId: 0,
          usuarioCuil: 'admin-cuil',
          accion: 'crear',
          campo: '20111111111',
          valorAnterior: null,
          valorNuevo: '150',
        },
      });
    });

    it('cambia un valor existente: auditoría accion=editar con valorAnterior/valorNuevo', async () => {
      prismaMock.kmPorTantos.findMany.mockResolvedValue([{ cuil: '20111111111', kmTotal: 100 }]);
      await service.cargarKmPorTantos(dto as any, { cuil: 'admin-cuil', rol: 'Admin' });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: {
          tabla: 'sth_km_por_tantos',
          registroId: 0,
          usuarioCuil: 'admin-cuil',
          accion: 'editar',
          campo: '20111111111',
          valorAnterior: '100',
          valorNuevo: '150',
        },
      });
    });

    it('mismo valor que ya tenía: no genera auditoría', async () => {
      prismaMock.kmPorTantos.findMany.mockResolvedValue([{ cuil: '20111111111', kmTotal: 150 }]);
      await service.cargarKmPorTantos(dto as any, { cuil: 'admin-cuil', rol: 'Admin' });
      expect(prismaMock.auditoria.create).not.toHaveBeenCalled();
    });
  });

  describe('guardarSueldosMensualizados (ADR-016)', () => {
    beforeEach(() => {
      // guardarSueldosMensualizados devuelve getSueldosMensualizados al final,
      // que sí necesita el include de empleado.
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        { cuil: '20111111111', empleado: { apellido_nombre: 'PEREZ JUAN' } },
        { cuil: '20222222222', empleado: { apellido_nombre: 'GOMEZ ANA' } },
      ]);
    });

    it('mes nuevo sin ronda previa: crea el sueldo + RondaTarifas, sin huecos que llenar', async () => {
      prismaMock.rondaTarifas.findUnique.mockResolvedValue(null);
      prismaMock.rondaTarifas.findFirst.mockResolvedValue(null);
      prismaMock.sueldoMensualizado.findUnique.mockResolvedValue(null);
      prismaMock.sueldoMensualizado.create.mockResolvedValue({ id: 1 });

      await service.guardarSueldosMensualizados(
        { anio: 2026, mes: 8, sueldos: [{ cuil: '20111111111', monto: 500000 }] } as any,
        'admin-cuil',
      );

      expect(prismaMock.rondaTarifas.upsert).toHaveBeenCalledWith({
        where: { anio_mes: { anio: 2026, mes: 8 } },
        create: { anio: 2026, mes: 8 },
        update: {},
      });
      expect(prismaMock.sueldoMensualizado.create).toHaveBeenCalledWith({
        data: { cuil: '20111111111', vigenteDesde: new Date(2026, 7, 1), monto: 500000 },
      });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tabla: 'sth_sueldos_mensualizados',
          accion: 'crear',
          campo: '20111111111',
          valorNuevo: '500000',
        }),
      });
    });

    it('mes ya cargado (edición): compara con el valor existente y audita solo si cambió', async () => {
      prismaMock.rondaTarifas.findUnique.mockResolvedValue({ anio: 2026, mes: 8 });
      prismaMock.rondaTarifas.findFirst.mockResolvedValue({ anio: 2026, mes: 8 });
      prismaMock.sueldoMensualizado.findUnique.mockResolvedValue({ id: 7, cuil: '20111111111', monto: 500000 });

      await service.guardarSueldosMensualizados(
        { anio: 2026, mes: 8, sueldos: [{ cuil: '20111111111', monto: 550000 }] } as any,
        'admin-cuil',
      );

      expect(prismaMock.sueldoMensualizado.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { monto: 550000 } });
      expect(prismaMock.auditoria.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ accion: 'editar', valorAnterior: '500000', valorNuevo: '550000' }),
      });
    });

    it('mismo valor: no genera auditoría ni update', async () => {
      prismaMock.rondaTarifas.findUnique.mockResolvedValue({ anio: 2026, mes: 8 });
      prismaMock.rondaTarifas.findFirst.mockResolvedValue({ anio: 2026, mes: 8 });
      prismaMock.sueldoMensualizado.findUnique.mockResolvedValue({ id: 7, cuil: '20111111111', monto: 500000 });

      await service.guardarSueldosMensualizados(
        { anio: 2026, mes: 8, sueldos: [{ cuil: '20111111111', monto: 500000 }] } as any,
        'admin-cuil',
      );

      expect(prismaMock.sueldoMensualizado.update).not.toHaveBeenCalled();
      expect(prismaMock.auditoria.create).not.toHaveBeenCalled();
    });

    it('período anterior al último cargado, que todavía no existe: 400', async () => {
      prismaMock.rondaTarifas.findUnique.mockResolvedValue(null);
      prismaMock.rondaTarifas.findFirst.mockResolvedValue({ anio: 2026, mes: 8 });

      await expect(
        service.guardarSueldosMensualizados({ anio: 2026, mes: 7, sueldos: [] } as any, 'admin-cuil'),
      ).rejects.toThrow('anterior al último cargado');
    });

    it('completa el mes salteado copiando el último sueldo vigente de cada empleado', async () => {
      prismaMock.rondaTarifas.findUnique.mockResolvedValue(null); // setiembre no existe
      prismaMock.rondaTarifas.findFirst.mockResolvedValue({ anio: 2026, mes: 7 }); // último cargado: julio
      prismaMock.sueldoMensualizado.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.cuil === '20111111111' ? { monto: 500000 } : { monto: 400000 }),
      );
      prismaMock.sueldoMensualizado.findUnique.mockResolvedValue(null);
      prismaMock.sueldoMensualizado.create.mockResolvedValue({ id: 1 });

      await service.guardarSueldosMensualizados(
        {
          anio: 2026,
          mes: 9,
          sueldos: [
            { cuil: '20111111111', monto: 520000 },
            { cuil: '20222222222', monto: 400000 },
          ],
        } as any,
        'admin-cuil',
      );

      // Agosto (el hueco entre julio y setiembre) se completa copiando el
      // vigente de julio para los dos empleados.
      expect(prismaMock.sueldoMensualizado.upsert).toHaveBeenCalledWith({
        where: { cuil_vigenteDesde: { cuil: '20111111111', vigenteDesde: new Date(2026, 7, 1) } },
        create: { cuil: '20111111111', vigenteDesde: new Date(2026, 7, 1), monto: 500000 },
        update: {},
      });
      expect(prismaMock.sueldoMensualizado.upsert).toHaveBeenCalledWith({
        where: { cuil_vigenteDesde: { cuil: '20222222222', vigenteDesde: new Date(2026, 7, 1) } },
        create: { cuil: '20222222222', vigenteDesde: new Date(2026, 7, 1), monto: 400000 },
        update: {},
      });
      expect(prismaMock.rondaTarifas.upsert).toHaveBeenCalledWith({
        where: { anio_mes: { anio: 2026, mes: 8 } },
        create: { anio: 2026, mes: 8 },
        update: {},
      });
    });
  });

  describe('getSueldosMensualizados (ADR-016)', () => {
    it('devuelve el sueldo vigente más reciente ≤ el mes consultado, por empleado', async () => {
      prismaMock.perfilLiquidacion.findMany.mockResolvedValue([
        { cuil: '20111111111', empleado: { apellido_nombre: 'PEREZ JUAN' } },
        { cuil: '20222222222', empleado: { apellido_nombre: 'GOMEZ ANA' } },
      ]);
      prismaMock.sueldoMensualizado.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.cuil === '20111111111' ? { monto: 500000 } : null),
      );

      const r = await service.getSueldosMensualizados(2026, 8);
      expect(r).toEqual([
        { cuil: '20111111111', apellidoNombre: 'PEREZ JUAN', monto: '500000' },
        { cuil: '20222222222', apellidoNombre: 'GOMEZ ANA', monto: null },
      ]);
    });
  });
});
