import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalculoService } from './calculo.service';
import { rangoQuincena } from '../common/quincena';
import { zonaDeProvincia } from '../common/zona';

type FilaCalculo = Awaited<ReturnType<CalculoService['calcularQuincena']>>[number];
type Alertas = Awaited<ReturnType<CalculoService['getAlertasQuincena']>>;

/**
 * ADR-021: cierre de liquidación = snapshot puro y versionado de una
 * quincena. `crearCierre` congela en una transacción el resultado de
 * `CalculoService.calcularQuincena` (una fila por perfil, con
 * `datoFaltante`/zona derivados como en el panel en vivo), las alertas del
 * período (como salvedades de cabecera) y los días trabajados del rango.
 * Nunca bloquea nada: "vigente" es MAX(version) por período, derivado en
 * las queries de lectura (Task 5/6), no acá.
 *
 * Decisión de transacción: el `create` anidado de Prisma (detalle +
 * diasTrabajados en un solo `create`) ya es atómico por sí solo, pero se
 * envuelve igual en `$transaction(..., { timeout, maxWait })` — mismo
 * patrón que el resto del módulo (ver liquidacion.service.ts) — para
 * quedar consistente si más adelante se agrega otra escritura (p.ej.
 * auditoría) dentro del mismo cierre.
 */
@Injectable()
export class CierresService {
  constructor(
    private prisma: PrismaService,
    private calculo: CalculoService,
  ) {}

  private pluralizar(cantidad: number, singular: string, plural: string): string {
    return `${cantidad} ${cantidad === 1 ? singular : plural}`;
  }

  /** Salvedades de cabecera (JSON de strings): solo las categorías con count > 0. */
  private armarSalvedades(filas: FilaCalculo[], alertas: Alertas): string[] {
    const salvedades: string[] = [];

    if (alertas.sinPerfil.length > 0) {
      salvedades.push(
        this.pluralizar(
          alertas.sinPerfil.length,
          'empleado con horas sin perfil de liquidación',
          'empleados con horas sin perfil de liquidación',
        ),
      );
    }
    if (alertas.perfilIncompleto.length > 0) {
      salvedades.push(
        this.pluralizar(
          alertas.perfilIncompleto.length,
          'perfil de liquidación incompleto',
          'perfiles de liquidación incompletos',
        ),
      );
    }
    const jornalizadosConPendientes = alertas.sinHorasAprobadas.filter((a) => a.motivo === 'pendientes').length;
    if (jornalizadosConPendientes > 0) {
      salvedades.push(
        this.pluralizar(
          jornalizadosConPendientes,
          'jornalizado sin horas aprobadas (con pendientes)',
          'jornalizados sin horas aprobadas (con pendientes)',
        ),
      );
    }
    const conDatoFaltante = filas.filter((f) => f.datoFaltante != null).length;
    if (conDatoFaltante > 0) {
      salvedades.push(this.pluralizar(conDatoFaltante, 'fila con datos faltantes', 'filas con datos faltantes'));
    }
    const sinZona = filas.filter((f) => zonaDeProvincia(f.provincia) == null).length;
    if (sinZona > 0) {
      salvedades.push(this.pluralizar(sinZona, 'empleado sin zona', 'empleados sin zona'));
    }
    return salvedades;
  }

  /** Partición de fila.plus (novedades con plus) por nombre: "guardia" → montoGuardias, el resto → montoProductividad. Montos ausentes cuentan como 0. */
  private partirPlus(plus: { nombre: string; monto?: number | null }[]): {
    guardias: number;
    productividad: number;
  } {
    let guardias = 0;
    let productividad = 0;
    for (const p of plus) {
      const monto = p.monto ?? 0;
      if (p.nombre.toLowerCase().includes('guardia')) guardias += monto;
      else productividad += monto;
    }
    return { guardias, productividad };
  }

  /** Mapeo del detalle congelado (spec §2.2) a partir de una fila viva del cálculo. */
  private aFilaCongelada(fila: FilaCalculo, localidadPorCuil: Map<string, string | null>, kmPorCuil: Map<string, number>) {
    const zona = zonaDeProvincia(fila.provincia);
    const { guardias, productividad } = this.partirPlus(fila.plus);
    const esPorTantos = fila.regimen === 'por_tantos';

    let salvedad = fila.datoFaltante;
    if (zona == null) {
      salvedad = salvedad ? `${salvedad} · sin zona` : 'Sin zona (provincia no mapeada)';
    }

    return {
      cuil: fila.cuil,
      apellidoNombre: fila.apellidoNombre,
      legajo: fila.legajo,
      provincia: fila.provincia,
      localidad: localidadPorCuil.get(fila.cuil) ?? null,
      zona,
      regimen: fila.regimen,
      categoria: fila.categoria,
      modalidadPago: fila.modalidadPago,
      tienePresentismo: fila.tienePresentismo,
      // Mensualizado: el "precio bruto" congelado es el sueldo quincenal
      // (= totalBruto, básico = monto × 1) — como en el Excel real. El resto
      // de regímenes congela la tarifa hora.
      precioBruto: fila.regimen === 'mensualizado' ? fila.totalBruto : fila.precioBruto,
      horasTotal: fila.horasTotal,
      horasCct: fila.horasCct,
      horasExtra: fila.horasExtra,
      totalBruto: fila.totalBruto,
      montoHorasExtra: fila.montoHorasExtra,
      montoPresentismo: fila.montoPresentismo,
      noRemunerativo: fila.noRemunerativo,
      montoGuardias: guardias,
      montoProductividad: productividad,
      plusIndividual: fila.plusIndividual ?? 0,
      kmTotal: esPorTantos ? kmPorCuil.get(fila.cuil) ?? null : null,
      montoKmBruto: esPorTantos ? fila.montoKmBruto : null,
      montoA: esPorTantos ? fila.totalBruto + fila.montoPresentismo + fila.noRemunerativo : null,
      montoB: esPorTantos ? fila.montoHorasExtra : null,
      novedadesTexto: fila.novedadesTexto,
      salvedad,
      total: fila.total,
    };
  }

  async crearCierre(anio: number, mes: number, quincena: number, nota: string | undefined, usuarioCuil: string) {
    const { _max } = await this.prisma.cierreLiquidacion.aggregate({
      where: { anio, mes, quincena },
      _max: { version: true },
    });
    const version = (_max.version ?? 0) + 1;
    if (version > 1 && !nota?.trim()) {
      throw new BadRequestException('Un recierre necesita una nota que explique el motivo.');
    }

    const [filas, alertas] = await Promise.all([
      this.calculo.calcularQuincena(anio, mes, quincena),
      this.calculo.getAlertasQuincena(anio, mes, quincena),
    ]);

    const { desde, hasta } = rangoQuincena(anio, mes, quincena);
    // Un día cuenta si el empleado tiene ≥1 registro NO desaprobado esa
    // fecha (spec §2.3). Incluye a empleados sin perfil: no generan fila de
    // detalle, pero sus días sí quedan congelados.
    const [dias, kmsPorTantos] = await Promise.all([
      this.prisma.registroHoras.groupBy({
        by: ['operarioCuil', 'fecha'],
        where: { fecha: { gte: desde, lte: hasta }, estado: { not: 'desaprobado' } },
      }),
      this.prisma.kmPorTantos.findMany({ where: { anio, mes, quincena } }),
    ]);
    const kmPorCuil = new Map(kmsPorTantos.map((k) => [k.cuil, Number(k.kmTotal)]));

    // Localidad (se congela junto a provincia, spec §2.2) para todo cuil que
    // vaya a aparecer en detalle o en días trabajados.
    const cuils = [...new Set([...filas.map((f) => f.cuil), ...dias.map((d) => d.operarioCuil)])];
    const empleados = cuils.length
      ? await this.prisma.snuempleados.findMany({
          where: { cuil: { in: cuils } },
          select: { cuil: true, localidad: true, apellido_nombre: true, legajo: true },
        })
      : [];
    const empleadoPorCuil = new Map(empleados.map((e) => [e.cuil, e]));
    const localidadPorCuil = new Map(empleados.map((e) => [e.cuil, e.localidad]));
    const filaPorCuil = new Map(filas.map((f) => [f.cuil, f]));

    const salvedades = this.armarSalvedades(filas, alertas);

    return this.prisma.$transaction(
      (tx) =>
        tx.cierreLiquidacion.create({
          data: {
            anio,
            mes,
            quincena,
            version,
            cerradoPorCuil: usuarioCuil,
            nota: nota?.trim() || null,
            salvedades: salvedades.length ? JSON.stringify(salvedades) : null,
            detalle: { create: filas.map((f) => this.aFilaCongelada(f, localidadPorCuil, kmPorCuil)) },
            diasTrabajados: {
              create: dias.map((d) => {
                const fila = filaPorCuil.get(d.operarioCuil);
                const empleado = empleadoPorCuil.get(d.operarioCuil);
                return {
                  cuil: d.operarioCuil,
                  apellidoNombre: fila?.apellidoNombre ?? empleado?.apellido_nombre ?? d.operarioCuil,
                  legajo: fila?.legajo ?? empleado?.legajo ?? null,
                  fecha: d.fecha,
                };
              }),
            },
          },
        }),
      { timeout: 30000, maxWait: 10000 },
    );
  }
}
