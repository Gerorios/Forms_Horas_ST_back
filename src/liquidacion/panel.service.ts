import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalculoService } from './calculo.service';
import { rangoQuincena } from '../common/quincena';

export interface QuincenaResumen {
  anio: number;
  mes: number;
  quincena: 1 | 2;
  estado: 'con_pendientes' | 'con_alertas' | 'lista';
  pendientes: number;
  alertas: number;
}

const REGIMENES_CON_CATEGORIA = new Set(['jornalizado', 'fijo', 'por_tantos']);

/**
 * Panel del Liquidador: lista de quincenas con estado derivado (sin marca
 * manual de "liquidada") y detalle por quincena con drill-down por
 * empleado — ver docs/superpowers/plans/2026-08-04-panel-liquidacion.md.
 */
@Injectable()
export class PanelService {
  constructor(
    private prisma: PrismaService,
    private calculo: CalculoService,
  ) {}

  private num(n: number): string {
    return n.toFixed(2);
  }

  private fmtFecha(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private enumerarPeriodos(desde: Date, hasta: Date): { anio: number; mes: number; quincena: 1 | 2 }[] {
    const periodos: { anio: number; mes: number; quincena: 1 | 2 }[] = [];
    let anio = desde.getFullYear();
    let mes = desde.getMonth() + 1;
    let quincena: 1 | 2 = desde.getDate() <= 15 ? 1 : 2;
    const anioFin = hasta.getFullYear();
    const mesFin = hasta.getMonth() + 1;
    const quincenaFin: 1 | 2 = hasta.getDate() <= 15 ? 1 : 2;

    while (
      anio < anioFin ||
      (anio === anioFin && mes < mesFin) ||
      (anio === anioFin && mes === mesFin && quincena <= quincenaFin)
    ) {
      periodos.push({ anio, mes, quincena });
      if (quincena === 1) {
        quincena = 2;
      } else {
        quincena = 1;
        mes += 1;
        if (mes > 12) {
          mes = 1;
          anio += 1;
        }
      }
    }
    return periodos;
  }

  /**
   * Lista desde la quincena del primer RegistroHoras hasta la actual, desc,
   * máx 24. `alertas` de quincenas históricas usa solo sinPerfil (barato,
   * por rango) + perfilIncompleto (global, no depende del período) — el
   * `datoFaltante` granular del cálculo completo solo se evalúa en el
   * detalle de la quincena consultada (correr calcularQuincena acá sería
   * caro para hasta 24 quincenas). Perf: todo el span se trae en una sola
   * query y se bucketiza por quincena en memoria (evita hasta 48 queries
   * secuenciales).
   */
  async getQuincenas(hoy: Date = new Date()): Promise<QuincenaResumen[]> {
    const primero = await this.prisma.registroHoras.aggregate({ _min: { fecha: true } });
    const fechaInicio: Date | null = primero._min.fecha;
    if (!fechaInicio) return [];

    const periodos = this.enumerarPeriodos(fechaInicio, hoy).slice(-24).reverse();

    const perfiles = await this.prisma.perfilLiquidacion.findMany({
      where: { regimen: { not: 'administrativo' } },
      select: { cuil: true, regimen: true, categoriaUocraId: true, modalidadPago: true },
    });
    const cuilsConPerfil = new Set(perfiles.map((p) => p.cuil));
    const perfilesIncompletos = perfiles.filter(
      (p) => (REGIMENES_CON_CATEGORIA.has(p.regimen) && !p.categoriaUocraId) || !p.modalidadPago,
    ).length;

    // Todo el span (hasta 24 quincenas) en una sola query, bucketizado en
    // memoria por quincena — evita hasta 48 queries secuenciales (perf).
    const ultimo = periodos[0];
    const primeroDelSpan = periodos[periodos.length - 1];
    const spanDesde = rangoQuincena(primeroDelSpan.anio, primeroDelSpan.mes, primeroDelSpan.quincena).desde;
    const spanHasta = rangoQuincena(ultimo.anio, ultimo.mes, ultimo.quincena).hasta;

    const registros = await this.prisma.registroHoras.findMany({
      where: { fecha: { gte: spanDesde, lte: spanHasta } },
      select: { fecha: true, estado: true, operarioCuil: true },
    });

    const claveDe = (anio: number, mes: number, quincena: 1 | 2) => `${anio}-${mes}-${quincena}`;
    const claveDeFecha = (fecha: Date): string => {
      const anio = fecha.getFullYear();
      const mes = fecha.getMonth() + 1;
      const quincena: 1 | 2 = fecha.getDate() <= 15 ? 1 : 2;
      return claveDe(anio, mes, quincena);
    };

    const pendientesPorPeriodo = new Map<string, number>();
    const cuilsPorPeriodo = new Map<string, Set<string>>();
    for (const r of registros) {
      const clave = claveDeFecha(r.fecha);
      if (r.estado === 'pendiente') {
        pendientesPorPeriodo.set(clave, (pendientesPorPeriodo.get(clave) ?? 0) + 1);
      }
      if (!cuilsPorPeriodo.has(clave)) cuilsPorPeriodo.set(clave, new Set());
      cuilsPorPeriodo.get(clave)!.add(r.operarioCuil);
    }

    const resultado: QuincenaResumen[] = [];
    for (const periodo of periodos) {
      const clave = claveDe(periodo.anio, periodo.mes, periodo.quincena);
      const pendientes = pendientesPorPeriodo.get(clave) ?? 0;
      const cuilsConHoras = cuilsPorPeriodo.get(clave) ?? new Set<string>();
      // Quincenas sin ningún registro cargado no se listan (decisión 2026-08-04).
      if (pendientes === 0 && cuilsConHoras.size === 0) continue;
      const sinPerfil = [...cuilsConHoras].filter((c) => !cuilsConPerfil.has(c)).length;
      const alertas = sinPerfil + perfilesIncompletos;

      const estado: QuincenaResumen['estado'] =
        pendientes > 0 ? 'con_pendientes' : alertas > 0 ? 'con_alertas' : 'lista';

      resultado.push({ anio: periodo.anio, mes: periodo.mes, quincena: periodo.quincena, estado, pendientes, alertas });
    }
    return resultado;
  }

  /** Nombre para mostrar de un usuario (snuempleados si tiene, sino nombreFueraNomina — ver ADR-008). */
  private nombreUsuario(
    u: { cuil: string; nombreFueraNomina: string | null },
    nombrePorCuil: Map<string, string>,
  ): string {
    return nombrePorCuil.get(u.cuil) ?? u.nombreFueraNomina ?? '';
  }

  async getDetalleQuincena(anio: number, mes: number, quincena: number) {
    const { desde, hasta } = rangoQuincena(anio, mes, quincena);

    const calculo = await this.calculo.calcularQuincena(anio, mes, quincena);
    const cuils = calculo.map((r) => r.cuil);

    // Pendientes por cuil (chip "N sin aprobar")
    const pendientesAgg = await this.prisma.registroHoras.groupBy({
      by: ['operarioCuil'],
      where: { estado: 'pendiente', operarioCuil: { in: cuils }, fecha: { gte: desde, lte: hasta } },
      _count: { _all: true },
    });
    const pendientesPorCuil = new Map(pendientesAgg.map((p) => [p.operarioCuil, p._count._all]));

    // Registros no desaprobados del rango: sirven tanto para detectar
    // duplicado cruzado (mismo cuil+fecha en >1 loteId — regla de Control
    // general) como para armar los días del expand (subset 'aprobado').
    const registrosRango = await this.prisma.registroHoras.findMany({
      where: { operarioCuil: { in: cuils }, fecha: { gte: desde, lte: hasta }, estado: { not: 'desaprobado' } },
      include: {
        contrato: { select: { codigo: true } },
        tareas: { include: { tarea: { select: { nombre: true } } } },
        cargadoPor: { select: { cuil: true, email: true, nombreFueraNomina: true } },
      },
      orderBy: { fecha: 'asc' },
    });

    const lotesPorClave = new Map<string, Set<string>>();
    for (const r of registrosRango) {
      const k = `${r.operarioCuil}|${r.fecha.toISOString()}`;
      if (!lotesPorClave.has(k)) lotesPorClave.set(k, new Set());
      lotesPorClave.get(k)!.add(r.loteId);
    }
    const cuilesConDuplicado = new Set<string>();
    for (const [k, lotes] of lotesPorClave) {
      if (lotes.size > 1) cuilesConDuplicado.add(k.split('|')[0]);
    }

    const cargadores = [...new Set(registrosRango.map((r) => r.cargadoPorCuil))];
    const empleadosCargadores =
      cargadores.length > 0
        ? await this.prisma.snuempleados.findMany({
            where: { cuil: { in: cargadores } },
            select: { cuil: true, apellido_nombre: true },
          })
        : [];
    const nombrePorCuilCargador = new Map(empleadosCargadores.map((e) => [e.cuil, e.apellido_nombre]));

    const diasPorCuil = new Map<string, unknown[]>();
    for (const r of registrosRango) {
      if (r.estado !== 'aprobado') continue;
      const fila = calculo.find((c) => c.cuil === r.operarioCuil);
      const importeEstimado = fila?.precioBruto != null ? this.num(Number(r.horas) * fila.precioBruto) : null;
      const item = {
        fecha: this.fmtFecha(r.fecha),
        contratoCodigo: r.contrato.codigo,
        tareas: r.tareas.map((t: { tarea: { nombre: string } }) => t.tarea.nombre),
        horas: this.num(Number(r.horas)),
        cargadoPor: this.nombreUsuario(r.cargadoPor, nombrePorCuilCargador),
        importeEstimado,
      };
      if (!diasPorCuil.has(r.operarioCuil)) diasPorCuil.set(r.operarioCuil, []);
      diasPorCuil.get(r.operarioCuil)!.push(item);
    }

    // Novedades del período con su efecto sobre la liquidación.
    const novedades = await this.prisma.novedad.findMany({
      where: {
        operarioCuil: { in: cuils },
        fechaInicio: { lte: hasta },
        // Novedad sin fechaFin = de un solo dia (decision 2026-08-05): solapa la
        // quincena solo si su unico dia (fechaInicio) cae dentro del rango.
        OR: [{ fechaFin: { gte: desde } }, { fechaFin: null, fechaInicio: { gte: desde } }],
      },
      include: { tipoNovedad: true },
    });
    const novedadesPorCuil = new Map<string, unknown[]>();
    for (const n of novedades) {
      const fila = calculo.find((c) => c.cuil === n.operarioCuil);
      let efecto: string;
      if (n.tipoNovedad.nombre === 'Ausencia' && n.estadoHys === 'desaprobada') {
        efecto = 'pierde presentismo';
      } else if (n.tipoNovedad.nombre === 'Suspensión') {
        efecto = 'pierde presentismo (suspensión)';
      } else if (n.tipoNovedad.generaPlus) {
        // El plus se paga POR CARGA de novedad, en la quincena donde INICIA
        // (decisión 2026-08-05). `fila.plus` trae cantidad de cargas y total
        // del tipo; esta novedad puntual paga el monto unitario si inicia en
        // el rango, y si solo solapa (inició en otra quincena) es informativa.
        const plusEntry = fila?.plus.find((p) => p.tipoNovedadId === n.tipoNovedadId);
        const iniciaEnRango = n.fechaInicio >= desde && n.fechaInicio <= hasta;
        if (plusEntry && plusEntry.dias > 0 && iniciaEnRango) {
          const montoPorNovedad = plusEntry.monto / plusEntry.dias;
          efecto = `plus $${this.num(montoPorNovedad)} (por novedad)`;
        } else if (!iniciaEnRango) {
          efecto = 'informativa (se paga en la quincena donde inicia)';
        } else {
          efecto = 'informativa';
        }
      } else {
        efecto = 'informativa';
      }
      const item = {
        tipo: n.tipoNovedad.nombre,
        desde: this.fmtFecha(n.fechaInicio),
        hasta: this.fmtFecha(n.fechaFin ?? n.fechaInicio),
        efecto,
      };
      if (!novedadesPorCuil.has(n.operarioCuil)) novedadesPorCuil.set(n.operarioCuil, []);
      novedadesPorCuil.get(n.operarioCuil)!.push(item);
    }

    const filas = calculo.map((r) => ({
      cuil: r.cuil,
      nombre: r.apellidoNombre,
      regimen: r.regimen,
      categoria: r.categoria,
      // Fix centinela: mensualizado no expone horasTotal/horasCct=1 acá — el
      // endpoint viejo /quincena/calculo sigue devolviendo el centinela tal
      // cual (no se toca su contrato), la traducción a null es solo acá.
      horasTotal: r.regimen === 'mensualizado' ? null : this.num(r.horasTotal),
      horasCct: r.regimen === 'mensualizado' ? null : this.num(r.horasCct),
      basico: this.num(r.totalBruto),
      montoExtra: this.num(r.montoHorasExtra),
      presentismo: this.num(r.montoPresentismo),
      totalPlus: this.num(r.plus.reduce((s, p) => s + p.monto, 0)),
      noRemunerativo: this.num(r.noRemunerativo),
      total: this.num(r.total),
      modalidadPago: r.modalidadPago,
      etiquetaNovedades: r.novedadesTexto,
      datoFaltante: r.datoFaltante,
      pendientesAprobacion: pendientesPorCuil.get(r.cuil) ?? 0,
      duplicadoCruzado: cuilesConDuplicado.has(r.cuil),
      dias: diasPorCuil.get(r.cuil) ?? [],
      novedades: novedadesPorCuil.get(r.cuil) ?? [],
    }));

    // Filas grises: empleados con horas aprobadas en el rango pero sin
    // PerfilLiquidacion (los perfiles incompletos se muestran en `filas`,
    // con su chip vía datoFaltante).
    const todosLosPerfiles = await this.prisma.perfilLiquidacion.findMany({ select: { cuil: true } });
    const cuilsConPerfil = new Set(todosLosPerfiles.map((p) => p.cuil));

    const horasAprobadasAgg = await this.prisma.registroHoras.groupBy({
      by: ['operarioCuil'],
      where: { estado: 'aprobado', fecha: { gte: desde, lte: hasta } },
      _sum: { horas: true },
    });
    const sinPerfilAgg = horasAprobadasAgg.filter((h) => !cuilsConPerfil.has(h.operarioCuil));

    let sinPerfil: Array<{ cuil: string; nombre: string; horasAprobadas: string; motivo: 'sin_perfil' }> = [];
    if (sinPerfilAgg.length > 0) {
      const empleadosSinPerfil = await this.prisma.snuempleados.findMany({
        where: { cuil: { in: sinPerfilAgg.map((h) => h.operarioCuil) } },
        select: { cuil: true, apellido_nombre: true },
      });
      const nombrePorCuil = new Map(empleadosSinPerfil.map((e) => [e.cuil, e.apellido_nombre]));
      sinPerfil = sinPerfilAgg.map((h) => ({
        cuil: h.operarioCuil,
        nombre: nombrePorCuil.get(h.operarioCuil) ?? h.operarioCuil,
        horasAprobadas: this.num(Number(h._sum.horas ?? 0)),
        motivo: 'sin_perfil' as const,
      }));
    }

    return { filas, sinPerfil };
  }
}
