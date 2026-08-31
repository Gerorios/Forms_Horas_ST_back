import * as ExcelJS from 'exceljs';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ExportCierreService } from './export-cierre.service';
import { CierresService } from './cierres.service';
import { PrismaService } from '../prisma/prisma.service';

function filaCongelada(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    cierreId: 1,
    cuil: '20-22222222-2',
    apellidoNombre: 'Perez, Juan',
    legajo: 10,
    provincia: 'SALTA',
    localidad: 'Salta Capital',
    zona: 'norte',
    regimen: 'jornalizado',
    categoria: 'Oficial',
    modalidadPago: 'en_b',
    tienePresentismo: true,
    precioBruto: 100,
    horasTotal: 88,
    horasCct: 88,
    horasExtra: 0,
    totalBruto: 8800,
    montoHorasExtra: 0,
    montoPresentismo: 1760,
    noRemunerativo: 0,
    montoGuardias: 0,
    montoProductividad: 0,
    plusIndividual: 0,
    kmTotal: null,
    montoKmBruto: null,
    montoA: null,
    montoB: null,
    novedadesTexto: '',
    salvedad: null,
    total: 10560,
    ...overrides,
  };
}

function cabeceraBase(detalle: ReturnType<typeof filaCongelada>[]) {
  return {
    id: 1,
    anio: 2026,
    mes: 9,
    quincena: 1,
    version: 2,
    cerradoPor: { cuil: '20-11111111-1', nombre: 'Gomez, Ana' },
    nota: null,
    salvedades: [],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    totales: { total: 0, norte: 0, sur: 0, sinZona: 0, empleados: detalle.length },
    detalle,
  };
}

describe('ExportCierreService', () => {
  const cierresMock: any = { detalle: jest.fn() };
  const prismaMock: any = { cierreDiaTrabajado: { findMany: jest.fn() } };
  let service: ExportCierreService;
  let tzOriginal: string | undefined;

  // Fuerza el timezone del server real (Argentina, UTC-3) para que el test
  // de DIAS TRABAJADOS ejercite el bug de matching local/UTC descrito en el
  // fix — con TZ=UTC el bug no se manifiesta (medianoche UTC == medianoche
  // local, no hay shift de día).
  beforeAll(() => {
    tzOriginal = process.env.TZ;
    process.env.TZ = 'America/Argentina/Buenos_Aires';
  });

  afterAll(() => {
    process.env.TZ = tzOriginal;
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.cierreDiaTrabajado.findMany.mockResolvedValue([]);

    const mod = await Test.createTestingModule({
      providers: [
        ExportCierreService,
        { provide: CierresService, useValue: cierresMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = mod.get(ExportCierreService);
  });

  describe('generarExcelPrincipal', () => {
    it('arma TOTAL/NORTE/TUCUMAN/RESUMEN/DIAS TRABAJADOS con las 18 columnas', async () => {
      cierresMock.detalle.mockResolvedValue(cabeceraBase([filaCongelada()]));

      const { buffer, filename } = await service.generarExcelPrincipal(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);

      expect(wb.worksheets.map((w) => w.name)).toEqual(['TOTAL', 'NORTE', 'TUCUMAN', 'RESUMEN', 'DIAS TRABAJADOS']);
      const headerRow = wb.getWorksheet('TOTAL')!.getRow(1).values as unknown[];
      expect(headerRow).toContain('HORAS CCT');
      expect(headerRow).toContain('LOCALIDAD');
      expect((headerRow as unknown[]).length - 1).toBe(18); // values[0] es undefined (1-based)
      expect(filename).toBe('2026_09_1q_Sueldo SERTEC_v2.xlsx');
    });

    it('por_tantos muestra solo la parte A: horas topeadas en CCT, sin extras y TOTAL = montoA', async () => {
      const filaPorTantos = filaCongelada({
        cuil: '20-9-9',
        regimen: 'por_tantos',
        horasTotal: 110,
        horasCct: 88,
        horasExtra: 22,
        montoHorasExtra: 5000, // esto es lo B: no debe aparecer en el principal
        totalBruto: 8800,
        montoPresentismo: 1760,
        noRemunerativo: 500,
        montoA: 11060,
        montoB: 5000,
        total: 16060,
      });
      cierresMock.detalle.mockResolvedValue(cabeceraBase([filaPorTantos]));

      const { buffer } = await service.generarExcelPrincipal(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);

      const fila = wb.getWorksheet('TOTAL')!.getRow(2).values as unknown[];
      expect(fila[6]).toBe(88); // HORAS TOTAL topeada en las CCT
      expect(fila[7]).toBe(88); // HORAS CCT
      expect(fila[14] ?? null).toBeNull(); // Hs EXTRAS vacío
      expect(fila[15] ?? 0).toBe(0); // $$ Hs EXTRAS sin lo B
      expect(fila[18]).toBe(11060); // TOTAL = montoA, no el total con extras

      // RESUMEN consistente con la hoja: suma lo A, no el total con extras.
      const resumen = wb.getWorksheet('RESUMEN')!;
      const filasResumen: unknown[][] = [];
      resumen.eachRow((r) => filasResumen.push(r.values as unknown[]));
      const totalGeneral = filasResumen.find((v) => v[1] === 'TOTAL GENERAL')!;
      expect(totalGeneral[2]).toBe(11060);
    });

    it('el sin-zona sale en TOTAL pero en ninguna hoja de zona', async () => {
      const filaNorte = filaCongelada({ cuil: '20-1-1', zona: 'norte' });
      const filaSur = filaCongelada({ cuil: '20-2-2', zona: 'sur' });
      const filaSinZona = filaCongelada({ cuil: '20-3-3', zona: null, provincia: 'CORDOBA' });
      cierresMock.detalle.mockResolvedValue(cabeceraBase([filaNorte, filaSur, filaSinZona]));

      const { buffer } = await service.generarExcelPrincipal(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);

      expect(wb.getWorksheet('TOTAL')!.rowCount).toBe(4); // header + 3 filas
      expect(wb.getWorksheet('NORTE')!.rowCount).toBe(2); // header + 1
      expect(wb.getWorksheet('TUCUMAN')!.rowCount).toBe(2); // header + 1
    });

    it('TIPO mapea fijo/fijo_105 → "Jornalizado/Mensualizado" y por_tantos → "Jornalizado/X Tanto"', async () => {
      const filas = [
        filaCongelada({ cuil: '1', regimen: 'jornalizado' }),
        filaCongelada({ cuil: '2', regimen: 'mensualizado' }),
        filaCongelada({ cuil: '3', regimen: 'fijo' }),
        filaCongelada({ cuil: '4', regimen: 'fijo_105' }),
        filaCongelada({ cuil: '5', regimen: 'por_tantos' }),
      ];
      cierresMock.detalle.mockResolvedValue(cabeceraBase(filas));

      const { buffer } = await service.generarExcelPrincipal(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
      const ws = wb.getWorksheet('TOTAL')!;
      const tipos = [2, 3, 4, 5, 6].map((r) => ws.getRow(r).getCell(5).value);
      expect(tipos).toEqual([
        'Jornalizado',
        'Mensualizado',
        'Jornalizado/Mensualizado',
        'Jornalizado/Mensualizado',
        'Jornalizado/X Tanto',
      ]);
    });

    it('RESUMEN suma total por localidad, por zona y el total general', async () => {
      const filaNorte = filaCongelada({ cuil: '1', zona: 'norte', localidad: 'Salta Capital', total: 100 });
      const filaSur = filaCongelada({ cuil: '2', zona: 'sur', localidad: 'San Miguel', total: 200 });
      cierresMock.detalle.mockResolvedValue(cabeceraBase([filaNorte, filaSur]));

      const { buffer } = await service.generarExcelPrincipal(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
      const ws = wb.getWorksheet('RESUMEN')!;
      const valores = ws.getSheetValues().flat().filter((v) => v != null);
      expect(valores).toContain(300);
    });

    it('DIAS TRABAJADOS: matriz legajo/nombre x día con 1 si hay fila para (cuil, fecha), keyeando UTC como Prisma', async () => {
      // fecha de un `@db.Date` de Prisma: siempre medianoche UTC. Caso
      // borde: el PRIMER día de la quincena (2026-09-01) — con el bug
      // local/UTC (toDateString) este cae en la columna del 31/08 o
      // desaparece de la matriz.
      cierresMock.detalle.mockResolvedValue(cabeceraBase([filaCongelada()]));
      prismaMock.cierreDiaTrabajado.findMany.mockResolvedValue([
        { cuil: '20-22222222-2', legajo: 10, apellidoNombre: 'Perez, Juan', fecha: new Date(Date.UTC(2026, 8, 1)) },
      ]);

      const { buffer } = await service.generarExcelPrincipal(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
      const ws = wb.getWorksheet('DIAS TRABAJADOS')!;
      expect(ws.rowCount).toBe(2); // header + 1 empleado

      const headerRow = ws.getRow(1).values as unknown[];
      expect(headerRow[3]).toBe('01/09'); // primera columna de día = 1° de la quincena

      const fila = ws.getRow(2).values as unknown[];
      expect(fila[3]).toBe(1); // marca en la columna del 01/09, no en otra ni ausente
      expect(fila.filter((v) => v === 1)).toHaveLength(1); // ningún otro día marcado
    });

    it('propaga NotFoundException si el cierre no existe', async () => {
      cierresMock.detalle.mockRejectedValue(new NotFoundException('No existe el cierre 99.'));
      await expect(service.generarExcelPrincipal(99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('generarExcelPorTantos', () => {
    it('hoja única POR TANTOS B sin datos de A: KM, PRECIO KM derivado y MONTO B', async () => {
      const filaJornalizado = filaCongelada({ cuil: '1', regimen: 'jornalizado' });
      const filaPorTantos = filaCongelada({
        cuil: '2',
        regimen: 'por_tantos',
        kmTotal: 120,
        montoKmBruto: 5000,
        montoA: 9000,
        montoB: 1500,
      });
      cierresMock.detalle.mockResolvedValue(cabeceraBase([filaJornalizado, filaPorTantos]));

      const { buffer, filename } = await service.generarExcelPorTantos(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);

      expect(wb.worksheets.map((w) => w.name)).toEqual(['POR TANTOS B']);
      const ws = wb.getWorksheet('POR TANTOS B')!;
      expect(ws.rowCount).toBe(2); // header + solo el por_tantos
      const headerRow = (ws.getRow(1).values as unknown[]).slice(1);
      // Sin MONTO A ni horas: no debe verse cuánto cobra en A (pedido QA 2026-08-31)
      expect(headerRow).toEqual(['Legajo', 'NOMBRE Y APELLIDO', 'KM', 'PRECIO KM', 'MONTO B']);
      const fila = (ws.getRow(2).values as unknown[]).slice(1);
      expect(fila[2]).toBe(120);
      expect(fila[3]).toBeCloseTo(41.67, 2); // 5000 / 120 redondeado a 2 decimales
      expect(fila[4]).toBe(1500);
      expect(fila).not.toContain(9000);
      expect(filename).toBe('2026_09_1q_PorTantos B_v2.xlsx');
    });

    it('PRECIO KM queda null si no hay km (evita división por cero)', async () => {
      const fila = filaCongelada({
        cuil: '2',
        regimen: 'por_tantos',
        kmTotal: 0,
        montoKmBruto: 0,
        montoB: 1500,
      });
      cierresMock.detalle.mockResolvedValue(cabeceraBase([fila]));

      const { buffer } = await service.generarExcelPorTantos(1);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer as any);
      const valores = (wb.getWorksheet('POR TANTOS B')!.getRow(2).values as unknown[]).slice(1);
      expect(valores[3] ?? null).toBeNull();
    });
  });
});
