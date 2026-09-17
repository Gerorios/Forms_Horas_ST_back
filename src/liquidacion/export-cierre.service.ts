import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CierresService } from './cierres.service';
import { nombreMes, rangoQuincena, rangoVentanaDiasTrabajados } from '../common/quincena';

type Cabecera = Awaited<ReturnType<CierresService['detalle']>>;
type FilaDetalle = Cabecera['detalle'][number];

/** Fila de la foto congelada de días trabajados (`sth_cierre_dias_trabajados`). */
type DiaCongelado = { cuil: string; legajo: number | null; apellidoNombre: string; fecha: Date };

/** ADR-021 §5: mapeo TIPO desde `regimen` congelado. */
const TIPO_POR_REGIMEN: Record<string, string> = {
  jornalizado: 'Jornalizado',
  mensualizado: 'Mensualizado',
  fijo: 'Jornalizado/Mensualizado',
  // Histórico: filas congeladas antes del ADR-023, cuando fijo_105 era un
  // régimen propio. Sin esta clave, el Excel de un cierre viejo imprimiría
  // 'fijo_105' crudo en la columna TIPO.
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

// Sin MONTO A ni horas: este archivo lo ve gente que solo debe conocer la
// parte en B (pedido QA 2026-08-31). PRECIO KM se deriva del cierre
// congelado (montoKmBruto / kmTotal) porque la tarifa del rango no se
// persiste por fila.
const COLUMNAS_POR_TANTOS = ['Legajo', 'NOMBRE Y APELLIDO', 'KM', 'PRECIO KM', 'MONTO B'] as const;

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

  /** En el archivo principal, un "por tantos" muestra SOLO su parte A
   * (pedido QA 2026-08-31): horas topeadas en las CCT, sin extras (el
   * excedente es lo B, va en el archivo aparte) y TOTAL = montoA. */
  private esSoloParteA(f: FilaDetalle): boolean {
    return f.regimen === 'por_tantos';
  }

  /** Total que muestra el archivo principal: montoA para "por tantos"
   * (su extra es lo B), el total completo para el resto. */
  private totalPrincipal(f: FilaDetalle): number {
    return this.esSoloParteA(f) ? num(f.montoA) : num(f.total);
  }

  private filaPrincipal(f: FilaDetalle): unknown[] {
    const soloA = this.esSoloParteA(f);
    return [
      f.legajo,
      f.apellidoNombre,
      f.localidad,
      f.categoria,
      TIPO_POR_REGIMEN[f.regimen] ?? f.regimen,
      soloA ? numOrNull(f.horasCct) : numOrNull(f.horasTotal),
      numOrNull(f.horasCct),
      f.tienePresentismo ? 'SI' : 'NO',
      numOrNull(f.precioBruto),
      num(f.noRemunerativo),
      num(f.totalBruto),
      // El plus individual de un "por tantos" viaja en B (ver montoB en el
      // cierre), así que en el archivo principal no se muestra.
      soloA ? num(f.montoProductividad) : num(f.montoProductividad) + num(f.plusIndividual),
      num(f.montoGuardias),
      soloA ? null : numOrNull(f.horasExtra),
      soloA ? 0 : num(f.montoHorasExtra),
      num(f.montoPresentismo),
      f.novedadesTexto,
      this.totalPrincipal(f),
    ];
  }

  private agregarHojaPrincipal(wb: ExcelJS.Workbook, nombre: string, filas: FilaDetalle[]) {
    const ws = wb.addWorksheet(nombre);
    ws.addRow([...COLUMNAS_PRINCIPAL]);
    for (const f of filas) ws.addRow(this.filaPrincipal(f));
    return ws;
  }

  /** RESUMEN: total $ por localidad + por zona (solo las presentes) + total
   * general (spec §5.1.4). Suma `totalPrincipal` (montoA para "por tantos")
   * para que el resumen cierre contra la columna TOTAL de las hojas. */
  private agregarHojaResumen(wb: ExcelJS.Workbook, detalle: FilaDetalle[]) {
    const ws = wb.addWorksheet('RESUMEN');

    const totalPorLocalidad = new Map<string, number>();
    for (const f of detalle) {
      const clave = f.localidad ?? '(sin localidad)';
      totalPorLocalidad.set(clave, (totalPorLocalidad.get(clave) ?? 0) + this.totalPrincipal(f));
    }

    ws.addRow(['LOCALIDAD', 'TOTAL $']);
    for (const [localidad, total] of totalPorLocalidad) ws.addRow([localidad, total]);

    ws.addRow([]);
    ws.addRow(['ZONA', 'TOTAL $']);
    const totalNorte = detalle.filter((f) => f.zona === 'norte').reduce((acc, f) => acc + this.totalPrincipal(f), 0);
    const totalSur = detalle.filter((f) => f.zona === 'sur').reduce((acc, f) => acc + this.totalPrincipal(f), 0);
    const totalSinZona = detalle.filter((f) => f.zona == null).reduce((acc, f) => acc + this.totalPrincipal(f), 0);
    if (detalle.some((f) => f.zona === 'norte')) ws.addRow(['NORTE', totalNorte]);
    if (detalle.some((f) => f.zona === 'sur')) ws.addRow(['TUCUMAN', totalSur]);
    if (detalle.some((f) => f.zona == null)) ws.addRow(['SIN ZONA', totalSinZona]);

    ws.addRow([]);
    const totalGeneral = detalle.reduce((acc, f) => acc + this.totalPrincipal(f), 0);
    ws.addRow(['TOTAL GENERAL', totalGeneral]);

    return ws;
  }

  /** Ventana de fechas de la hoja DIAS TRABAJADOS (ADR-024): las 3 quincenas
   * corridas que se congelan desde el ADR (la cerrada + las 2 anteriores), o
   * SOLO la quincena cerrada cuando la foto no tiene ningún día previo — que
   * es el caso de los cierres anteriores al ADR, cuya foto nunca salió de su
   * quincena y quedaría con un mes entero de columnas vacías.
   *
   * La ventana es binaria a propósito (3 quincenas o 1) y NO se recorta a la
   * mínima fecha presente en la foto: recortar haría arrancar el bloque un día
   * arbitrario (el primero que alguien trabajó, que no es un límite de
   * quincena) y con la foto vacía no habría fecha de dónde derivar nada. La
   * binaria siempre alinea a límites de quincena. */
  private ventanaDiasTrabajados(
    dias: DiaCongelado[],
    anio: number,
    mes: number,
    quincena: number,
  ): { desde: Date; hasta: Date } {
    const { desde: desdeCerrada, hasta } = rangoQuincena(anio, mes, quincena);

    // Se comparan CLAVES "YYYY-MM-DD" (strings), NUNCA Date contra Date: el
    // límite de la quincena es un Date LOCAL y `d.fecha` viene de un `@db.Date`
    // (medianoche UTC). Compararlos como instantes shiftea un día en AR (UTC-3).
    const claveDesdeCerrada = claveLocal(desdeCerrada);
    const hayPrevias = dias.some((d) => claveUtc(new Date(d.fecha)) < claveDesdeCerrada);
    if (!hayPrevias) return { desde: desdeCerrada, hasta };

    return rangoVentanaDiasTrabajados(anio, mes, quincena);
  }

  /** DIAS TRABAJADOS: matriz Legajo/Nombre x día de la ventana, 1 si hay fila
   * (cuil,fecha) en la foto congelada (spec §5.1.5, punto abierto resuelto por
   * ADR-024). La ventana son 3 quincenas corridas —o solo la cerrada en los
   * cierres viejos, ver `ventanaDiasTrabajados`—, partida en bloques por mes
   * calendario y cada bloque cerrado con su "Total <Mes>": un NÚMERO, no una
   * fórmula de Excel (misma convención que RESUMEN). */
  private agregarHojaDiasTrabajados(
    wb: ExcelJS.Workbook,
    dias: DiaCongelado[],
    anio: number,
    mes: number,
    quincena: number,
  ) {
    const ws = wb.addWorksheet('DIAS TRABAJADOS');
    const { desde, hasta } = this.ventanaDiasTrabajados(dias, anio, mes, quincena);

    // `desde`/`hasta` son Date LOCAL (rangoQuincena); se itera y se keyea en
    // esa misma base local (claveLocal) — ver nota de las funciones de clave.
    const fechas: Date[] = [];
    for (let d = new Date(desde); d <= hasta; d.setDate(d.getDate() + 1)) fechas.push(new Date(d));

    // Bloques por mes calendario, en el orden en que aparecen las fechas. El
    // bucle es genérico (no asume "2 meses"): la ventana puede caer entera en
    // un mes (cierre viejo) o cruzar el año (diciembre → enero). La clave
    // lleva el año para que dos diciembres distintos nunca se mezclen.
    // `claveAnioMes` identifica el bloque ("2026-8", mes 1-12); `claves` son
    // las claves de día "YYYY-MM-DD" con las que se marca la matriz.
    const bloques: { claveAnioMes: string; mes: number; claves: string[]; etiquetas: string[] }[] = [];
    for (const f of fechas) {
      const mesDelDia = f.getMonth() + 1;
      const claveAnioMes = `${f.getFullYear()}-${mesDelDia}`;
      let bloque = bloques[bloques.length - 1];
      if (!bloque || bloque.claveAnioMes !== claveAnioMes) {
        bloque = { claveAnioMes, mes: mesDelDia, claves: [], etiquetas: [] };
        bloques.push(bloque);
      }
      bloque.claves.push(claveLocal(f));
      bloque.etiquetas.push(fechaDdMm(f));
    }

    ws.addRow([
      'Legajo',
      'NOMBRE Y APELLIDO',
      ...bloques.flatMap((b) => [...b.etiquetas, `Total ${nombreMes(b.mes)}`]),
    ]);

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
      const celdas: unknown[] = [emp.legajo, emp.apellidoNombre];
      for (const bloque of bloques) {
        let total = 0;
        for (const clave of bloque.claves) {
          const trabajado = emp.fechas.has(clave);
          if (trabajado) total++;
          celdas.push(trabajado ? 1 : '');
        }
        // Total del bloque como número, incluido el 0 del mes sin días: la
        // planilla se suma a mano y una celda vacía se lee como "falta el dato".
        celdas.push(total);
      }
      ws.addRow(celdas);
    }

    return ws;
  }

  async generarExcelPrincipal(cierreId: number): Promise<{ buffer: Buffer; filename: string }> {
    const cabecera = await this.cierres.detalle(cierreId);
    // Ordenada por empleado (y por fecha dentro de cada uno) para que las filas
    // de la hoja no dependan del orden en que se insertó la foto al cerrar.
    const dias = await this.prisma.cierreDiaTrabajado.findMany({
      where: { cierreId },
      orderBy: [{ apellidoNombre: 'asc' }, { fecha: 'asc' }],
    });

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
      const km = numOrNull(f.kmTotal);
      const montoKm = numOrNull(f.montoKmBruto);
      const precioKm =
        km != null && km > 0 && montoKm != null ? Math.round((montoKm / km) * 100) / 100 : null;
      ws.addRow([f.legajo, f.apellidoNombre, km, precioKm, numOrNull(f.montoB)]);
    }

    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, filename: `${this.nombreBase(cabecera)}_PorTantos B_v${cabecera.version}.xlsx` };
  }
}
