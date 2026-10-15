import * as ExcelJS from 'exceljs';
import { ExportDetalleService } from './export-detalle.service';
import { periodoQuincena, resolverPeriodo } from './periodo-panel';

describe('ExportDetalleService (ADR-030)', () => {
  const prismaMock: any = {
    contrato: { findMany: jest.fn() },
    registroHoras: { findMany: jest.fn() },
    snuempleados: { findMany: jest.fn() },
  };
  const service = new ExportDetalleService(prismaMock);
  const jefe = { cuil: '20-1-1', rol: 'JefeContrato' };

  const fila = (extra: Record<string, unknown> = {}) => ({
    fecha: new Date(Date.UTC(2026, 7, 3)),
    operarioCuil: '20-2-2',
    horas: 8,
    estado: 'aprobado',
    observacion: 'Fuga en Metán',
    createdAt: new Date('2026-08-03T21:05:00Z'),
    aprobadoEn: new Date('2026-08-04T12:00:00Z'),
    operario: { apellido_nombre: 'Zeta Juan' },
    contrato: { codigo: 'K5', nombre: 'Mantenimiento Salta' },
    provincia: { nombre: 'Salta' },
    tareas: [{ tarea: { nombre: 'Zanjeo' } }, { tarea: { nombre: 'Tendido' } }],
    moviles: [{ movil: { identificador: 'AB123CD' } }, { movil: { identificador: 'M-14' } }],
    cargadoPor: { cuil: '20-9-9', nombreFueraNomina: 'Super Visor' },
    aprobadoPor: { cuil: '20-8-8', nombreFueraNomina: null },
    ...extra,
  });

  async function leer(buffer: Buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    return wb.getWorksheet('Detalle diario')!;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.contrato.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prismaMock.snuempleados.findMany.mockResolvedValue([{ cuil: '20-8-8', apellido_nombre: 'Jefe Higiene' }]);
  });

  it('consulta solo lo filtrado: mis contratos ∩ filtro, provincia, operario y tarea', async () => {
    prismaMock.registroHoras.findMany.mockResolvedValue([]);
    await service.generar(jefe, periodoQuincena(2026, 8, 1), {
      contratoIds: [2, 99],
      provinciaIds: [3],
      operarioCuils: ['20-2-2'],
      tareaIds: [7],
    });
    const where = prismaMock.registroHoras.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      contratoId: { in: [2] }, // el 99 no es mío: nunca amplía
      fecha: { gte: new Date(2026, 7, 1), lte: new Date(2026, 7, 15) },
      provinciaId: { in: [3] },
      operarioCuil: { in: ['20-2-2'] },
      tareas: { some: { tareaId: { in: [7] } } },
    });
  });

  it('sin contratos míos en el filtro no consulta registros y devuelve la hoja vacía', async () => {
    const { buffer } = await service.generar(jefe, periodoQuincena(2026, 8, 1), { contratoIds: [99] });
    expect(prismaMock.registroHoras.findMany).not.toHaveBeenCalled();
    const ws = await leer(buffer);
    expect(ws.rowCount).toBe(1); // solo el encabezado
  });

  it('una fila por registro con tareas juntas, móviles, observación y auditoría', async () => {
    prismaMock.registroHoras.findMany.mockResolvedValue([fila()]);
    const { buffer, filename } = await service.generar(jefe, periodoQuincena(2026, 8, 1));
    expect(filename).toBe('detalle-diario_2026-08-01_2026-08-15.xlsx');

    const ws = await leer(buffer);
    const encabezado = (ws.getRow(1).values as unknown[]).slice(1);
    expect(encabezado).toEqual([
      'Fecha', 'Quincena', 'Operario', 'CUIL', 'Contrato', 'Nombre del contrato', 'Provincia', 'Tareas',
      'Horas', 'Estado', 'Móviles', 'Observación', 'Cargado por', 'Cargado el',
      'Aprobado/desaprobado por', 'Aprobado/desaprobado el',
    ]);
    const valores = (ws.getRow(2).values as unknown[]).slice(1);
    expect(valores[0]).toEqual(new Date(Date.UTC(2026, 7, 3)));
    expect(valores.slice(1)).toEqual([
      '1ra 08/2026', 'Zeta Juan', '20-2-2', 'K5', 'Mantenimiento Salta', 'Salta', 'Zanjeo, Tendido',
      8, 'Aprobado', 'AB123CD, M-14', 'Fuga en Metán',
      'Super Visor', '03/08/2026, 18:05', // hora argentina, no UTC
      'Jefe Higiene', '04/08/2026, 09:00',
    ]);
    expect(ws.getColumn(1).numFmt).toBe('dd/mm/yyyy');
  });

  it('pendiente sin resolver y sin móviles deja esas celdas vacías', async () => {
    prismaMock.registroHoras.findMany.mockResolvedValue([
      fila({ estado: 'pendiente', aprobadoEn: null, aprobadoPor: null, moviles: [], observacion: null }),
    ]);
    const ws = await leer((await service.generar(jefe, periodoQuincena(2026, 8, 1))).buffer);
    const r = ws.getRow(2);
    expect(r.getCell(10).value).toBe('Pendiente');
    expect(r.getCell(11).value).toBeNull();
    expect(r.getCell(12).value).toBeNull();
    expect(r.getCell(15).value).toBeNull();
  });

  it('ordena por fecha y, dentro del día, por nombre; el archivo lleva el rango pedido', async () => {
    prismaMock.registroHoras.findMany.mockResolvedValue([
      fila({ fecha: new Date(Date.UTC(2026, 8, 20)), operario: { apellido_nombre: 'Beta' } }),
      fila({ fecha: new Date(Date.UTC(2026, 8, 20)), operario: { apellido_nombre: 'Alfa' } }),
      fila({ fecha: new Date(Date.UTC(2026, 7, 3)), operario: { apellido_nombre: 'Zeta' } }),
    ]);
    const { buffer, filename } = await service.generar(
      jefe,
      resolverPeriodo({ desde: '2026-08-01', hasta: '2026-09-30' }),
    );
    expect(filename).toBe('detalle-diario_2026-08-01_2026-09-30.xlsx');
    const ws = await leer(buffer);
    expect([2, 3, 4].map((n) => ws.getRow(n).getCell(3).value)).toEqual(['Zeta', 'Alfa', 'Beta']);
    expect(ws.getRow(3).getCell(2).value).toBe('2da 09/2026');
  });
});
