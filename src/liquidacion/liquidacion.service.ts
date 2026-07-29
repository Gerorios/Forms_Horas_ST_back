import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCategoriaUocraDto,
  UpdateCategoriaUocraDto,
  UpsertPerfilLiquidacionDto,
  CargarRondaTarifasDto,
  CargarMontosMensualizadosDto,
  CargarKmPorTantosDto,
} from './dto/liquidacion.dto';

type Periodo = { anio: number; mes: number };

@Injectable()
export class LiquidacionService {
  constructor(private prisma: PrismaService) {}

  // ---- Categorías UOCRA ----
  getCategorias() {
    return this.prisma.categoriaUocra.findMany({ orderBy: { nombre: 'asc' } });
  }

  createCategoria(dto: CreateCategoriaUocraDto) {
    return this.prisma.categoriaUocra.create({ data: dto });
  }

  updateCategoria(id: number, dto: UpdateCategoriaUocraDto) {
    return this.prisma.categoriaUocra.update({ where: { id }, data: dto });
  }

  toggleCategoria(id: number, activo: boolean) {
    return this.prisma.categoriaUocra.update({ where: { id }, data: { activo } });
  }

  // ---- Ronda mensual de tarifas (ver ADR-010 y ADR-011) ----

  private mesesFaltantes(ultimo: Periodo | null, objetivo: Periodo): Periodo[] {
    if (!ultimo) return [];
    const resultado: Periodo[] = [];
    let { anio, mes } = ultimo;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      anio += 1;
    }
    while (anio < objetivo.anio || (anio === objetivo.anio && mes < objetivo.mes)) {
      resultado.push({ anio, mes });
      mes += 1;
      if (mes > 12) {
        mes = 1;
        anio += 1;
      }
    }
    return resultado;
  }

  async getEstadoTarifas() {
    const ultimo = await this.prisma.rondaTarifas.findFirst({ orderBy: [{ anio: 'desc' }, { mes: 'desc' }] });

    const categoriasActivas = await this.prisma.categoriaUocra.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
    const tarifasUltimas = await this.prisma.tarifaCategoriaUocra.findMany({
      where: { categoriaUocraId: { in: categoriasActivas.map((c) => c.id) } },
      orderBy: { vigenteDesde: 'desc' },
    });
    const importePorCategoria = new Map<number, string>();
    for (const t of tarifasUltimas) {
      if (!importePorCategoria.has(t.categoriaUocraId)) {
        importePorCategoria.set(t.categoriaUocraId, t.importeHora.toString());
      }
    }

    const bonosUltimos = await this.prisma.bonoNoRemunerativo.findMany({
      where: { categoriaUocraId: { in: categoriasActivas.map((c) => c.id) } },
      orderBy: { vigenteDesde: 'desc' },
    });
    const bonoPorCategoria = new Map<number, { tipo: string; valor: string }>();
    for (const b of bonosUltimos) {
      if (!bonoPorCategoria.has(b.categoriaUocraId)) {
        bonoPorCategoria.set(b.categoriaUocraId, { tipo: b.tipo, valor: b.valor.toString() });
      }
    }

    const tiposConPlus = await this.prisma.tipoNovedad.findMany({
      where: { generaPlus: true, activo: true },
      orderBy: { nombre: 'asc' },
    });
    const montosUltimos = await this.prisma.montoNovedadPlus.findMany({
      where: { tipoNovedadId: { in: tiposConPlus.map((t) => t.id) } },
      orderBy: { vigenteDesde: 'desc' },
    });
    const montoPorTipo = new Map<number, string>();
    for (const m of montosUltimos) {
      if (!montoPorTipo.has(m.tipoNovedadId)) montoPorTipo.set(m.tipoNovedadId, m.montoPorDia.toString());
    }

    const ultimoRango = await this.prisma.rangoKmPorTantos.findFirst({ orderBy: { vigenteDesde: 'desc' } });
    const rangosActuales = ultimoRango
      ? await this.prisma.rangoKmPorTantos.findMany({
          where: { vigenteDesde: ultimoRango.vigenteDesde },
          orderBy: { kmDesde: 'asc' },
        })
      : [];

    return {
      ultimoPeriodo: ultimo ? { anio: ultimo.anio, mes: ultimo.mes } : null,
      categorias: categoriasActivas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        importeHoraActual: importePorCategoria.get(c.id) ?? null,
        bonoNoRemunerativoActual: bonoPorCategoria.get(c.id) ?? null,
      })),
      tiposNovedad: tiposConPlus.map((t) => ({
        id: t.id,
        nombre: t.nombre,
        montoPorDiaActual: montoPorTipo.get(t.id) ?? null,
      })),
      rangosKm: rangosActuales.map((r) => ({
        kmDesde: r.kmDesde.toString(),
        kmHasta: r.kmHasta?.toString() ?? null,
        precioPorKmActual: r.precioPorKm.toString(),
      })),
    };
  }

  async cargarRondaTarifas(dto: CargarRondaTarifasDto) {
    const objetivo: Periodo = { anio: dto.anio, mes: dto.mes };
    const ultimo = await this.prisma.rondaTarifas.findFirst({ orderBy: [{ anio: 'desc' }, { mes: 'desc' }] });

    if (ultimo && (objetivo.anio < ultimo.anio || (objetivo.anio === ultimo.anio && objetivo.mes <= ultimo.mes))) {
      throw new BadRequestException('Ese período ya fue cargado o es anterior al último cargado');
    }

    // Snapshot de antes de escribir nada: se usa para completar los meses
    // faltantes copiando el último valor conocido (ver ADR-010).
    const estado = await this.getEstadoTarifas();
    const faltantes = this.mesesFaltantes(ultimo ? { anio: ultimo.anio, mes: ultimo.mes } : null, objetivo);

    await this.prisma.$transaction(async (tx) => {
      for (const periodo of faltantes) {
        const fecha = new Date(periodo.anio, periodo.mes - 1, 1);
        for (const c of estado.categorias) {
          if (c.importeHoraActual != null) {
            await tx.tarifaCategoriaUocra.create({
              data: { categoriaUocraId: c.id, vigenteDesde: fecha, importeHora: c.importeHoraActual },
            });
          }
          if (c.bonoNoRemunerativoActual) {
            await tx.bonoNoRemunerativo.create({
              data: {
                categoriaUocraId: c.id,
                vigenteDesde: fecha,
                tipo: c.bonoNoRemunerativoActual.tipo as 'monto_fijo' | 'porcentaje',
                valor: c.bonoNoRemunerativoActual.valor,
              },
            });
          }
        }
        for (const t of estado.tiposNovedad) {
          if (t.montoPorDiaActual == null) continue;
          await tx.montoNovedadPlus.create({
            data: { tipoNovedadId: t.id, vigenteDesde: fecha, montoPorDia: t.montoPorDiaActual },
          });
        }
        for (const r of estado.rangosKm) {
          await tx.rangoKmPorTantos.create({
            data: {
              vigenteDesde: fecha,
              kmDesde: r.kmDesde,
              kmHasta: r.kmHasta ?? undefined,
              precioPorKm: r.precioPorKmActual,
            },
          });
        }
        await tx.rondaTarifas.create({ data: periodo });
      }

      const fechaObjetivo = new Date(objetivo.anio, objetivo.mes - 1, 1);
      for (const c of dto.categorias) {
        await tx.tarifaCategoriaUocra.create({
          data: { categoriaUocraId: c.categoriaUocraId, vigenteDesde: fechaObjetivo, importeHora: c.importeHora },
        });
      }
      for (const t of dto.tiposNovedad) {
        await tx.montoNovedadPlus.create({
          data: { tipoNovedadId: t.tipoNovedadId, vigenteDesde: fechaObjetivo, montoPorDia: t.montoPorDia },
        });
      }
      for (const r of dto.rangosKm) {
        await tx.rangoKmPorTantos.create({
          data: { vigenteDesde: fechaObjetivo, kmDesde: r.kmDesde, kmHasta: r.kmHasta, precioPorKm: r.precioPorKm },
        });
      }
      for (const b of dto.bonosNoRemunerativos ?? []) {
        await tx.bonoNoRemunerativo.create({
          data: { categoriaUocraId: b.categoriaUocraId, vigenteDesde: fechaObjetivo, tipo: b.tipo, valor: b.valor },
        });
      }
      await tx.rondaTarifas.create({ data: objetivo });
    }, { timeout: 30000, maxWait: 10000 });

    return { mesesCompletados: [...faltantes, objetivo] };
  }

  // ---- Perfiles de liquidación (régimen + categoría por empleado) ----
  getPerfiles() {
    return this.prisma.perfilLiquidacion.findMany({
      include: {
        empleado: { select: { apellido_nombre: true, legajo: true, cargo: true } },
        categoria: { select: { id: true, nombre: true } },
      },
      orderBy: { cuil: 'asc' },
    });
  }

  async upsertPerfil(cuil: string, dto: UpsertPerfilLiquidacionDto) {
    const empleado = await this.prisma.snuempleados.findUnique({ where: { cuil } });
    if (!empleado) throw new NotFoundException('No existe un empleado con ese CUIL');

    return this.prisma.perfilLiquidacion.upsert({
      where: { cuil },
      create: {
        cuil,
        regimen: dto.regimen,
        categoriaUocraId: dto.categoriaUocraId,
        modalidadPago: dto.modalidadPago,
      },
      update: {
        regimen: dto.regimen,
        categoriaUocraId: dto.categoriaUocraId,
        modalidadPago: dto.modalidadPago,
      },
    });
  }

  async deletePerfil(cuil: string) {
    await this.prisma.perfilLiquidacion.delete({ where: { cuil } });
    return { cuil };
  }

  async upsertPerfilesMasivo(cuils: string[], dto: UpsertPerfilLiquidacionDto) {
    const empleados = await this.prisma.snuempleados.findMany({
      where: { cuil: { in: cuils } },
      select: { cuil: true },
    });
    const existentesSet = new Set(empleados.map((e) => e.cuil));
    const validos = cuils.filter((c) => existentesSet.has(c));
    const omitidos = cuils.filter((c) => !existentesSet.has(c));

    await this.prisma.$transaction(
      validos.map((cuil) =>
        this.prisma.perfilLiquidacion.upsert({
          where: { cuil },
          create: {
            cuil,
            regimen: dto.regimen,
            categoriaUocraId: dto.categoriaUocraId,
            modalidadPago: dto.modalidadPago,
          },
          update: {
            regimen: dto.regimen,
            categoriaUocraId: dto.categoriaUocraId,
            modalidadPago: dto.modalidadPago,
          },
        }),
      ),
      { timeout: 30000, maxWait: 10000 },
    );

    return { asignados: validos.length, omitidos };
  }

  // ---- Datos variables por quincena: mensualizado y por tantos (ver ADR-011) ----

  async getMontosMensualizados(anio: number, mes: number, quincena: number) {
    const perfiles = await this.prisma.perfilLiquidacion.findMany({
      where: { regimen: 'mensualizado' },
      include: { empleado: { select: { apellido_nombre: true } } },
      orderBy: { cuil: 'asc' },
    });
    const montos = await this.prisma.montoMensualizado.findMany({ where: { anio, mes, quincena } });
    const montoPorCuil = new Map(montos.map((m) => [m.cuil, m.monto.toString()]));
    return perfiles.map((p) => ({
      cuil: p.cuil,
      apellidoNombre: p.empleado.apellido_nombre,
      monto: montoPorCuil.get(p.cuil) ?? null,
    }));
  }

  async cargarMontosMensualizados(dto: CargarMontosMensualizadosDto) {
    await this.prisma.$transaction(
      dto.montos.map((m) =>
        this.prisma.montoMensualizado.upsert({
          where: { cuil_anio_mes_quincena: { cuil: m.cuil, anio: dto.anio, mes: dto.mes, quincena: dto.quincena } },
          create: { cuil: m.cuil, anio: dto.anio, mes: dto.mes, quincena: dto.quincena, monto: m.monto },
          update: { monto: m.monto },
        }),
      ),
      { timeout: 30000, maxWait: 10000 },
    );
    return { actualizados: dto.montos.length };
  }

  async getKmPorTantos(anio: number, mes: number, quincena: number) {
    const perfiles = await this.prisma.perfilLiquidacion.findMany({
      where: { regimen: 'por_tantos' },
      include: { empleado: { select: { apellido_nombre: true } } },
      orderBy: { cuil: 'asc' },
    });
    const kms = await this.prisma.kmPorTantos.findMany({ where: { anio, mes, quincena } });
    const kmPorCuil = new Map(kms.map((k) => [k.cuil, k.kmTotal.toString()]));
    return perfiles.map((p) => ({
      cuil: p.cuil,
      apellidoNombre: p.empleado.apellido_nombre,
      kmTotal: kmPorCuil.get(p.cuil) ?? null,
    }));
  }

  async cargarKmPorTantos(dto: CargarKmPorTantosDto) {
    await this.prisma.$transaction(
      dto.kms.map((k) =>
        this.prisma.kmPorTantos.upsert({
          where: { cuil_anio_mes_quincena: { cuil: k.cuil, anio: dto.anio, mes: dto.mes, quincena: dto.quincena } },
          create: { cuil: k.cuil, anio: dto.anio, mes: dto.mes, quincena: dto.quincena, kmTotal: k.kmTotal },
          update: { kmTotal: k.kmTotal },
        }),
      ),
      { timeout: 30000, maxWait: 10000 },
    );
    return { actualizados: dto.kms.length };
  }
}
