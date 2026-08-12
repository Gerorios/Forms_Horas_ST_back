import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCategoriaUocraDto,
  UpdateCategoriaUocraDto,
  UpsertPerfilLiquidacionDto,
  CargarRondaTarifasDto,
  EditarRondaTarifasDto,
  GuardarSueldosMensualizadosDto,
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

  // ---- Edición de rondas ya cargadas (amendment 2026-08-04 al ADR-010) ----

  async getRondaTarifas(anio: number, mes: number) {
    const ronda = await this.prisma.rondaTarifas.findUnique({ where: { anio_mes: { anio, mes } } });
    if (!ronda) throw new NotFoundException('No existe una ronda cargada para ese período');

    const fecha = new Date(anio, mes - 1, 1);
    const categoriasActivas = await this.prisma.categoriaUocra.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
    });
    const categoriaIds = categoriasActivas.map((c) => c.id);

    const tarifas = await this.prisma.tarifaCategoriaUocra.findMany({
      where: { vigenteDesde: fecha, categoriaUocraId: { in: categoriaIds } },
    });
    const importePorCategoria = new Map(tarifas.map((t) => [t.categoriaUocraId, t.importeHora.toString()]));

    const bonos = await this.prisma.bonoNoRemunerativo.findMany({
      where: { vigenteDesde: fecha, categoriaUocraId: { in: categoriaIds } },
    });
    const bonoPorCategoria = new Map(bonos.map((b) => [b.categoriaUocraId, { tipo: b.tipo, valor: b.valor.toString() }]));

    const tiposConPlus = await this.prisma.tipoNovedad.findMany({
      where: { generaPlus: true, activo: true },
      orderBy: { nombre: 'asc' },
    });
    const montos = await this.prisma.montoNovedadPlus.findMany({
      where: { vigenteDesde: fecha, tipoNovedadId: { in: tiposConPlus.map((t) => t.id) } },
    });
    const montoPorTipo = new Map(montos.map((m) => [m.tipoNovedadId, m.montoPorDia.toString()]));

    const rangosKm = await this.prisma.rangoKmPorTantos.findMany({
      where: { vigenteDesde: fecha },
      orderBy: { kmDesde: 'asc' },
    });

    return {
      anio,
      mes,
      categorias: categoriasActivas.map((c) => ({
        categoriaUocraId: c.id,
        nombre: c.nombre,
        importeHora: importePorCategoria.get(c.id) ?? null,
      })),
      tiposNovedad: tiposConPlus.map((t) => ({
        tipoNovedadId: t.id,
        nombre: t.nombre,
        montoPorDia: montoPorTipo.get(t.id) ?? null,
      })),
      rangosKm: rangosKm.map((r) => ({
        kmDesde: r.kmDesde.toString(),
        kmHasta: r.kmHasta?.toString() ?? null,
        precioPorKm: r.precioPorKm.toString(),
      })),
      bonosNoRemunerativos: categoriasActivas.map((c) => ({
        categoriaUocraId: c.id,
        bono: bonoPorCategoria.get(c.id) ?? null,
      })),
    };
  }

  async editarRondaTarifas(anio: number, mes: number, dto: EditarRondaTarifasDto, usuarioCuil: string) {
    const ronda = await this.prisma.rondaTarifas.findUnique({ where: { anio_mes: { anio, mes } } });
    if (!ronda) throw new NotFoundException('No existe una ronda cargada para ese período');

    const fecha = new Date(anio, mes - 1, 1);

    await this.prisma.$transaction(async (tx) => {
      // ---- Tarifas por categoría ----
      for (const c of dto.categorias) {
        const existente = await tx.tarifaCategoriaUocra.findUnique({
          where: { categoriaUocraId_vigenteDesde: { categoriaUocraId: c.categoriaUocraId, vigenteDesde: fecha } },
        });
        if (existente) {
          if (Number(existente.importeHora) !== c.importeHora) {
            const valorAnterior = existente.importeHora.toString();
            await tx.tarifaCategoriaUocra.update({ where: { id: existente.id }, data: { importeHora: c.importeHora } });
            await tx.auditoria.create({
              data: {
                tabla: 'sth_tarifas_categoria_uocra',
                registroId: existente.id,
                usuarioCuil,
                accion: 'editar',
                campo: 'importeHora',
                valorAnterior,
                valorNuevo: c.importeHora.toString(),
              },
            });
          }
        } else {
          const creada = await tx.tarifaCategoriaUocra.create({
            data: { categoriaUocraId: c.categoriaUocraId, vigenteDesde: fecha, importeHora: c.importeHora },
          });
          await tx.auditoria.create({
            data: {
              tabla: 'sth_tarifas_categoria_uocra',
              registroId: creada.id,
              usuarioCuil,
              accion: 'crear',
              campo: 'importeHora',
              valorNuevo: c.importeHora.toString(),
            },
          });
        }
      }

      // ---- Montos de novedad con plus ----
      for (const t of dto.tiposNovedad) {
        const existente = await tx.montoNovedadPlus.findUnique({
          where: { tipoNovedadId_vigenteDesde: { tipoNovedadId: t.tipoNovedadId, vigenteDesde: fecha } },
        });
        if (existente) {
          if (Number(existente.montoPorDia) !== t.montoPorDia) {
            const valorAnterior = existente.montoPorDia.toString();
            await tx.montoNovedadPlus.update({ where: { id: existente.id }, data: { montoPorDia: t.montoPorDia } });
            await tx.auditoria.create({
              data: {
                tabla: 'sth_montos_novedad_plus',
                registroId: existente.id,
                usuarioCuil,
                accion: 'editar',
                campo: 'montoPorDia',
                valorAnterior,
                valorNuevo: t.montoPorDia.toString(),
              },
            });
          }
        } else {
          const creado = await tx.montoNovedadPlus.create({
            data: { tipoNovedadId: t.tipoNovedadId, vigenteDesde: fecha, montoPorDia: t.montoPorDia },
          });
          await tx.auditoria.create({
            data: {
              tabla: 'sth_montos_novedad_plus',
              registroId: creado.id,
              usuarioCuil,
              accion: 'crear',
              campo: 'montoPorDia',
              valorNuevo: t.montoPorDia.toString(),
            },
          });
        }
      }

      // ---- Bonos no remunerativos ----
      const bonosExistentes = await tx.bonoNoRemunerativo.findMany({ where: { vigenteDesde: fecha } });
      const bonoExistentePorCategoria = new Map(bonosExistentes.map((b) => [b.categoriaUocraId, b]));
      const bonosDto = dto.bonosNoRemunerativos ?? [];
      const categoriasConBonoEnDto = new Set(bonosDto.map((b) => b.categoriaUocraId));

      for (const b of bonosDto) {
        const existente = bonoExistentePorCategoria.get(b.categoriaUocraId);
        if (existente) {
          if (Number(existente.valor) !== b.valor || existente.tipo !== b.tipo) {
            const valorAnterior = existente.valor.toString();
            await tx.bonoNoRemunerativo.update({
              where: { id: existente.id },
              data: { tipo: b.tipo, valor: b.valor },
            });
            await tx.auditoria.create({
              data: {
                tabla: 'sth_bonos_no_remunerativos',
                registroId: existente.id,
                usuarioCuil,
                accion: 'editar',
                campo: 'valor',
                valorAnterior,
                valorNuevo: b.valor.toString(),
              },
            });
          }
        } else {
          const creado = await tx.bonoNoRemunerativo.create({
            data: { categoriaUocraId: b.categoriaUocraId, vigenteDesde: fecha, tipo: b.tipo, valor: b.valor },
          });
          await tx.auditoria.create({
            data: {
              tabla: 'sth_bonos_no_remunerativos',
              registroId: creado.id,
              usuarioCuil,
              accion: 'crear',
              campo: 'valor',
              valorNuevo: b.valor.toString(),
            },
          });
        }
      }

      for (const [categoriaUocraId, existente] of bonoExistentePorCategoria) {
        if (!categoriasConBonoEnDto.has(categoriaUocraId)) {
          await tx.bonoNoRemunerativo.delete({ where: { id: existente.id } });
          await tx.auditoria.create({
            data: {
              tabla: 'sth_bonos_no_remunerativos',
              registroId: existente.id,
              usuarioCuil,
              accion: 'editar',
              campo: 'valor',
              valorAnterior: existente.valor.toString(),
              valorNuevo: null,
            },
          });
        }
      }

      // ---- Rangos km (reemplazo completo del período; no-op si no cambió nada) ----
      const rangosViejos = await tx.rangoKmPorTantos.findMany({ where: { vigenteDesde: fecha }, orderBy: { kmDesde: 'asc' } });
      const rangosViejosSerializados = rangosViejos.map((r) => ({
        kmDesde: r.kmDesde.toString(),
        kmHasta: r.kmHasta?.toString() ?? null,
        precioPorKm: r.precioPorKm.toString(),
      }));
      // Comparación normalizada a 2 decimales (Decimal.toString() recorta ceros: "40" vs "40.00").
      const comparable = (r: { kmDesde: unknown; kmHasta?: unknown; precioPorKm: unknown }) => ({
        kmDesde: Number(r.kmDesde).toFixed(2),
        kmHasta: r.kmHasta != null ? Number(r.kmHasta).toFixed(2) : null,
        precioPorKm: Number(r.precioPorKm).toFixed(2),
      });
      const rangosCambiaron =
        JSON.stringify(rangosViejosSerializados.map(comparable)) !==
        JSON.stringify(dto.rangosKm.map(comparable));
      if (rangosCambiaron) {
        await tx.rangoKmPorTantos.deleteMany({ where: { vigenteDesde: fecha } });
        if (dto.rangosKm.length) {
          await tx.rangoKmPorTantos.createMany({
            data: dto.rangosKm.map((r) => ({
              vigenteDesde: fecha,
              kmDesde: r.kmDesde,
              kmHasta: r.kmHasta ?? null,
              precioPorKm: r.precioPorKm,
            })),
          });
        }
        await tx.auditoria.create({
          data: {
            tabla: 'sth_rangos_km_por_tantos',
            registroId: 0,
            usuarioCuil,
            accion: 'editar',
            campo: 'rangosKm',
            valorAnterior: JSON.stringify(rangosViejosSerializados),
            valorNuevo: JSON.stringify(dto.rangosKm),
          },
        });
      }
    }, { timeout: 30000, maxWait: 10000 });

    return this.getRondaTarifas(anio, mes);
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

  // ---- Sueldos mensualizados: vigentes, comparten estado "mes resuelto" con
  // la ronda de tarifas (ver ADR-016) ----

  async getSueldosMensualizados(anio: number, mes: number) {
    const fecha = new Date(anio, mes - 1, 1);
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
        const vigente = await this.prisma.sueldoMensualizado.findFirst({
          where: { cuil: p.cuil, vigenteDesde: { lte: fecha } },
          orderBy: { vigenteDesde: 'desc' },
        });
        return {
          cuil: p.cuil,
          apellidoNombre: p.empleado.apellido_nombre,
          // La categoría no afecta el sueldo fijo, pero sí el bono no
          // remunerativo (ver §52) — el Liquidador la quiere a la vista.
          categoria: p.categoria?.nombre ?? null,
          monto: vigente ? vigente.monto.toString() : null,
        };
      }),
    );
  }

  async guardarSueldosMensualizados(dto: GuardarSueldosMensualizadosDto, usuarioCuil: string) {
    const objetivo: Periodo = { anio: dto.anio, mes: dto.mes };
    const fechaObjetivo = new Date(objetivo.anio, objetivo.mes - 1, 1);

    const rondaObjetivo = await this.prisma.rondaTarifas.findUnique({ where: { anio_mes: objetivo } });
    const ultimaRonda = await this.prisma.rondaTarifas.findFirst({ orderBy: [{ anio: 'desc' }, { mes: 'desc' }] });

    if (
      !rondaObjetivo &&
      ultimaRonda &&
      (objetivo.anio < ultimaRonda.anio || (objetivo.anio === ultimaRonda.anio && objetivo.mes < ultimaRonda.mes))
    ) {
      throw new BadRequestException(
        'Ese período es anterior al último cargado y todavía no fue resuelto — no se puede crear retroactivamente',
      );
    }

    const perfiles = await this.prisma.perfilLiquidacion.findMany({
      where: { regimen: 'mensualizado' },
      select: { cuil: true },
    });
    const cuils = perfiles.map((p) => p.cuil);

    await this.prisma.$transaction(
      async (tx) => {
        // Si el mes todavía no existía en RondaTarifas (ni por esta sección
        // ni por la ronda de categorías/km/plus), completa los meses
        // salteados copiando el último sueldo vigente de cada empleado —
        // mismo criterio que ADR-010, aplicado por persona en vez de por
        // categoría. Cualquiera de las dos secciones puede "abrir" el mes.
        if (!rondaObjetivo) {
          const faltantes = this.mesesFaltantes(
            ultimaRonda ? { anio: ultimaRonda.anio, mes: ultimaRonda.mes } : null,
            objetivo,
          );
          for (const periodo of faltantes) {
            const fecha = new Date(periodo.anio, periodo.mes - 1, 1);
            for (const cuil of cuils) {
              const vigente = await tx.sueldoMensualizado.findFirst({
                where: { cuil, vigenteDesde: { lte: fecha } },
                orderBy: { vigenteDesde: 'desc' },
              });
              if (vigente) {
                await tx.sueldoMensualizado.upsert({
                  where: { cuil_vigenteDesde: { cuil, vigenteDesde: fecha } },
                  create: { cuil, vigenteDesde: fecha, monto: vigente.monto },
                  update: {},
                });
              }
            }
            await tx.rondaTarifas.upsert({ where: { anio_mes: periodo }, create: periodo, update: {} });
          }
          await tx.rondaTarifas.upsert({ where: { anio_mes: objetivo }, create: objetivo, update: {} });
        }

        for (const item of dto.sueldos) {
          const existente = await tx.sueldoMensualizado.findUnique({
            where: { cuil_vigenteDesde: { cuil: item.cuil, vigenteDesde: fechaObjetivo } },
          });
          if (existente) {
            const valorAnterior = Number(existente.monto);
            if (valorAnterior !== item.monto) {
              await tx.sueldoMensualizado.update({ where: { id: existente.id }, data: { monto: item.monto } });
              await tx.auditoria.create({
                data: {
                  tabla: 'sth_sueldos_mensualizados',
                  registroId: existente.id,
                  usuarioCuil,
                  accion: 'editar',
                  campo: item.cuil,
                  valorAnterior: valorAnterior.toString(),
                  valorNuevo: item.monto.toString(),
                },
              });
            }
          } else {
            const creado = await tx.sueldoMensualizado.create({
              data: { cuil: item.cuil, vigenteDesde: fechaObjetivo, monto: item.monto },
            });
            await tx.auditoria.create({
              data: {
                tabla: 'sth_sueldos_mensualizados',
                registroId: creado.id,
                usuarioCuil,
                accion: 'crear',
                campo: item.cuil,
                valorNuevo: item.monto.toString(),
              },
            });
          }
        }
      },
      { timeout: 30000, maxWait: 10000 },
    );
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
}
