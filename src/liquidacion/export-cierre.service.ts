import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CierresService } from './cierres.service';
import { rangoQuincena } from '../common/quincena';

type Cabecera = Awaited<ReturnType<CierresService['detalle']>>;
type FilaDetalle = Cabecera['detalle'][number];

/** ADR-021 §5: mapeo TIPO desde `regimen` congelado. */
const TIPO_POR_REGIMEN: Record<string, string> = {
  jornalizado: 'Jornalizado',
  mensualizado: 'Mensualizado',
  fijo: 'Jornalizado/Mensualizado',
  fijo_105: 'Jornalizado/Mensualizado',
  por_tantos: 'Jornalizado/X Tanto',
};

/** Columnas del archivo principal (spec §5.1), en este orden exacto. */
const COLUMNAS_PRINCIPAL = [
  'Legajo',
  'NOMBRE Y APELLIDO',
  'LOCALIDAD',
  'CATEGORÍA',
  'TIPO',
  'HORAS TOTAL',
  'HORAS CCT',
  'PRESENTISMO',
  'PRECIO BRUTO',
  'NO REMUNERATIVO',
  'TOTAL BRUTO',
  'PRODUCTIVIDAD',
  'GUARDIAS',
  'Hs EXTRAS',
  '$$ Hs EXTRAS',
  '$ PRESENTISMO',
  'NOVEDADES',
  'TOTAL',
] as const;

const COLUMNAS_POR_TANTOS = [
  'Legajo',
  'NOMBRE Y APELLIDO',
  'KM',
  'MONTO KM',
  'Hs TOTALES',
  'Hs CCT',
  'Hs EXTRA',
  'MONTO A',
  'MONTO B',
] as const;

function num(valor: Prisma.Decimal | number | null | undefined): number {
  return valor == null ? 0 : Number(valor);
}

function numOrNull(valor: Prisma.Decimal | number | null | undefined): number | null {
  return valor == null ? null : Number(valor);
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Clave calendario "YYYY-MM-DD" de un Date LOCAL (como los que arma
 * `rangoQuincena` con `new Date(anio, mes-1, dia)`) — usa getters locales
 * a propósito, para no shiftear el día al pasar por UTC. */
function claveLocal(fecha: Date): string {
  return `${fecha.getFullYear()}-${pad2(fecha.getMonth() + 1)}-${pad2(fecha.getDate())}`;
}

/** Clave calendario "YYYY-MM-DD" de un Date que viene de Prisma en una
 * columna `@db.Date` (siempre medianoche UTC) — mismo patrón que
 * `panel.service.ts#fmtFecha` / `registros-horas.service.ts`. Usar
 * `toDateString()`/getters locales acá rompe en servers con offset negativo
 * (Argentina, UTC-3): la medianoche UTC cae en el día calendario anterior. */
function claveUtc(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function fechaDdMm(fecha: Date): string {
  return `${pad2(fecha.getDate())}/${pad2(fecha.getMonth() + 1)}`;
}

/**
 * ADR-021 §5: genera el archivo Excel de preliquidación (5 hojas) y el
 * archivo aparte de "por tantos" en B, a partir del detalle congelado de un
 * cierre (`CierresService.detalle`). Solo lectura: no toca la BD, arma todo
 * en memoria con exceljs y devuelve el buffer + el nombre de archivo del
 * spec §5 (`{anio}_{mes:2d}_{q}q_..._v{version}.xlsx`).
 */
@Injectable()
export class ExportCierreService {
  constructor(
    private prisma: PrismaService,
    private cierres: CierresService,
  ) {}

  private nombreBase(cabecera: Cabecera): string {
    return `${cabecera.anio}_${pad2(cabecera.mes)}_${cabecera.quincena}q`;
  }

  private filaPrincipal(f: FilaDetalle): unknown[] {
    return [
      f.legajo,
      f.apellidoNombre,
      f.localidad,
      f.categoria,
      TIPO_POR_REGIMEN[f.regimen] ?? f.regimen,
      numOrNull(f.horasTotal),
      numOrNull(f.horasCct),
      f.tienePresentismo ? 'SI' : 'NO',
      numOrNull(f.precioBruto),
      num(f.noRemunerativo),
      num(f.totalBruto),
      num(f.montoProductividad) + num(f.plusIndividual),
      num(f.montoGuardias),
      numOrNull(f.horasExtra),
      num(f.montoHorasExtra),
      num(f.montoPresentismo),
      f.novedadesTexto,
      num(f.total),
    ];
  }

  private agregarHojaPrincipal(wb: ExcelJS.Workbook, nombre: string, filas: FilaDetalle[]) {
    const ws = wb.addWorksheet(nombre);
    ws.addRow([...COLUMNAS_PRINCIPAL]);
    for (const f of filas) ws.addRow(this.filaPrincipal(f));
    return ws;
  }

  /** RESUMEN: total $ por localidad + por zona (solo las presentes) + total general (spec §5.1.4). */
  private agregarHojaResumen(wb: ExcelJS.Workbook, detalle: FilaDetalle[]) {
    const ws = wb.addWorksheet('RESUMEN');

    const totalPorLocalidad = new Map<string, number>();
    for (const f of detalle) {
      const clave = f.localidad ?? '(sin localidad)';
      totalPorLocalidad.set(clave, (totalPorLocalidad.get(clave) ?? 0) + num(f.total));
    }

    ws.addRow(['LOCALIDAD', 'TOTAL $']);
    for (const [localidad, total] of totalPorLocalidad) ws.addRow([localidad, total]);

    ws.addRow([]);
    ws.addRow(['ZONA', 'TOTAL $']);
    const totalNorte = detalle.filter((f) => f.zona === 'norte').reduce((acc, f) => acc + num(f.total), 0);
    const totalSur = detalle.filter((f) => f.zona === 'sur').reduce((acc, f) => acc + num(f.total), 0);
    const totalSinZona = detalle.filter((f) => f.zona == null).reduce((acc, f) => acc + num(f.total), 0);
    if (detalle.some((f) => f.zona === 'norte')) ws.addRow(['NORTE', totalNorte]);
    if (detalle.some((f) => f.zona === 'sur')) ws.addRow(['TUCUMAN', totalSur]);
    if (detalle.some((f) => f.zona == null)) ws.addRow(['SIN ZONA', totalSinZona]);

    ws.addRow([]);
    const totalGeneral = detalle.reduce((acc, f) => acc + num(f.total), 0);
    ws.addRow(['TOTAL GENERAL', totalGeneral]);

    return ws;
  }

  /** DIAS TRABAJADOS: matriz Legajo/Nombre x día del rango, 1 si hay fila (cuil,fecha) (spec §5.1.5). */
  private agregarHojaDiasTrabajados(
    wb: ExcelJS.Workbook,
    dias: { cuil: string; legajo: number | null; apellidoNombre: string; fecha: Date }[],
    anio: number,
    mes: number,
    quincena: number,
  ) {
    const ws = wb.addWorksheet('DIAS TRABAJADOS');
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);

    // `desde`/`hasta` son Date LOCAL (rangoQuincena); se itera y se keyea en
    // esa misma base local (claveLocal) — ver nota de las funciones de clave.
    const fechas: Date[] = [];
    for (let d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) fechas.push(new Date(d));
    const clavesEncabezado = fechas.map((f) => claveLocal(f));

    ws.addRow(['Legajo', 'NOMBRE Y APELLIDO', ...fechas.map((f) => fechaDdMm(f))]);

    // `d.fecha` viene de Prisma (`@db.Date` → medianoche UTC): se keyea en
    // base UTC (claveUtc), NUNCA con toDateString()/getters locales — ese
    // combo cae en el día anterior en servers con offset negativo (AR, UTC-3).
    const empleados = new Map<string, { legajo: number | null; apellidoNombre: string; fechas: Set<string> }>();
    for (const d of dias) {
      const clave = claveUtc(new Date(d.fecha));
      if (!empleados.has(d.cuil)) {
        empleados.set(d.cuil, { legajo: d.legajo, apellidoNombre: d.apellidoNombre, fechas: new Set() });
      }
      empleados.get(d.cuil)!.fechas.add(clave);
    }

    for (const emp of empleados.values()) {
      ws.addRow([
        emp.legajo,
        emp.apellidoNombre,
        ...clavesEncabezado.map((clave) => (emp.fechas.has(clave) ? 1 : '')),
      ]);
    }

    return ws;
  }

  async generarExcelPrincipal(cierreId: number): Promise<{ buffer: Buffer; filename: string }> {
    const cabecera = await this.cierres.detalle(cierreId);
    const dias = await this.prisma.cierreDiaTrabajado.findMany({ where: { cierreId } });

    const wb = new ExcelJS.Workbook();
    const detalle = cabecera.detalle;
    this.agregarHojaPrincipal(wb, 'TOTAL', detalle);
    this.agregarHojaPrincipal(wb, 'NORTE', detalle.filter((f) => f.zona === 'norte'));
    this.agregarHojaPrincipal(wb, 'TUCUMAN', detalle.filter((f) => f.zona === 'sur'));
    this.agregarHojaResumen(wb, detalle);
    this.agregarHojaDiasTrabajados(wb, dias, cabecera.anio, cabecera.mes, cabecera.quincena);

    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, filename: `${this.nombreBase(cabecera)}_Sueldo SERTEC_v${cabecera.version}.xlsx` };
  }

  async generarExcelPorTantos(cierreId: number): Promise<{ buffer: Buffer; filename: string }> {
    const cabecera = await this.cierres.detalle(cierreId);
    const porTantos = cabecera.detalle.filter((f) => f.regimen === 'por_tantos');

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('POR TANTOS B');
    ws.addRow([...COLUMNAS_POR_TANTOS]);
    for (const f of porTantos) {
      ws.addRow([
        f.legajo,
        f.apellidoNombre,
        numOrNull(f.kmTotal),
        numOrNull(f.montoKmBruto),
        numOrNull(f.horasTotal),
        numOrNull(f.horasCct),
        numOrNull(f.horasExtra),
        numOrNull(f.montoA),
        numOrNull(f.montoB),
      ]);
    }

    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, filename: `${this.nombreBase(cabecera)}_PorTantos B_v${cabecera.version}.xlsx` };
  }
}
