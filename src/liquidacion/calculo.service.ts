import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { rangoQuincena } from '../common/quincena';

/**
 * Motor de cálculo de liquidación por quincena. Ver ADR-009, ADR-010 y
 * ADR-011 (fórmulas confirmadas contra datos reales del usuario).
 *
 * Perf: todo el período se prefetchea en un puñado de queries (catálogos
 * versionados sin filtrar + registros/novedades del rango) y el cómputo por
 * perfil se resuelve en memoria — evita el N+1 de una query por perfil
 * (~120 perfiles x 4-6 queries c/u contra una BD remota).
 */
@Injectable()
export class CalculoService {
  constructor(private prisma: PrismaService) {}

  private rangoQuincena(anio: number, mes: number, quincena: number): { desde: Date; hasta: Date } {
    return rangoQuincena(anio, mes, quincena);
  }

  /** Días de una novedad que caen dentro de [desde, hasta], recortando a los bordes. Reusado por PanelService. */
  diasClip(fechaInicio: Date, fechaFin: Date | null, desde: Date, hasta: Date): number {
    const fin = fechaFin ?? fechaInicio;
    const inicioClamp = fechaInicio > desde ? fechaInicio : desde;
    const finClamp = fin < hasta ? fin : hasta;
    const diff = Math.floor((finClamp.getTime() - inicioClamp.getTime()) / 86_400_000) + 1;
    return diff > 0 ? diff : 0;
  }

  /** De una lista ya cargada en memoria, la fila con vigenteDesde <= fecha más reciente. */
  private masVigente<T extends { vigenteDesde: Date }>(rows: T[], fecha: Date): T | null {
    let best: T | null = null;
    for (const r of rows) {
      if (r.vigenteDesde <= fecha && (!best || r.vigenteDesde > best.vigenteDesde)) best = r;
    }
    return best;
  }

  async calcularQuincena(anio: number, mes: number, quincena: number) {
    const { desde, hasta } = this.rangoQuincena(anio, mes, quincena);
    const fechaVigencia = new Date(anio, mes - 1, 1);

    const perfiles = await this.prisma.perfilLiquidacion.findMany({
      where: { regimen: { not: 'administrativo' } },
      include: {
        empleado: { select: { apellido_nombre: true, legajo: true, cargo: true, provincia: true } },
        categoria: { select: { id: true, nombre: true } },
      },
      orderBy: { cuil: 'asc' },
    });
    const cuils = perfiles.map((p) => p.cuil);

    const tiposConPlus = await this.prisma.tipoNovedad.findMany({ where: { generaPlus: true, activo: true } });

    const montosMensualizados = await this.prisma.montoMensualizado.findMany({ where: { anio, mes, quincena } });
    const montoMensualPorCuil = new Map(montosMensualizados.map((m) => [m.cuil, Number(m.monto)]));

    const kmsPorTantos = await this.prisma.kmPorTantos.findMany({ where: { anio, mes, quincena } });
    const kmPorCuil = new Map(kmsPorTantos.map((k) => [k.cuil, Number(k.kmTotal)]));

    // Catálogos versionados: tablas chicas, se traen enteras (sin filtro por
    // categoría/tipo) y se resuelve "vigente" en memoria por clave.
    const [tarifas, montosPlus, bonos, rangosKm] = await Promise.all([
      this.prisma.tarifaCategoriaUocra.findMany(),
      this.prisma.montoNovedadPlus.findMany(),
      this.prisma.bonoNoRemunerativo.findMany(),
      this.prisma.rangoKmPorTantos.findMany(),
    ]);

    // Rango de km vigente para el mes: el "último" vigenteDesde se resuelve
    // una sola vez sobre TODA la tabla (no por bracket) y después, dentro de
    // esa vigencia, cada perfil busca el bracket que le corresponde por km.
    const kmVigencia = this.masVigente(rangosKm, fechaVigencia)?.vigenteDesde ?? null;
    const rangosKmVigentes = kmVigencia
      ? rangosKm.filter((r) => r.vigenteDesde.getTime() === kmVigencia.getTime())
      : [];

    // Horas aprobadas del rango, sumadas por cuil en una sola query.
    const horasAprobadas = await this.prisma.registroHoras.groupBy({
      by: ['operarioCuil'],
      where: { operarioCuil: { in: cuils }, estado: 'aprobado', fecha: { gte: desde, lte: hasta } },
      _sum: { horas: true },
    });
    const horasAprobadasPorCuil = new Map(horasAprobadas.map((h) => [h.operarioCuil, Number(h._sum.horas ?? 0)]));

    // Novedades solapadas al rango, para todos los perfiles en una sola query.
    const novedades = await this.prisma.novedad.findMany({
      where: {
        operarioCuil: { in: cuils },
        fechaInicio: { lte: hasta },
        OR: [{ fechaFin: null }, { fechaFin: { gte: desde } }],
      },
      include: { tipoNovedad: true },
    });
    const novedadesPorCuil = new Map<string, typeof novedades>();
    for (const n of novedades) {
      if (!novedadesPorCuil.has(n.operarioCuil)) novedadesPorCuil.set(n.operarioCuil, []);
      novedadesPorCuil.get(n.operarioCuil)!.push(n);
    }

    const resultado = [];

    for (const perfil of perfiles) {
      const tarifaHora = perfil.categoriaUocraId
        ? (this.masVigente(
            tarifas.filter((t) => t.categoriaUocraId === perfil.categoriaUocraId),
            fechaVigencia,
          )?.importeHora ?? null)
        : null;
      const tarifaHoraNum = tarifaHora != null ? Number(tarifaHora) : null;

      let horasTotal = 0;
      let horasCct = 0;
      let horasExtra = 0;
      let basico = 0;
      let montoExtra = 0;
      let datoFaltante: string | null = null;

      if (perfil.regimen === 'jornalizado') {
        horasTotal = horasAprobadasPorCuil.get(perfil.cuil) ?? 0;
        horasCct = Math.min(horasTotal, 88);
        horasExtra = Math.max(horasTotal - 88, 0);
        if (tarifaHoraNum != null) {
          basico = tarifaHoraNum * horasCct;
          montoExtra = horasExtra * tarifaHoraNum * 1.5;
        } else {
          datoFaltante = 'Sin categoría UOCRA / tarifa asignada';
        }
      } else if (perfil.regimen === 'fijo') {
        horasTotal = 88;
        horasCct = 88;
        if (tarifaHoraNum != null) {
          basico = tarifaHoraNum * 88;
        } else {
          datoFaltante = 'Sin categoría UOCRA / tarifa asignada';
        }
      } else if (perfil.regimen === 'mensualizado') {
        const monto = montoMensualPorCuil.get(perfil.cuil);
        horasTotal = 1;
        horasCct = 1;
        if (monto != null) {
          basico = monto;
        } else {
          datoFaltante = 'Falta cargar el monto mensualizado de esta quincena';
        }
      } else if (perfil.regimen === 'por_tantos') {
        const kmTotal = kmPorCuil.get(perfil.cuil);
        if (kmTotal == null) {
          datoFaltante = 'Falta cargar los km de esta quincena';
        } else if (tarifaHoraNum == null) {
          datoFaltante = 'Sin categoría UOCRA / tarifa asignada (necesaria para convertir km a horas)';
        } else {
          const rango = rangosKmVigentes.find(
            (r) => kmTotal >= Number(r.kmDesde) && (r.kmHasta == null || kmTotal <= Number(r.kmHasta)),
          );
          const montoKm = rango ? kmTotal * Number(rango.precioPorKm) : 0;
          horasTotal = tarifaHoraNum > 0 ? montoKm / tarifaHoraNum : 0;
          horasCct = Math.min(horasTotal, 88);
          horasExtra = Math.max(horasTotal - 88, 0);
          basico = tarifaHoraNum * horasCct;
          montoExtra = horasExtra * tarifaHoraNum * 1.5;
        }
      }

      const novedadesCuil = novedadesPorCuil.get(perfil.cuil) ?? [];

      // Presentismo: 20% del básico, salvo Ausencia desaprobada o Suspensión en el período.
      const ausenciaDesaprobada = novedadesCuil.some(
        (n) => n.tipoNovedad.nombre === 'Ausencia' && n.estadoHys === 'desaprobada',
      );
      const suspension = novedadesCuil.some((n) => n.tipoNovedad.nombre === 'Suspensión');
      const tienePresentismo = !ausenciaDesaprobada && !suspension;
      const presentismo = tienePresentismo ? basico * 0.2 : 0;

      // Plus de novedades (Guardia Pasiva, Viáticos, etc.)
      const plus: { tipoNovedadId: number; nombre: string; dias: number; monto: number }[] = [];
      for (const tipo of tiposConPlus) {
        const dias = novedadesCuil
          .filter((n) => n.tipoNovedadId === tipo.id)
          .reduce((s, n) => s + this.diasClip(n.fechaInicio, n.fechaFin, desde, hasta), 0);
        if (dias > 0) {
          const montoVigente = this.masVigente(
            montosPlus.filter((m) => m.tipoNovedadId === tipo.id),
            fechaVigencia,
          );
          const montoPorDia = montoVigente ? Number(montoVigente.montoPorDia) : null;
          plus.push({ tipoNovedadId: tipo.id, nombre: tipo.nombre, dias, monto: montoPorDia ? dias * montoPorDia : 0 });
        }
      }
      const totalPlus = plus.reduce((s, p) => s + p.monto, 0);

      // Bono no remunerativo (por categoría, opcional)
      let noRemunerativo = 0;
      if (perfil.categoriaUocraId) {
        const bono = this.masVigente(
          bonos.filter((b) => b.categoriaUocraId === perfil.categoriaUocraId),
          fechaVigencia,
        );
        if (bono) {
          noRemunerativo =
            bono.tipo === 'monto_fijo' ? Number(bono.valor) : (tarifaHoraNum ?? 0) * (Number(bono.valor) / 100);
        }
      }

      const total = basico + montoExtra + presentismo + totalPlus + noRemunerativo;

      const etiquetas: string[] = [];
      if (perfil.modalidadPago === 'en_b') etiquetas.push('Hs Extra y Presentismo en B');
      else if (perfil.modalidadPago === 'con_descuentos') etiquetas.push('Hs Extra y Presentismo con descuentos');
      for (const p of plus) etiquetas.push(p.nombre.toUpperCase());

      resultado.push({
        cuil: perfil.cuil,
        apellidoNombre: perfil.empleado.apellido_nombre,
        legajo: perfil.empleado.legajo,
        categoria: perfil.categoria?.nombre ?? null,
        regimen: perfil.regimen,
        provincia: perfil.empleado.provincia,
        modalidadPago: perfil.modalidadPago,
        precioBruto: tarifaHoraNum,
        horasTotal,
        horasCct,
        totalBruto: basico,
        horasExtra,
        montoHorasExtra: montoExtra,
        tienePresentismo,
        montoPresentismo: presentismo,
        plus,
        noRemunerativo,
        novedadesTexto: etiquetas.join(' y '),
        total,
        datoFaltante,
      });
    }

    return resultado;
  }

  /**
   * Alertas para revisar antes de liquidar: empleados con horas cargadas
   * pero sin perfil de liquidación, perfiles incompletos (sin categoría o
   * modalidad), y jornalizados con 0 horas aprobadas — distinguiendo si es
   * porque tienen horas pendientes de aprobar o porque nunca declararon
   * nada en el período (a un fijo/mensualizado/por_tantos no se le exige
   * horas, así que no se lo marca).
   */
  async getAlertasQuincena(anio: number, mes: number, quincena: number) {
    const { desde, hasta } = this.rangoQuincena(anio, mes, quincena);

    const registrosAgrupados = await this.prisma.registroHoras.groupBy({
      by: ['operarioCuil', 'estado'],
      where: { fecha: { gte: desde, lte: hasta } },
      _sum: { horas: true },
    });
    const horasPorCuil = new Map<string, { aprobadas: number; pendientes: number }>();
    for (const r of registrosAgrupados) {
      const actual = horasPorCuil.get(r.operarioCuil) ?? { aprobadas: 0, pendientes: 0 };
      if (r.estado === 'aprobado') actual.aprobadas += Number(r._sum.horas ?? 0);
      if (r.estado === 'pendiente') actual.pendientes += Number(r._sum.horas ?? 0);
      horasPorCuil.set(r.operarioCuil, actual);
    }

    const perfiles = await this.prisma.perfilLiquidacion.findMany({
      include: { empleado: { select: { apellido_nombre: true } } },
    });
    const perfilPorCuil = new Map(perfiles.map((p) => [p.cuil, p]));

    const empleadosConHoras = await this.prisma.snuempleados.findMany({
      where: { cuil: { in: [...horasPorCuil.keys()] } },
      select: { cuil: true, apellido_nombre: true },
    });
    const sinPerfil = empleadosConHoras
      .filter((e) => !perfilPorCuil.has(e.cuil))
      .map((e) => ({
        cuil: e.cuil,
        apellidoNombre: e.apellido_nombre,
        horasAprobadas: horasPorCuil.get(e.cuil)!.aprobadas,
        horasPendientes: horasPorCuil.get(e.cuil)!.pendientes,
      }));

    const necesitaCategoria = ['jornalizado', 'fijo', 'por_tantos'];
    const perfilIncompleto = perfiles
      .filter((p) => p.regimen !== 'administrativo')
      .filter((p) => (necesitaCategoria.includes(p.regimen) && !p.categoriaUocraId) || !p.modalidadPago)
      .map((p) => ({
        cuil: p.cuil,
        apellidoNombre: p.empleado.apellido_nombre,
        regimen: p.regimen,
        faltaCategoria: necesitaCategoria.includes(p.regimen) && !p.categoriaUocraId,
        faltaModalidad: !p.modalidadPago,
      }));

    const sinHorasAprobadas = perfiles
      .filter((p) => p.regimen === 'jornalizado')
      .map((p) => {
        const h = horasPorCuil.get(p.cuil) ?? { aprobadas: 0, pendientes: 0 };
        if (h.aprobadas > 0) return null;
        return {
          cuil: p.cuil,
          apellidoNombre: p.empleado.apellido_nombre,
          motivo: h.pendientes > 0 ? ('pendientes' as const) : ('sin_declarar' as const),
          horasPendientes: h.pendientes,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    return { sinPerfil, perfilIncompleto, sinHorasAprobadas };
  }
}
