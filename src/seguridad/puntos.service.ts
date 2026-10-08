import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Rango de consulta, bordes incluidos ('YYYY-MM-DD'). Ver `rangoConsulta`:
 * sin períodos guardados, por defecto el año en curso. */
export interface Rango {
  desde: string;
  hasta: string;
}
import { ROL_HYS, TIPO_INSPECCION, armarRanking, dateADia, diaADate, puntoDelReporte } from './reglas';
import { mapaNombres } from './nombres';

function filtroFecha(rango: Rango) {
  return { gte: diaADate(rango.desde), lte: diaADate(rango.hasta) };
}

/** Puntaje, ranking y tableros. Todo sale de sumar movimientos (ADR-027):
 * nunca hay un total guardado. */
@Injectable()
export class PuntosService {
  constructor(private prisma: PrismaService) {}

  /**
   * Quiénes no compiten: HyS (aprueba y pone los puntajes) y quien no está
   * en la nómina (usuarios fuera de nómina, ADR-008). Devuelve también los
   * datos de nómina de los que sí compiten, para no consultar dos veces.
   */
  private async participantes(cuils: string[]) {
    const unicos = [...new Set(cuils)];
    const [hys, nomina] = await Promise.all([
      this.prisma.usuario.findMany({ where: { rol: { nombre: ROL_HYS } }, select: { cuil: true } }),
      this.prisma.snuempleados.findMany({
        where: { cuil: { in: unicos } },
        select: { cuil: true, apellido_nombre: true, legajo: true },
      }),
    ]);
    const enNomina = new Map(nomina.map((e) => [e.cuil, e]));
    const excluir = new Set([...hys.map((u) => u.cuil), ...unicos.filter((c) => !enNomina.has(c))]);
    return { excluir, enNomina };
  }

  private async rankingDe(rango: Rango) {
    const movimientos = await this.prisma.segMovimientoPuntos.findMany({
      where: { fecha: filtroFecha(rango) },
      select: { cuil: true, puntos: true },
    });
    const { excluir, enNomina } = await this.participantes(movimientos.map((m) => m.cuil));
    return { filas: armarRanking(movimientos, excluir), enNomina };
  }

  /** Ranking con nombres: solo para HyS y Admin. Avisa cuántos reportes del
   * período siguen pendientes, porque el ranking todavía puede cambiar. */
  async ranking(rango: Rango) {
    const [{ filas, enNomina }, pendientes] = await Promise.all([
      this.rankingDe(rango),
      this.prisma.segReporte.count({ where: { estado: 'pendiente', fechaReporte: filtroFecha(rango) } }),
    ]);
    return {
      ...rango,
      pendientes,
      filas: filas.map((f) => ({
        ...f,
        nombre: enNomina.get(f.cuil)?.apellido_nombre.trim() ?? '',
        legajo: enNomina.get(f.cuil)?.legajo ?? null,
      })),
    };
  }

  /**
   * Lo que cada persona ve de sí misma (CONTEXT.md, "Mis puntos"): su
   * puntaje y movimientos, su posición y los puntajes de quienes van
   * delante (sin nombres), y las inspecciones que la restaron (sin fotos,
   * sin quién de HyS la cargó y sin los otros involucrados).
   */
  async misPuntos(cuil: string, rango: Rango) {
    const [{ filas }, movimientos] = await Promise.all([
      this.rankingDe(rango),
      this.prisma.segMovimientoPuntos.findMany({
        where: { cuil, fecha: filtroFecha(rango) },
        orderBy: { fecha: 'desc' },
        select: {
          puntos: true,
          fecha: true,
          reporte: {
            select: {
              id: true,
              tipo: true,
              descripcion: true,
              naturaleza: { select: { nombre: true } },
              contrato: { select: { codigo: true } },
            },
          },
        },
      }),
    ]);
    const mia = filas.find((f) => f.cuil === cuil) ?? null;
    const mas = movimientos.filter((m) => m.puntos > 0).reduce((s, m) => s + m.puntos, 0);
    const menos = movimientos.filter((m) => m.puntos < 0).reduce((s, m) => s - m.puntos, 0);

    return {
      ...rango,
      puntos: { total: mas - menos, mas, menos },
      // null: no compite (HyS, fuera de nómina) o no tiene movimientos.
      posicion: mia ? { puesto: mia.puesto, de: filas.length } : null,
      delante: mia ? filas.filter((f) => f.puesto < mia.puesto).map((f) => ({ puesto: f.puesto, total: f.total })) : [],
      inspecciones: movimientos
        .filter((m) => m.reporte.tipo === TIPO_INSPECCION)
        .map((m) => ({
          fecha: dateADia(m.fecha),
          naturaleza: m.reporte.naturaleza?.nombre ?? null,
          contrato: m.reporte.contrato.codigo,
          descripcion: m.reporte.descripcion,
          puntos: m.puntos,
        })),
      movimientos: movimientos.map((m) => ({
        fecha: dateADia(m.fecha),
        tipo: m.reporte.tipo,
        // El id solo para los reportes propios: el de una inspección no se
        // abre (es de HyS).
        reporteId: m.reporte.tipo === TIPO_INSPECCION ? null : m.reporte.id,
        puntos: m.puntos,
      })),
    };
  }

  /** Tableros de HyS. Cada corte sale de un campo cerrado, nunca de texto
   * libre. Los anulados no cuentan para nada. */
  async tableros(rango: Rango) {
    const reportes = await this.prisma.segReporte.findMany({
      where: { estado: { not: 'anulado' }, fechaReporte: filtroFecha(rango) },
      select: {
        tipo: true,
        estado: true,
        autorCuil: true,
        fechaReporte: true,
        createdAt: true,
        calificadoEn: true,
        puntaje: true,
        provincia: { select: { nombre: true } },
        contrato: { select: { codigo: true } },
        tarea: { select: { nombre: true } },
        naturaleza: { select: { nombre: true } },
        motivoParalizacion: { select: { nombre: true } },
        involucrados: { select: { cuil: true } },
        latitud: true,
        longitud: true,
        errorMetros: true,
        fotos: {
          where: { eliminadoEn: null, origen: 'camara', latitud: { not: null } },
          select: { origen: true, latitud: true, longitud: true, errorMetros: true },
        },
      },
    });

    const contar = (claves: (string | null | undefined)[]) => {
      const m = new Map<string, number>();
      for (const k of claves) if (k) m.set(k, (m.get(k) ?? 0) + 1);
      return [...m.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
    };
    const inspecciones = reportes.filter((r) => r.tipo === TIPO_INSPECCION);
    const deLaGente = reportes.filter((r) => r.tipo !== TIPO_INSPECCION);
    const calificados = reportes.filter((r) => r.calificadoEn);

    // "Lo que la gente reporta vs. lo que HyS encuentra", por naturaleza.
    const porNaturaleza = new Map<string, { reportes: number; inspecciones: number }>();
    for (const r of reportes) {
      if (!r.naturaleza) continue;
      const acc = porNaturaleza.get(r.naturaleza.nombre) ?? { reportes: 0, inspecciones: 0 };
      if (r.tipo === TIPO_INSPECCION) acc.inspecciones++;
      else acc.reportes++;
      porNaturaleza.set(r.naturaleza.nombre, acc);
    }

    // Personas más inspeccionadas (solo inspecciones aprobadas restan).
    const inspeccionados = new Map<string, { cantidad: number; puntos: number }>();
    for (const r of inspecciones) {
      for (const i of r.involucrados) {
        const acc = inspeccionados.get(i.cuil) ?? { cantidad: 0, puntos: 0 };
        acc.cantidad++;
        if (r.estado === 'aprobado') acc.puntos -= r.puntaje ?? 0;
        inspeccionados.set(i.cuil, acc);
      }
    }
    const topInspeccionados = [...inspeccionados.entries()].sort((a, b) => b[1].cantidad - a[1].cantidad).slice(0, 10);
    const nombres = await mapaNombres(this.prisma, topInspeccionados.map(([c]) => c));

    const porMes = new Map<string, { reportes: number; inspecciones: number }>();
    for (const r of reportes) {
      const mes = dateADia(r.fechaReporte).slice(0, 7);
      const acc = porMes.get(mes) ?? { reportes: 0, inspecciones: 0 };
      if (r.tipo === TIPO_INSPECCION) acc.inspecciones++;
      else acc.reportes++;
      porMes.set(mes, acc);
    }

    const horasRespuesta = calificados.map((r) => (r.calificadoEn!.getTime() - r.createdAt.getTime()) / 36e5);
    const nominaActiva = await this.prisma.snuempleados.count({ where: { activo: 'S' } });

    return {
      ...rango,
      totales: {
        reportes: deLaGente.length,
        inspecciones: inspecciones.length,
        pendientes: reportes.filter((r) => r.estado === 'pendiente').length,
        aprobados: reportes.filter((r) => r.estado === 'aprobado').length,
        desaprobados: reportes.filter((r) => r.estado === 'desaprobado').length,
      },
      participacion: { personas: new Set(deLaGente.map((r) => r.autorCuil)).size, nominaActiva },
      respuestaHysDias: horasRespuesta.length
        ? Math.round((horasRespuesta.reduce((s, h) => s + h, 0) / horasRespuesta.length / 24) * 10) / 10
        : null,
      conPunto: reportes.filter((r) =>
        puntoDelReporte(
          r.fotos.map((f) => ({ ...f, latitud: Number(f.latitud), longitud: Number(f.longitud) })),
          { latitud: r.latitud === null ? null : Number(r.latitud), longitud: r.longitud === null ? null : Number(r.longitud), errorMetros: r.errorMetros },
        ),
      ).length,
      porTipo: contar(reportes.map((r) => r.tipo)),
      porContrato: contar(reportes.map((r) => r.contrato.codigo)),
      porTarea: contar(reportes.map((r) => `${r.contrato.codigo} › ${r.tarea.nombre}`)).slice(0, 15),
      porProvincia: contar(reportes.map((r) => r.provincia.nombre)),
      porMotivoParalizacion: contar(reportes.map((r) => r.motivoParalizacion?.nombre)),
      porNaturaleza: [...porNaturaleza.entries()]
        .map(([nombre, v]) => ({ nombre, ...v }))
        .sort((a, b) => b.reportes + b.inspecciones - (a.reportes + a.inspecciones)),
      porMes: [...porMes.entries()].map(([mes, v]) => ({ mes, ...v })).sort((a, b) => a.mes.localeCompare(b.mes)),
      masInspeccionados: topInspeccionados.map(([cuil, v]) => ({ cuil, nombre: nombres.get(cuil) ?? '', ...v })),
    };
  }
}
