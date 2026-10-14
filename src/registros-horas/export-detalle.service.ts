import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodoPanel } from './periodo-panel';
import type { FiltrosPanel } from './registros-horas.service';

const COLUMNAS = [
  { header: 'Fecha', key: 'fecha', width: 12 },
  { header: 'Quincena', key: 'quincena', width: 12 },
  { header: 'Operario', key: 'operario', width: 32 },
  { header: 'CUIL', key: 'cuil', width: 15 },
  { header: 'Contrato', key: 'contrato', width: 10 },
  { header: 'Nombre del contrato', key: 'contratoNombre', width: 30 },
  { header: 'Provincia', key: 'provincia', width: 14 },
  { header: 'Tareas', key: 'tareas', width: 40 },
  { header: 'Horas', key: 'horas', width: 8 },
  { header: 'Estado', key: 'estado', width: 12 },
  { header: 'Móviles', key: 'moviles', width: 20 },
  { header: 'Observación', key: 'observacion', width: 50 },
  { header: 'Cargado por', key: 'cargadoPor', width: 28 },
  { header: 'Cargado el', key: 'cargadoEn', width: 17 },
  { header: 'Aprobado/desaprobado por', key: 'resueltoPor', width: 28 },
  { header: 'Aprobado/desaprobado el', key: 'resueltoEn', width: 17 },
];

const ESTADOS: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  desaprobado: 'Desaprobado',
};

/** Fecha y hora de un instante (created_at, aprobado_en) en hora argentina,
 * no la del servidor. */
const fechaHoraAr = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Date local → "AAAA-MM-DD", para el nombre del archivo. */
function claveDia(fecha: Date) {
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mm}-${dd}`;
}

/** Excel del Detalle diario del panel Control general (ADR-030): una fila por
 * registro, con móviles y observación. A diferencia de la pantalla, exporta
 * SOLO las filas que cumplen los filtros y caen en mis contratos — nada de
 * contratos ajenos: es lo que hizo mi gente en mis contratos. */
@Injectable()
export class ExportDetalleService {
  constructor(private prisma: PrismaService) {}

  async generar(usuario: { cuil: string; rol: string }, periodo: PeriodoPanel, filtros: FiltrosPanel = {}) {
    const contratos = await this.prisma.contrato.findMany({
      where: usuario.rol === 'Admin' ? {} : { jefes: { some: { usuarioCuil: usuario.cuil } } },
      select: { id: true },
    });
    const misContratoIds = contratos.map((c) => c.id);
    const contratoIds = filtros.contratoIds
      ? misContratoIds.filter((id) => filtros.contratoIds!.includes(id))
      : misContratoIds;

    const filas =
      contratoIds.length === 0
        ? []
        : await this.prisma.registroHoras.findMany({
            where: {
              contratoId: { in: contratoIds },
              fecha: { gte: periodo.desde, lte: periodo.hasta },
              ...(filtros.provinciaIds ? { provinciaId: { in: filtros.provinciaIds } } : {}),
              ...(filtros.operarioCuils ? { operarioCuil: { in: filtros.operarioCuils } } : {}),
              ...(filtros.tareaIds ? { tareas: { some: { tareaId: { in: filtros.tareaIds } } } } : {}),
            },
            select: {
              fecha: true, operarioCuil: true, horas: true, estado: true, observacion: true,
              createdAt: true, aprobadoEn: true,
              operario: { select: { apellido_nombre: true } },
              contrato: { select: { codigo: true, nombre: true } },
              provincia: { select: { nombre: true } },
              tareas: { select: { tarea: { select: { nombre: true } } } },
              moviles: { select: { movil: { select: { identificador: true } } } },
              cargadoPor: { select: { cuil: true, nombreFueraNomina: true } },
              aprobadoPor: { select: { cuil: true, nombreFueraNomina: true } },
            },
            orderBy: [{ fecha: 'asc' }, { operarioCuil: 'asc' }],
          });

    // Quién cargó/aprobó: snuempleados con fallback a nombreFueraNomina, mismo
    // criterio que el Detalle diario en pantalla.
    const cuilsAuditoria = new Set<string>();
    for (const f of filas) {
      cuilsAuditoria.add(f.cargadoPor.cuil);
      if (f.aprobadoPor) cuilsAuditoria.add(f.aprobadoPor.cuil);
    }
    const empleados = await this.prisma.snuempleados.findMany({
      where: { cuil: { in: [...cuilsAuditoria] } },
      select: { cuil: true, apellido_nombre: true },
    });
    const nombrePorCuil = new Map(empleados.map((e) => [e.cuil, e.apellido_nombre]));
    const nombre = (u: { cuil: string; nombreFueraNomina: string | null }) =>
      nombrePorCuil.get(u.cuil) ?? u.nombreFueraNomina ?? '';

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Detalle diario');
    ws.columns = COLUMNAS;
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS.length } };

    // Mismo orden que la pantalla para un mismo día: por nombre, no por CUIL.
    const ordenadas = [...filas].sort(
      (a, b) =>
        a.fecha.getTime() - b.fecha.getTime() ||
        a.operario.apellido_nombre.localeCompare(b.operario.apellido_nombre),
    );
    for (const f of ordenadas) {
      // `fecha` es @db.Date: llega como medianoche UTC, se lee en UTC.
      const dia = f.fecha.getUTCDate();
      ws.addRow({
        fecha: f.fecha,
        quincena: `${dia <= 15 ? '1ra' : '2da'} ${String(f.fecha.getUTCMonth() + 1).padStart(2, '0')}/${f.fecha.getUTCFullYear()}`,
        operario: f.operario.apellido_nombre,
        cuil: f.operarioCuil,
        contrato: f.contrato.codigo,
        contratoNombre: f.contrato.nombre,
        provincia: f.provincia.nombre,
        tareas: f.tareas.map((t) => t.tarea.nombre).join(', ') || null,
        horas: Number(f.horas),
        estado: ESTADOS[f.estado] ?? f.estado,
        moviles: f.moviles.map((m) => m.movil.identificador).join(', ') || null,
        observacion: f.observacion || null,
        cargadoPor: nombre(f.cargadoPor),
        cargadoEn: fechaHoraAr.format(f.createdAt),
        resueltoPor: f.aprobadoPor ? nombre(f.aprobadoPor) : null,
        resueltoEn: f.aprobadoEn ? fechaHoraAr.format(f.aprobadoEn) : null,
      });
    }
    ws.getColumn('fecha').numFmt = 'dd/mm/yyyy';

    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;
    return { buffer, filename: `detalle-diario_${claveDia(periodo.desde)}_${claveDia(periodo.hasta)}.xlsx` };
  }
}
