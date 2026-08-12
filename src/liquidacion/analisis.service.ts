import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalculoService } from './calculo.service';
import { quincenaAnterior, quincenasHaciaAtras, rangoQuincena } from '../common/quincena';

/**
 * Análisis de la quincena liquidada (plan 2026-08-12): KPIs, composición del
 * pago, top cobradores, corte por contrato (prorrateo por horas aprobadas),
 * histórico y variaciones por persona. ORQUESTA el motor existente
 * (CalculoService#calcularQuincena) — cálculo en vivo, sin snapshots (ADR-010).
 */

type FilaCalculo = Awaited<ReturnType<CalculoService['calcularQuincena']>>[number];

export interface AnalisisQuincena {
  periodo: { anio: number; mes: number; quincena: number };
  totales: {
    total: number;
    empleados: number;
    empleadosNuevos: number;
    horasCct: number;
    horasExtra: number;
    costoPromedio: number;
  };
  anterior: { total: number; empleados: number; costoPromedio: number } | null;
  composicion: { basico: number; extras: number; presentismo: number; plus: number; bono: number };
  topCobradores: {
    cuil: string;
    nombre: string;
    total: number;
    totalAnterior: number | null;
    deltaPct: number | null;
    diasTrabajados: number;
  }[];
  contratos: {
    contratoId: number | null;
    codigo: string;
    nombre: string;
    monto: number;
    horas: number;
    pctDelTotal: number;
  }[];
  historico: { anio: number; mes: number; quincena: number; total: number }[];
  variaciones: {
    cuil: string;
    nombre: string;
    regimen: string;
    total: number;
    totalAnterior: number | null;
    deltaMonto: number | null;
    deltaPct: number | null;
    diasTrabajados: number;
  }[];
}

const redondear2 = (x: number) => Math.round(x * 100) / 100;
const redondear1 = (x: number) => Math.round(x * 10) / 10;

@Injectable()
export class AnalisisService {
  constructor(
    private prisma: PrismaService,
    private calculo: CalculoService,
  ) {}

  async getAnalisis(anio: number, mes: number, quincena: number): Promise<AnalisisQuincena> {
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);

    const filas = await this.calculo.calcularQuincena(anio, mes, quincena);
    const ant = quincenaAnterior(anio, mes, quincena);
    const filasAnt = await this.calculo.calcularQuincena(ant.anio, ant.mes, ant.quincena);

    // Histórico: el motor hace ~10 queries por quincena (prefetch masivo, §39)
    // — 8 quincenas ≈ 80 queries, aceptable para una pantalla de análisis.
    // Actual y anterior reusan los resultados ya calculados.
    const periodos = quincenasHaciaAtras(anio, mes, quincena, 8);
    const historico: AnalisisQuincena['historico'] = [];
    for (const p of periodos) {
      let filasPeriodo: FilaCalculo[];
      if (p.anio === anio && p.mes === mes && p.quincena === quincena) filasPeriodo = filas;
      else if (p.anio === ant.anio && p.mes === ant.mes && p.quincena === ant.quincena) filasPeriodo = filasAnt;
      else filasPeriodo = await this.calculo.calcularQuincena(p.anio, p.mes, p.quincena);
      historico.push({ ...p, total: redondear2(filasPeriodo.reduce((s, f) => s + f.total, 0)) });
    }

    // Días trabajados = días distintos con horas aprobadas en la quincena.
    const diasRegistros = await this.prisma.registroHoras.findMany({
      where: { fecha: { gte: desde, lte: hasta }, estado: 'aprobado' },
      select: { operarioCuil: true, fecha: true },
      distinct: ['operarioCuil', 'fecha'],
    });
    const diasPorCuil = new Map<string, number>();
    for (const r of diasRegistros) diasPorCuil.set(r.operarioCuil, (diasPorCuil.get(r.operarioCuil) ?? 0) + 1);

    // Prorrateo por contrato: horas aprobadas por (cuil, contrato).
    const horasPorContrato = await this.prisma.registroHoras.groupBy({
      by: ['operarioCuil', 'contratoId'],
      where: { fecha: { gte: desde, lte: hasta }, estado: 'aprobado' },
      _sum: { horas: true },
    });
    const horasPorCuil = new Map<string, { contratoId: number; horas: number }[]>();
    for (const h of horasPorContrato) {
      const horas = Number(h._sum.horas ?? 0);
      if (horas <= 0) continue;
      if (!horasPorCuil.has(h.operarioCuil)) horasPorCuil.set(h.operarioCuil, []);
      horasPorCuil.get(h.operarioCuil)!.push({ contratoId: h.contratoId, horas });
    }

    const totalQuincena = filas.reduce((s, f) => s + f.total, 0);

    // Reparto del total de cada empleado proporcional a sus horas por contrato;
    // sin horas aprobadas → bucket "Sin contrato asignable" (contratoId null).
    const acumulado = new Map<number | null, { monto: number; horas: number }>();
    const acumular = (contratoId: number | null, monto: number, horas: number) => {
      const prev = acumulado.get(contratoId) ?? { monto: 0, horas: 0 };
      acumulado.set(contratoId, { monto: prev.monto + monto, horas: prev.horas + horas });
    };
    for (const f of filas) {
      const reparto = horasPorCuil.get(f.cuil);
      if (!reparto || reparto.length === 0) {
        acumular(null, f.total, 0);
        continue;
      }
      const horasEmpleado = reparto.reduce((s, r) => s + r.horas, 0);
      for (const r of reparto) acumular(r.contratoId, (f.total * r.horas) / horasEmpleado, r.horas);
    }

    const idsContratos = [...acumulado.keys()].filter((id): id is number => id !== null);
    const contratosDb = idsContratos.length
      ? await this.prisma.contrato.findMany({ where: { id: { in: idsContratos } } })
      : [];
    const contratoPorId = new Map(contratosDb.map((c) => [c.id, c]));

    const contratos: AnalisisQuincena['contratos'] = [...acumulado.entries()]
      .map(([contratoId, acc]) => ({
        contratoId,
        codigo: contratoId === null ? 'Sin contrato asignable' : (contratoPorId.get(contratoId)?.codigo ?? `#${contratoId}`),
        nombre: contratoId === null ? 'Sin contrato asignable' : (contratoPorId.get(contratoId)?.nombre ?? `Contrato #${contratoId}`),
        monto: redondear2(acc.monto),
        horas: acc.horas,
        pctDelTotal: totalQuincena > 0 ? redondear1((acc.monto / totalQuincena) * 100) : 0,
      }))
      .sort((a, b) => {
        if (a.contratoId === null) return 1; // el bucket sin contrato va último
        if (b.contratoId === null) return -1;
        return b.monto - a.monto;
      });

    // Composición del pago a partir de las filas del motor.
    const composicion = {
      basico: redondear2(filas.reduce((s, f) => s + f.totalBruto, 0)),
      extras: redondear2(filas.reduce((s, f) => s + f.montoHorasExtra, 0)),
      presentismo: redondear2(filas.reduce((s, f) => s + f.montoPresentismo, 0)),
      plus: redondear2(filas.reduce((s, f) => s + f.plus.reduce((sp, p) => sp + p.monto, 0), 0)),
      bono: redondear2(filas.reduce((s, f) => s + f.noRemunerativo, 0)),
    };

    // Variaciones por persona contra la quincena anterior.
    const anteriorPorCuil = new Map(filasAnt.map((f) => [f.cuil, f]));
    const variaciones: AnalisisQuincena['variaciones'] = filas
      .map((f) => {
        const filaAnt = anteriorPorCuil.get(f.cuil);
        const totalAnterior = filaAnt ? redondear2(filaAnt.total) : null;
        const esNuevo = totalAnterior === null || totalAnterior === 0;
        return {
          cuil: f.cuil,
          nombre: f.apellidoNombre,
          regimen: f.regimen,
          total: redondear2(f.total),
          totalAnterior,
          deltaMonto: esNuevo ? null : redondear2(f.total - totalAnterior!),
          deltaPct: esNuevo ? null : redondear1(((f.total - totalAnterior!) / totalAnterior!) * 100),
          diasTrabajados: diasPorCuil.get(f.cuil) ?? 0,
        };
      })
      .sort((a, b) => {
        if (a.deltaPct === null && b.deltaPct === null) return b.total - a.total;
        if (a.deltaPct === null) return 1; // los nuevos al final
        if (b.deltaPct === null) return -1;
        return Math.abs(b.deltaPct) - Math.abs(a.deltaPct);
      });

    const topCobradores: AnalisisQuincena['topCobradores'] = [...variaciones]
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(({ cuil, nombre, total, totalAnterior, deltaPct, diasTrabajados }) => ({
        cuil,
        nombre,
        total,
        totalAnterior,
        deltaPct,
        diasTrabajados,
      }));

    const empleados = filas.length;
    const totalAnt = filasAnt.reduce((s, f) => s + f.total, 0);

    return {
      periodo: { anio, mes, quincena },
      totales: {
        total: redondear2(totalQuincena),
        empleados,
        empleadosNuevos: filas.filter((f) => !anteriorPorCuil.has(f.cuil)).length,
        horasCct: redondear2(filas.reduce((s, f) => s + f.horasCct, 0)),
        horasExtra: redondear2(filas.reduce((s, f) => s + f.horasExtra, 0)),
        costoPromedio: empleados > 0 ? redondear2(totalQuincena / empleados) : 0,
      },
      anterior:
        filasAnt.length > 0
          ? {
              total: redondear2(totalAnt),
              empleados: filasAnt.length,
              costoPromedio: redondear2(totalAnt / filasAnt.length),
            }
          : null,
      composicion,
      topCobradores,
      contratos,
      historico,
      variaciones,
    };
  }
}
