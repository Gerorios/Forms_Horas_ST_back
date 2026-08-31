import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCategoriaUocraDto,
  UpdateCategoriaUocraDto,
  UpsertPerfilLiquidacionDto,
  CategoriasPeriodoDto,
  BonosPeriodoDto,
  NovedadesPlusPeriodoDto,
  RangosKmPeriodoDto,
  GuardarSueldosMensualizadosDto,
  CargarKmPorTantosDto,
  CargarPlusIndividualDto,
} from './dto/liquidacion.dto';

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

  // ---- Precios por período (ver ADR-018, amienda ADR-010) ----
  //
  // Cada sección (categorías, bonos, novedades con plus, rangos de km) se
  // lee y se guarda de forma INDEPENDIENTE, por período exacto (anio, mes).
  // No hay relleno automático de huecos ni bloqueo entre períodos: un mes
  // sin resolver no impide cargar ni liquidar otro. La "sugerencia" (último
  // valor conocido de un período ANTERIOR) se expone solo para prellenar el
  // formulario — nunca se aplica sola al cálculo de liquidación.

  // UTC, no hora local: `vigenteDesde` se guarda como medianoche UTC exacta
  // (columna @db.Date). Con `new Date(anio, mes-1, 1)` (hora local) el server
  // corriendo en America/Buenos_Aires (UTC-3) arma un instante 3h después de
  // esa medianoche — las queries de Prisma lo toleran (truncan a la fecha),
  // pero cualquier comparación en JS (`.getTime()`, `.getFullYear()`) contra
  // un valor leído de la base queda desfasada y rompe silenciosamente el
  // "resuelto" de ADR-018 (bug encontrado 2026-08-24, ver contexto).
  private fechaDePeriodo(anio: number, mes: number): Date {
    return new Date(Date.UTC(anio, mes - 1, 1));
  }

  /** La fila con vigenteDesde más reciente ESTRICTAMENTE ANTERIOR al período — para sugerir, nunca para calcular. */
  private ultimoAnterior<T extends { vigenteDesde: Date }>(rows: T[], fecha: Date): T | null {
    let best: T | null = null;
    for (const r of rows) {
      if (r.vigenteDesde.getTime() < fecha.getTime() && (!best || r.vigenteDesde > best.vigenteDesde)) best = r;
    }
    return best;
  }

  private periodoDeFecha(fecha: Date): { anio: number; mes: number } {
    return { anio: fecha.getUTCFullYear(), mes: fecha.getUTCMonth() + 1 };
  }

  private async auditarCambio(
    tx: any,
    tabla: string,
    registroId: number,
    usuarioCuil: string,
    campo: string,
    valorAnterior: string | null,
    valorNuevo: string | null,
  ) {
    if (valorAnterior === valorNuevo) return;
    await tx.auditoria.create({
      data: {
        tabla,
        registroId,
        usuarioCuil,
        accion: valorAnterior == null ? 'crear' : 'editar',
        campo,
        valorAnterior,
        valorNuevo,
      },
    });
  }

  // ---- Sección: tarifa por hora por categoría UOCRA (obligatorio) ----

  async getCategoriasPeriodo(anio: number, mes: number) {
    const fecha = this.fechaDePeriodo(anio, mes);
    const categoriasActivas = await this.prisma.categoriaUocra.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
    const todas = await this.prisma.tarifaCategoriaUocra.findMany({
      where: { categoriaUocraId: { in: categoriasActivas.map((c) => c.id) } },
    });
    return categoriasActivas.map((c) => {
      const propias = todas.filter((t) => t.categoriaUocraId === c.id);
      const resuelto = propias.find((t) => t.vigenteDesde.getTime() === fecha.getTime()) ?? null;
      const anterior = this.ultimoAnterior(propias, fecha);
      return {
        id: c.id,
        nombre: c.nombre,
        resuelto: resuelto != null,
        importeHora: resuelto ? resuelto.importeHora.toString() : null,
        sugerencia: !resuelto && anterior ? { valor: anterior.importeHora.toString(), periodo: this.periodoDeFecha(anterior.vigenteDesde) } : null,
      };
    });
  }

  async guardarCategoriasPeriodo(anio: number, mes: number, dto: CategoriasPeriodoDto, usuarioCuil: string) {
    const fecha = this.fechaDePeriodo(anio, mes);
    await this.prisma.$transaction(async (tx) => {
      for (const c of dto.categorias) {
        const existente = await tx.tarifaCategoriaUocra.findUnique({
          where: { categoriaUocraId_vigenteDesde: { categoriaUocraId: c.categoriaUocraId, vigenteDesde: fecha } },
        });
        if (existente) {
          if (Number(existente.importeHora) !== c.importeHora) {
            await tx.tarifaCategoriaUocra.update({ where: { id: existente.id }, data: { importeHora: c.importeHora } });
            await this.auditarCambio(tx, 'sth_tarifas_categoria_uocra', existente.id, usuarioCuil, 'importeHora', existente.importeHora.toString(), c.importeHora.toString());
          }
        } else {
          const creada = await tx.tarifaCategoriaUocra.create({
            data: { categoriaUocraId: c.categoriaUocraId, vigenteDesde: fecha, importeHora: c.importeHora },
          });
          await this.auditarCambio(tx, 'sth_tarifas_categoria_uocra', creada.id, usuarioCuil, 'importeHora', null, c.importeHora.toString());
        }
      }
    }, { timeout: 30000, maxWait: 10000 });
    return this.getCategoriasPeriodo(anio, mes);
  }

  // ---- Sección: bono no remunerativo por categoría (único campo OPCIONAL) ----
  //
  // "Sin bono este mes" es una decisión explícita: se graba una fila con
  // valor 0 (o el tipo/valor que sea), NUNCA se infiere de la ausencia de
  // fila. Una categoría ausente del período = todavía no revisada.

  async getBonosPeriodo(anio: number, mes: number) {
    const fecha = this.fechaDePeriodo(anio, mes);
    const categoriasActivas = await this.prisma.categoriaUocra.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
    const todas = await this.prisma.bonoNoRemunerativo.findMany({
      where: { categoriaUocraId: { in: categoriasActivas.map((c) => c.id) } },
    });
    return categoriasActivas.map((c) => {
      const propias = todas.filter((b) => b.categoriaUocraId === c.id);
      const resuelto = propias.find((b) => b.vigenteDesde.getTime() === fecha.getTime()) ?? null;
      const anterior = this.ultimoAnterior(propias, fecha);
      return {
        categoriaUocraId: c.id,
        nombre: c.nombre,
        resuelto: resuelto != null,
        bono: resuelto ? { tipo: resuelto.tipo, valor: resuelto.valor.toString() } : null,
        sugerencia: !resuelto && anterior ? { tipo: anterior.tipo, valor: anterior.valor.toString(), periodo: this.periodoDeFecha(anterior.vigenteDesde) } : null,
      };
    });
  }

  async guardarBonosPeriodo(anio: number, mes: number, dto: BonosPeriodoDto, usuarioCuil: string) {
    const fecha = this.fechaDePeriodo(anio, mes);
    await this.prisma.$transaction(async (tx) => {
      // ADR-021 §6: el bono es por quincena en la BD, pero esta pantalla (por
      // período mensual) todavía lo carga igual para ambas — 1Q y 2Q quedan
      // en sincronía hasta que una task posterior separe la UI por quincena.
      for (const b of dto.bonos) {
        for (const quincena of [1, 2]) {
          const existente = await tx.bonoNoRemunerativo.findUnique({
            where: { categoriaUocraId_vigenteDesde_quincena: { categoriaUocraId: b.categoriaUocraId, vigenteDesde: fecha, quincena } },
          });
          if (existente) {
            if (Number(existente.valor) !== b.valor || existente.tipo !== b.tipo) {
              await tx.bonoNoRemunerativo.update({ where: { id: existente.id }, data: { tipo: b.tipo, valor: b.valor } });
              await this.auditarCambio(tx, 'sth_bonos_no_remunerativos', existente.id, usuarioCuil, 'valor', existente.valor.toString(), b.valor.toString());
            }
          } else {
            const creado = await tx.bonoNoRemunerativo.create({
              data: { categoriaUocraId: b.categoriaUocraId, vigenteDesde: fecha, quincena, tipo: b.tipo, valor: b.valor },
            });
            await this.auditarCambio(tx, 'sth_bonos_no_remunerativos', creado.id, usuarioCuil, 'valor', null, b.valor.toString());
          }
        }
      }
    }, { timeout: 30000, maxWait: 10000 });
    return this.getBonosPeriodo(anio, mes);
  }

  // ---- Sección: monto por novedad con plus — Guardia Pasiva, Viáticos, etc. (obligatorio) ----

  async getNovedadesPlusPeriodo(anio: number, mes: number) {
    const fecha = this.fechaDePeriodo(anio, mes);
    const tiposConPlus = await this.prisma.tipoNovedad.findMany({
      where: { generaPlus: true, activo: true },
      orderBy: { nombre: 'asc' },
    });
    const todos = await this.prisma.montoNovedadPlus.findMany({
      where: { tipoNovedadId: { in: tiposConPlus.map((t) => t.id) } },
    });
    return tiposConPlus.map((t) => {
      const propios = todos.filter((m) => m.tipoNovedadId === t.id);
      const resuelto = propios.find((m) => m.vigenteDesde.getTime() === fecha.getTime()) ?? null;
      const anterior = this.ultimoAnterior(propios, fecha);
      return {
        tipoNovedadId: t.id,
        nombre: t.nombre,
        resuelto: resuelto != null,
        montoPorDia: resuelto ? resuelto.montoPorDia.toString() : null,
        sugerencia: !resuelto && anterior ? { valor: anterior.montoPorDia.toString(), periodo: this.periodoDeFecha(anterior.vigenteDesde) } : null,
      };
    });
  }

  async guardarNovedadesPlusPeriodo(anio: number, mes: number, dto: NovedadesPlusPeriodoDto, usuarioCuil: string) {
    const fecha = this.fechaDePeriodo(anio, mes);
    await this.prisma.$transaction(async (tx) => {
      for (const t of dto.tiposNovedad) {
        const existente = await tx.montoNovedadPlus.findUnique({
          where: { tipoNovedadId_vigenteDesde: { tipoNovedadId: t.tipoNovedadId, vigenteDesde: fecha } },
        });
        if (existente) {
          if (Number(existente.montoPorDia) !== t.montoPorDia) {
            await tx.montoNovedadPlus.update({ where: { id: existente.id }, data: { montoPorDia: t.montoPorDia } });
            await this.auditarCambio(tx, 'sth_montos_novedad_plus', existente.id, usuarioCuil, 'montoPorDia', existente.montoPorDia.toString(), t.montoPorDia.toString());
          }
        } else {
          const creado = await tx.montoNovedadPlus.create({
            data: { tipoNovedadId: t.tipoNovedadId, vigenteDesde: fecha, montoPorDia: t.montoPorDia },
          });
          await this.auditarCambio(tx, 'sth_montos_novedad_plus', creado.id, usuarioCuil, 'montoPorDia', null, t.montoPorDia.toString());
        }
      }
    }, { timeout: 30000, maxWait: 10000 });
    return this.getNovedadesPlusPeriodo(anio, mes);
  }

  // ---- Sección: rangos de km "por tantos" (obligatorio, reemplazo completo del período) ----

  async getRangosKmPeriodo(anio: number, mes: number) {
    const fecha = this.fechaDePeriodo(anio, mes);
    const propios = await this.prisma.rangoKmPorTantos.findMany({ where: { vigenteDesde: fecha }, orderBy: { kmDesde: 'asc' } });
    if (propios.length > 0) {
      return {
        resuelto: true,
        rangosKm: propios.map((r) => ({ kmDesde: r.kmDesde.toString(), kmHasta: r.kmHasta?.toString() ?? null, precioPorKm: r.precioPorKm.toString() })),
        sugerencia: null as { rangosKm: unknown[]; periodo: { anio: number; mes: number } } | null,
      };
    }
    const anterior = await this.prisma.rangoKmPorTantos.findFirst({ where: { vigenteDesde: { lt: fecha } }, orderBy: { vigenteDesde: 'desc' } });
    const rangosAnteriores = anterior
      ? await this.prisma.rangoKmPorTantos.findMany({ where: { vigenteDesde: anterior.vigenteDesde }, orderBy: { kmDesde: 'asc' } })
      : [];
    return {
      resuelto: false,
      rangosKm: [],
      sugerencia: anterior
        ? {
            rangosKm: rangosAnteriores.map((r) => ({ kmDesde: r.kmDesde.toString(), kmHasta: r.kmHasta?.toString() ?? null, precioPorKm: r.precioPorKm.toString() })),
            periodo: this.periodoDeFecha(anterior.vigenteDesde),
          }
        : null,
    };
  }

  async guardarRangosKmPeriodo(anio: number, mes: number, dto: RangosKmPeriodoDto, usuarioCuil: string) {
    const fecha = this.fechaDePeriodo(anio, mes);
    await this.prisma.$transaction(async (tx) => {
      const viejos = await tx.rangoKmPorTantos.findMany({ where: { vigenteDesde: fecha }, orderBy: { kmDesde: 'asc' } });
      const viejosSerializados = viejos.map((r) => ({ kmDesde: r.kmDesde.toString(), kmHasta: r.kmHasta?.toString() ?? null, precioPorKm: r.precioPorKm.toString() }));
      const comparable = (r: { kmDesde: unknown; kmHasta?: unknown; precioPorKm: unknown }) => ({
        kmDesde: Number(r.kmDesde).toFixed(2),
        kmHasta: r.kmHasta != null ? Number(r.kmHasta).toFixed(2) : null,
        precioPorKm: Number(r.precioPorKm).toFixed(2),
      });
      const cambiaron = JSON.stringify(viejosSerializados.map(comparable)) !== JSON.stringify(dto.rangosKm.map(comparable));
      if (cambiaron) {
        await tx.rangoKmPorTantos.deleteMany({ where: { vigenteDesde: fecha } });
        if (dto.rangosKm.length) {
          await tx.rangoKmPorTantos.createMany({
            data: dto.rangosKm.map((r) => ({ vigenteDesde: fecha, kmDesde: r.kmDesde, kmHasta: r.kmHasta ?? null, precioPorKm: r.precioPorKm })),
          });
        }
        await tx.auditoria.create({
          data: {
            tabla: 'sth_rangos_km_por_tantos',
            registroId: 0,
            usuarioCuil,
            accion: viejos.length ? 'editar' : 'crear',
            campo: 'rangosKm',
            valorAnterior: JSON.stringify(viejosSerializados),
            valorNuevo: JSON.stringify(dto.rangosKm),
          },
        });
      }
    }, { timeout: 30000, maxWait: 10000 });
    return this.getRangosKmPeriodo(anio, mes);
  }

  // ---- Perfiles de liquidación (régimen + categoría por empleado) ----
  async getPerfiles() {
    const perfiles = await this.prisma.perfilLiquidacion.findMany({
      include: {
        empleado: { select: { apellido_nombre: true, legajo: true, cargo: true } },
        categoria: { select: { id: true, nombre: true } },
        contratosImputacion: { select: { contratoId: true } },
      },
      orderBy: { cuil: 'asc' },
    });
    return perfiles.map(({ contratosImputacion, ...p }) => ({
      ...p,
      contratosImputacionIds: contratosImputacion.map((c) => c.contratoId),
    }));
  }

  // Listado de contratos activos para el selector de imputación en Perfiles —
  // el Liquidador no puede usar /admin/contratos ni /registros-horas/mis-contratos.
  getContratos() {
    return this.prisma.contrato.findMany({
      where: { activo: true },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: 'asc' },
    });
  }

  async upsertPerfil(cuil: string, dto: UpsertPerfilLiquidacionDto) {
    const empleado = await this.prisma.snuempleados.findUnique({ where: { cuil } });
    if (!empleado) throw new NotFoundException('No existe un empleado con ese CUIL');

    const upsertArgs = {
      where: { cuil },
      create: {
        cuil,
        regimen: dto.regimen,
        categoriaUocraId: dto.categoriaUocraId,
        modalidadPago: dto.modalidadPago,
        permiteHorasExtra: dto.permiteHorasExtra ?? false,
      },
      update: {
        regimen: dto.regimen,
        categoriaUocraId: dto.categoriaUocraId,
        modalidadPago: dto.modalidadPago,
        permiteHorasExtra: dto.permiteHorasExtra ?? false,
      },
    };

    // Sin el campo en el body no se tocan las asignaciones; presente (aunque
    // vacío) reemplaza el set completo. Si el régimen cambia a uno que no usa
    // imputación, las filas se conservan igual (dejan de usarse — addendum
    // plan 2026-08-12).
    if (dto.contratosImputacionIds === undefined) {
      return this.prisma.perfilLiquidacion.upsert(upsertArgs);
    }

    const ids = dto.contratosImputacionIds;
    return this.prisma.$transaction(async (tx) => {
      const perfil = await tx.perfilLiquidacion.upsert(upsertArgs);
      await tx.perfilContratoImputacion.deleteMany({ where: { cuil } });
      if (ids.length) {
        await tx.perfilContratoImputacion.createMany({
          data: ids.map((contratoId) => ({ cuil, contratoId })),
        });
      }
      return perfil;
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
            permiteHorasExtra: dto.permiteHorasExtra ?? false,
          },
          update: {
            regimen: dto.regimen,
            categoriaUocraId: dto.categoriaUocraId,
            modalidadPago: dto.modalidadPago,
            permiteHorasExtra: dto.permiteHorasExtra ?? false,
          },
        }),
      ),
      { timeout: 30000, maxWait: 10000 },
    );

    return { asignados: validos.length, omitidos };
  }

  // ---- Sueldos mensualizados: sección propia, ahora también por período
  // exacto e independiente (ver ADR-018, reemplaza el patrón de ADR-016) ----

  async getSueldosMensualizados(anio: number, mes: number) {
    const fecha = this.fechaDePeriodo(anio, mes);
    const perfiles = await this.prisma.perfilLiquidacion.findMany({
      where: { regimen: 'mensualizado' },
      include: {
        empleado: { select: { apellido_nombre: true } },
        categoria: { select: { nombre: true } },
      },
      orderBy: { cuil: 'asc' },
    });
    return Promise.all(
      perfiles.map(async (p) => {
        const propios = await this.prisma.sueldoMensualizado.findMany({ where: { cuil: p.cuil } });
        const resuelto = propios.find((s) => s.vigenteDesde.getTime() === fecha.getTime()) ?? null;
        const anterior = this.ultimoAnterior(propios, fecha);
        return {
          cuil: p.cuil,
          apellidoNombre: p.empleado.apellido_nombre,
          // La categoría no afecta el sueldo fijo, pero sí el bono no
          // remunerativo (ver §52) — el Liquidador la quiere a la vista.
          categoria: p.categoria?.nombre ?? null,
          resuelto: resuelto != null,
          monto: resuelto ? resuelto.monto.toString() : null,
          sugerencia: !resuelto && anterior ? { valor: anterior.monto.toString(), periodo: this.periodoDeFecha(anterior.vigenteDesde) } : null,
        };
      }),
    );
  }

  async guardarSueldosMensualizados(dto: GuardarSueldosMensualizadosDto, usuarioCuil: string) {
    const fecha = this.fechaDePeriodo(dto.anio, dto.mes);
    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.sueldos) {
        const existente = await tx.sueldoMensualizado.findUnique({
          where: { cuil_vigenteDesde: { cuil: item.cuil, vigenteDesde: fecha } },
        });
        if (existente) {
          if (Number(existente.monto) !== item.monto) {
            await tx.sueldoMensualizado.update({ where: { id: existente.id }, data: { monto: item.monto } });
            await this.auditarCambio(tx, 'sth_sueldos_mensualizados', existente.id, usuarioCuil, item.cuil, existente.monto.toString(), item.monto.toString());
          }
        } else {
          const creado = await tx.sueldoMensualizado.create({ data: { cuil: item.cuil, vigenteDesde: fecha, monto: item.monto } });
          await this.auditarCambio(tx, 'sth_sueldos_mensualizados', creado.id, usuarioCuil, item.cuil, null, item.monto.toString());
        }
      }
    }, { timeout: 30000, maxWait: 10000 });
    return this.getSueldosMensualizados(dto.anio, dto.mes);
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

  async cargarKmPorTantos(dto: CargarKmPorTantosDto, user: { cuil: string; rol: string }) {
    // Solo JefeContrato necesita el permiso puntual (ver ADR-014); Admin no
    // se restringe.
    if (user.rol === 'JefeContrato') {
      const usuario = await this.prisma.usuario.findUnique({
        where: { cuil: user.cuil },
        select: { puedeCargarKmPorTantos: true },
      });
      if (!usuario?.puedeCargarKmPorTantos) {
        throw new ForbiddenException('No tenés habilitada la carga de km "por tantos"');
      }
    }

    const existentes = await this.prisma.kmPorTantos.findMany({
      where: { anio: dto.anio, mes: dto.mes, quincena: dto.quincena, cuil: { in: dto.kms.map((k) => k.cuil) } },
    });
    const existentePorCuil = new Map(existentes.map((e) => [e.cuil, e]));

    await this.prisma.$transaction(
      async (tx) => {
        for (const k of dto.kms) {
          const existente = existentePorCuil.get(k.cuil);
          await tx.kmPorTantos.upsert({
            where: { cuil_anio_mes_quincena: { cuil: k.cuil, anio: dto.anio, mes: dto.mes, quincena: dto.quincena } },
            create: { cuil: k.cuil, anio: dto.anio, mes: dto.mes, quincena: dto.quincena, kmTotal: k.kmTotal },
            update: { kmTotal: k.kmTotal },
          });

          const valorAnterior = existente ? Number(existente.kmTotal) : null;
          if (valorAnterior === k.kmTotal) continue; // sin cambio real, no audita

          await tx.auditoria.create({
            data: {
              tabla: 'sth_km_por_tantos',
              registroId: 0, // sin id numérico (clave compuesta), igual criterio que sth_rangos_km_por_tantos
              usuarioCuil: user.cuil,
              accion: existente ? 'editar' : 'crear',
              campo: k.cuil,
              valorAnterior: valorAnterior?.toString() ?? null,
              valorNuevo: k.kmTotal.toString(),
            },
          });
        }
      },
      { timeout: 30000, maxWait: 10000 },
    );
    return { actualizados: dto.kms.length };
  }

  // ---- Plus individual (ver ADR-018): monto puntual por empleado/quincena,
  // con motivo — independiente de categoría, no versionado por período. ----

  async getPlusIndividual(anio: number, mes: number, quincena: number) {
    return this.prisma.plusIndividual.findMany({
      where: { anio, mes, quincena },
      include: { empleado: { select: { apellido_nombre: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cargarPlusIndividual(dto: CargarPlusIndividualDto, usuarioCuil: string) {
    const empleado = await this.prisma.snuempleados.findUnique({ where: { cuil: dto.cuil } });
    if (!empleado) throw new NotFoundException('No existe un empleado con ese CUIL');
    return this.prisma.plusIndividual.create({
      data: {
        cuil: dto.cuil,
        anio: dto.anio,
        mes: dto.mes,
        quincena: dto.quincena,
        monto: dto.monto,
        motivo: dto.motivo,
        cargadoPorCuil: usuarioCuil,
      },
    });
  }

  async eliminarPlusIndividual(id: number) {
    await this.prisma.plusIndividual.delete({ where: { id } });
    return { id };
  }
}
