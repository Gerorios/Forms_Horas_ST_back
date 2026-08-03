import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { rangoQuincena } from '../common/quincena';

/**
 * Motor de cálculo de liquidación por quincena. Ver ADR-009, ADR-010 y
 * ADR-011 (fórmulas confirmadas contra datos reales del usuario).
 */
@Injectable()
export class CalculoService {
  constructor(private prisma: PrismaService) {}

  private rangoQuincena(anio: number, mes: number, quincena: number): { desde: Date; hasta: Date } {
    return rangoQuincena(anio, mes, quincena);
  }

  private async tarifaVigente(categoriaUocraId: number, anio: number, mes: number) {
    const fecha = new Date(anio, mes - 1, 1);
    const tarifa = await this.prisma.tarifaCategoriaUocra.findFirst({
      where: { categoriaUocraId, vigenteDesde: { lte: fecha } },
      orderBy: { vigenteDesde: 'desc' },
    });
    return tarifa ? Number(tarifa.importeHora) : null;
  }

  private async montoNovedadVigente(tipoNovedadId: number, anio: number, mes: number) {
    const fecha = new Date(anio, mes - 1, 1);
    const monto = await this.prisma.montoNovedadPlus.findFirst({
      where: { tipoNovedadId, vigenteDesde: { lte: fecha } },
      orderBy: { vigenteDesde: 'desc' },
    });
    return monto ? Number(monto.montoPorDia) : null;
  }

  private async bonoVigente(categoriaUocraId: number, anio: number, mes: number) {
    const fecha = new Date(anio, mes - 1, 1);
    return this.prisma.bonoNoRemunerativo.findFirst({
      where: { categoriaUocraId, vigenteDesde: { lte: fecha } },
      orderBy: { vigenteDesde: 'desc' },
    });
  }

  private async rangoKmVigente(kmTotal: number, anio: number, mes: number) {
    const fecha = new Date(anio, mes - 1, 1);
    const ultimo = await this.prisma.rangoKmPorTantos.findFirst({
      where: { vigenteDesde: { lte: fecha } },
      orderBy: { vigenteDesde: 'desc' },
    });
    if (!ultimo) return null;
    const rangos = await this.prisma.rangoKmPorTantos.findMany({ where: { vigenteDesde: ultimo.vigenteDesde } });
    return (
      rangos.find((r) => kmTotal >= Number(r.kmDesde) && (r.kmHasta == null || kmTotal <= Number(r.kmHasta))) ?? null
    );
  }

  /** Días de una novedad (por nombre de tipo) que caen dentro del período, recortando a sus bordes. */
  private async diasDeNovedad(cuil: string, nombreTipo: string, desde: Date, hasta: Date) {
    const novedades = await this.prisma.novedad.findMany({
      where: {
        operarioCuil: cuil,
        tipoNovedad: { nombre: nombreTipo },
        fechaInicio: { lte: hasta },
        OR: [{ fechaFin: null }, { fechaFin: { gte: desde } }],
      },
    });
    let dias = 0;
    for (const n of novedades) {
      const fin = n.fechaFin ?? n.fechaInicio;
      const inicioClamp = n.fechaInicio > desde ? n.fechaInicio : desde;
      const finClamp = fin < hasta ? fin : hasta;
      const diff = Math.floor((finClamp.getTime() - inicioClamp.getTime()) / 86_400_000) + 1;
      if (diff > 0) dias += diff;
    }
    return dias;
  }

  private async novedadesEnPeriodo(cuil: string, nombreTipo: string, desde: Date, hasta: Date) {
    return this.prisma.novedad.findFirst({
      where: {
        operarioCuil: cuil,
        tipoNovedad: { nombre: nombreTipo },
        fechaInicio: { lte: hasta },
        OR: [{ fechaFin: null }, { fechaFin: { gte: desde } }],
      },
    });
  }

  async calcularQuincena(anio: number, mes: number, quincena: number) {
    const { desde, hasta } = this.rangoQuincena(anio, mes, quincena);

    const perfiles = await this.prisma.perfilLiquidacion.findMany({
      where: { regimen: { not: 'administrativo' } },
      include: {
        empleado: { select: { apellido_nombre: true, legajo: true, cargo: true, provincia: true } },
        categoria: { select: { id: true, nombre: true } },
      },
      orderBy: { cuil: 'asc' },
    });

    const tiposConPlus = await this.prisma.tipoNovedad.findMany({ where: { generaPlus: true, activo: true } });

    const montosMensualizados = await this.prisma.montoMensualizado.findMany({ where: { anio, mes, quincena } });
    const montoMensualPorCuil = new Map(montosMensualizados.map((m) => [m.cuil, Number(m.monto)]));

    const kmsPorTantos = await this.prisma.kmPorTantos.findMany({ where: { anio, mes, quincena } });
    const kmPorCuil = new Map(kmsPorTantos.map((k) => [k.cuil, Number(k.kmTotal)]));

    const resultado = [];

    for (const perfil of perfiles) {
      const tarifaHora = perfil.categoriaUocraId
        ? await this.tarifaVigente(perfil.categoriaUocraId, anio, mes)
        : null;

      let horasTotal = 0;
      let horasCct = 0;
      let horasExtra = 0;
      let basico = 0;
      let montoExtra = 0;
      let datoFaltante: string | null = null;

      if (perfil.regimen === 'jornalizado') {
        const agg = await this.prisma.registroHoras.aggregate({
          where: { operarioCuil: perfil.cuil, estado: 'aprobado', fecha: { gte: desde, lte: hasta } },
          _sum: { horas: true },
        });
        horasTotal = Number(agg._sum.horas ?? 0);
        horasCct = Math.min(horasTotal, 88);
        horasExtra = Math.max(horasTotal - 88, 0);
        if (tarifaHora != null) {
          basico = tarifaHora * horasCct;
          montoExtra = horasExtra * tarifaHora * 1.5;
        } else {
          datoFaltante = 'Sin categoría UOCRA / tarifa asignada';
        }
      } else if (perfil.regimen === 'fijo') {
        horasTotal = 88;
        horasCct = 88;
        if (tarifaHora != null) {
          basico = tarifaHora * 88;
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
        } else if (tarifaHora == null) {
          datoFaltante = 'Sin categoría UOCRA / tarifa asignada (necesaria para convertir km a horas)';
        } else {
          const rango = await this.rangoKmVigente(kmTotal, anio, mes);
          const montoKm = rango ? kmTotal * Number(rango.precioPorKm) : 0;
          horasTotal = tarifaHora > 0 ? montoKm / tarifaHora : 0;
          horasCct = Math.min(horasTotal, 88);
          horasExtra = Math.max(horasTotal - 88, 0);
          basico = tarifaHora * horasCct;
          montoExtra = horasExtra * tarifaHora * 1.5;
        }
      }

      // Presentismo: 20% del básico, salvo Ausencia desaprobada o Suspensión en el período.
      const ausenciaDesaprobada = await this.prisma.novedad.findFirst({
        where: {
          operarioCuil: perfil.cuil,
          estadoHys: 'desaprobada',
          tipoNovedad: { nombre: 'Ausencia' },
          fechaInicio: { lte: hasta },
          OR: [{ fechaFin: null }, { fechaFin: { gte: desde } }],
        },
      });
      const suspension = await this.novedadesEnPeriodo(perfil.cuil, 'Suspensión', desde, hasta);
      const tienePresentismo = !ausenciaDesaprobada && !suspension;
      const presentismo = tienePresentismo ? basico * 0.2 : 0;

      // Plus de novedades (Guardia Pasiva, Viáticos, etc.)
      const plus: { tipoNovedadId: number; nombre: string; dias: number; monto: number }[] = [];
      for (const tipo of tiposConPlus) {
        const dias = await this.diasDeNovedad(perfil.cuil, tipo.nombre, desde, hasta);
        if (dias > 0) {
          const montoPorDia = await this.montoNovedadVigente(tipo.id, anio, mes);
          plus.push({ tipoNovedadId: tipo.id, nombre: tipo.nombre, dias, monto: montoPorDia ? dias * montoPorDia : 0 });
        }
      }
      const totalPlus = plus.reduce((s, p) => s + p.monto, 0);

      // Bono no remunerativo (por categoría, opcional)
      let noRemunerativo = 0;
      if (perfil.categoriaUocraId) {
        const bono = await this.bonoVigente(perfil.categoriaUocraId, anio, mes);
        if (bono) {
          noRemunerativo = bono.tipo === 'monto_fijo' ? Number(bono.valor) : (tarifaHora ?? 0) * (Number(bono.valor) / 100);
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
        precioBruto: tarifaHora,
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
