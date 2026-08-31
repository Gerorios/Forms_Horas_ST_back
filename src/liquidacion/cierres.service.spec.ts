import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CierresService } from './cierres.service';
import { CalculoService } from './calculo.service';
import { PrismaService } from '../prisma/prisma.service';

const CUIL_LIQUIDADOR = '20-11111111-1';

function filaBase(overrides: Record<string, unknown> = {}) {
  return {
    cuil: '20-22222222-2',
    apellidoNombre: 'Perez, Juan',
    legajo: 10,
    categoria: 'Oficial',
    regimen: 'jornalizado',
    provincia: 'SALTA',
    modalidadPago: 'en_b',
    precioBruto: 100,
    montoKmBruto: null,
    horasTotal: 88,
    horasCct: 88,
    totalBruto: 8800,
    horasExtra: 0,
    montoHorasExtra: 0,
    tienePresentismo: true,
    montoPresentismo: 1760,
    plus: [] as { nombre: string; monto?: number | null }[],
    noRemunerativo: 0,
    plusIndividual: null as number | null,
    plusIndividualMotivo: null,
    novedadesTexto: '',
    total: 10560,
    datoFaltante: null as string | null,
    ...overrides,
  };
}

describe('CierresService', () => {
  const prismaMock: any = {
    cierreLiquidacion: { aggregate: jest.fn(), create: jest.fn() },
    registroHoras: { groupBy: jest.fn() },
    kmPorTantos: { findMany: jest.fn() },
    snuempleados: { findMany: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prismaMock)),
  };
  const calculoMock: any = { calcularQuincena: jest.fn(), getAlertasQuincena: jest.fn() };
  let service: CierresService;

  const alertasVacias = { sinPerfil: [], perfilIncompleto: [], sinHorasAprobadas: [] };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction = jest.fn((fn: any) => fn(prismaMock));
    prismaMock.registroHoras.groupBy.mockResolvedValue([]);
    prismaMock.kmPorTantos.findMany.mockResolvedValue([]);
    prismaMock.snuempleados.findMany.mockResolvedValue([]);

    const mod = await Test.createTestingModule({
      providers: [
        CierresService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CalculoService, useValue: calculoMock },
      ],
    }).compile();
    service = mod.get(CierresService);
  });

  it('primer cierre: crea version 1 con detalle congelado y zona derivada', async () => {
    calculoMock.calcularQuincena.mockResolvedValue([filaBase()]); // provincia SALTA
    calculoMock.getAlertasQuincena.mockResolvedValue(alertasVacias);
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: null } });
    prismaMock.snuempleados.findMany.mockResolvedValue([
      { cuil: '20-22222222-2', localidad: 'Salta Capital', apellido_nombre: 'Perez, Juan', legajo: 10 },
    ]);

    await service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR);

    expect(prismaMock.cierreLiquidacion.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.cierreLiquidacion.create.mock.calls[0][0].data;
    expect(data.version).toBe(1);
    expect(data.anio).toBe(2026);
    expect(data.mes).toBe(9);
    expect(data.quincena).toBe(1);
    expect(data.cerradoPorCuil).toBe(CUIL_LIQUIDADOR);
    expect(data.detalle.create[0].zona).toBe('norte');
    expect(data.detalle.create[0].localidad).toBe('Salta Capital');
    expect(data.detalle.create[0].provincia).toBe('SALTA');
  });

  it('recierre sin nota → BadRequestException', async () => {
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: 1 } });

    await expect(service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR)).rejects.toThrow(BadRequestException);
    expect(calculoMock.calcularQuincena).not.toHaveBeenCalled();
  });

  it('recierre CON nota crea version 2', async () => {
    calculoMock.calcularQuincena.mockResolvedValue([]);
    calculoMock.getAlertasQuincena.mockResolvedValue(alertasVacias);
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: 1 } });

    await service.crearCierre(2026, 9, 1, '  Recalculo por horas cargadas tarde  ', CUIL_LIQUIDADOR);

    const data = prismaMock.cierreLiquidacion.create.mock.calls[0][0].data;
    expect(data.version).toBe(2);
    expect(data.nota).toBe('Recalculo por horas cargadas tarde');
  });

  it('empleado sin zona queda con zona null y salvedad en cabecera', async () => {
    calculoMock.calcularQuincena.mockResolvedValue([filaBase({ provincia: 'BUENOS AIRES' })]);
    calculoMock.getAlertasQuincena.mockResolvedValue(alertasVacias);
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: null } });

    await service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR);

    const data = prismaMock.cierreLiquidacion.create.mock.calls[0][0].data;
    expect(data.detalle.create[0].zona).toBeNull();
    expect(data.detalle.create[0].salvedad).toMatch(/sin zona/i);
    const salvedades = JSON.parse(data.salvedades);
    expect(salvedades.some((s: string) => /sin zona/i.test(s))).toBe(true);
  });

  it('fila por_tantos congela km/montoKm/montoA/montoB', async () => {
    const fila = filaBase({
      regimen: 'por_tantos',
      montoKmBruto: 45000,
      totalBruto: 30000,
      montoPresentismo: 6000,
      noRemunerativo: 1000,
      montoHorasExtra: 5000,
    });
    calculoMock.calcularQuincena.mockResolvedValue([fila]);
    calculoMock.getAlertasQuincena.mockResolvedValue(alertasVacias);
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: null } });
    prismaMock.kmPorTantos.findMany.mockResolvedValue([{ cuil: fila.cuil, kmTotal: 150 }]);

    await service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR);

    const detalle = prismaMock.cierreLiquidacion.create.mock.calls[0][0].data.detalle.create[0];
    expect(detalle.kmTotal).toBe(150);
    expect(detalle.montoKmBruto).toBe(45000);
    expect(detalle.montoA).toBe(30000 + 6000 + 1000);
    expect(detalle.montoB).toBe(5000);
  });

  it('regimen distinto de por_tantos deja km/montoKm/montoA/montoB en null', async () => {
    calculoMock.calcularQuincena.mockResolvedValue([filaBase({ regimen: 'jornalizado' })]);
    calculoMock.getAlertasQuincena.mockResolvedValue(alertasVacias);
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: null } });

    await service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR);

    const detalle = prismaMock.cierreLiquidacion.create.mock.calls[0][0].data.detalle.create[0];
    expect(detalle.kmTotal).toBeNull();
    expect(detalle.montoKmBruto).toBeNull();
    expect(detalle.montoA).toBeNull();
    expect(detalle.montoB).toBeNull();
  });

  it('montoGuardias suma plus cuyo nombre contiene "guardia"; el resto va a montoProductividad', async () => {
    const fila = filaBase({
      plus: [
        { nombre: 'Guardia Pasiva', monto: 500 },
        { nombre: 'Viáticos', monto: 200 },
        { nombre: 'Guardia Activa', monto: 300 },
      ],
    });
    calculoMock.calcularQuincena.mockResolvedValue([fila]);
    calculoMock.getAlertasQuincena.mockResolvedValue(alertasVacias);
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: null } });

    await service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR);

    const detalle = prismaMock.cierreLiquidacion.create.mock.calls[0][0].data.detalle.create[0];
    expect(detalle.montoGuardias).toBe(800);
    expect(detalle.montoProductividad).toBe(200);
  });

  it('precioBruto congelado: mensualizado usa totalBruto (sueldo quincenal), el resto usa la tarifa hora', async () => {
    const mensualizado = filaBase({ regimen: 'mensualizado', precioBruto: null, totalBruto: 250000 });
    const jornalizado = filaBase({ cuil: '20-33333333-3', regimen: 'jornalizado', precioBruto: 120 });
    calculoMock.calcularQuincena.mockResolvedValue([mensualizado, jornalizado]);
    calculoMock.getAlertasQuincena.mockResolvedValue(alertasVacias);
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: null } });

    await service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR);

    const detalle = prismaMock.cierreLiquidacion.create.mock.calls[0][0].data.detalle.create;
    expect(detalle[0].precioBruto).toBe(250000);
    expect(detalle[1].precioBruto).toBe(120);
  });

  it('empleado con horas pero sin perfil no genera fila de detalle, pero sus días sí aparecen', async () => {
    calculoMock.calcularQuincena.mockResolvedValue([]); // sin perfil = no entra al cálculo
    calculoMock.getAlertasQuincena.mockResolvedValue({
      sinPerfil: [{ cuil: '20-44444444-4', apellidoNombre: 'Gomez, Ana', horasAprobadas: 8, horasPendientes: 0 }],
      perfilIncompleto: [],
      sinHorasAprobadas: [],
    });
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: null } });
    prismaMock.registroHoras.groupBy.mockResolvedValue([
      { operarioCuil: '20-44444444-4', fecha: new Date(2026, 8, 3) },
    ]);
    prismaMock.snuempleados.findMany.mockResolvedValue([
      { cuil: '20-44444444-4', localidad: 'San Miguel', apellido_nombre: 'Gomez, Ana', legajo: 55 },
    ]);

    await service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR);

    const data = prismaMock.cierreLiquidacion.create.mock.calls[0][0].data;
    expect(data.detalle.create).toHaveLength(0);
    expect(data.diasTrabajados.create).toHaveLength(1);
    expect(data.diasTrabajados.create[0]).toMatchObject({
      cuil: '20-44444444-4',
      apellidoNombre: 'Gomez, Ana',
      legajo: 55,
    });
    const salvedades = JSON.parse(data.salvedades);
    expect(salvedades.some((s: string) => /sin perfil/i.test(s))).toBe(true);
  });

  it('usa $transaction con timeout/maxWait al persistir', async () => {
    calculoMock.calcularQuincena.mockResolvedValue([]);
    calculoMock.getAlertasQuincena.mockResolvedValue(alertasVacias);
    prismaMock.cierreLiquidacion.aggregate.mockResolvedValue({ _max: { version: null } });

    await service.crearCierre(2026, 9, 1, undefined, CUIL_LIQUIDADOR);

    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30000, maxWait: 10000 });
  });
});
