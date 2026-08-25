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
  // Régimen "por tantos" (relevador de fugas): el monto neto de km (km ×
  // precio del rango) equivale a horas × tarifa × este factor — presentismo
  // (+20%, ×1,2) y cargas sociales (−18,5%, ×0,815) combinados. Se usa para
  // despejar horasTotal, y también para el monto en B (ver más abajo).
  // Constante fija (no editable por período) — decisión 2026-08-25,
  // corrige dos versiones previas (÷1,0185 el 24/8, y antes ×0,815 solo)
  // que no cerraban contra un recibo real.
  private static readonly PRESENTISMO_Y_CARGAS_SOCIALES_FACTOR = 1.2 * 0.815; // 0.978

  constructor(private prisma: PrismaService) {}

  private rangoQuincena(anio: number, mes: number, quincena: number): { desde: Date; hasta: Date } {
    return rangoQuincena(anio, mes, quincena);
  }

  /** Días de una novedad que caen dentro de [desde, hasta], recortando a los bordes. Público: PanelService lo reusa para clipear el plus por novedad individual en el detalle de quincena. */
  diasClip(fechaInicio: Date, fechaFin: Date | null, desde: Date, hasta: Date): number {
    const fin = fechaFin ?? fechaInicio;
    const inicioClamp = fechaInicio > desde ? fechaInicio : desde;
    const finClamp = fin < hasta ? fin : hasta;
    const diff = Math.floor((finClamp.getTime() - inicioClamp.getTime()) / 86_400_000) + 1;
    return diff > 0 ? diff : 0;
  }

  /**
   * Rango de km "por tantos" (ver ADR-009) al que corresponde un total dado.
   * Los límites NO son uniformes — cada km tiene que caer en exactamente un
   * rango, sin huecos ni superposición:
   *  - el primer rango (el de kmDesde más bajo) EXCLUYE su propio tope,
   *  - el/los rango(s) del medio INCLUYEN ambos extremos,
   *  - el último rango (sin techo, kmHasta null) EXCLUYE su propio piso.
   * Ej. con rangos 0–60 / 60–75 / 75–null: 60 cae en el segundo (no el
   * primero), 75 cae en el segundo (no el tercero, que es "mayor a 75").
   * No depende del orden en que Prisma devuelve las filas: se ordena acá.
   */
  private buscarRangoKm<T extends { kmDesde: unknown; kmHasta: unknown }>(
    rangos: T[],
    km: number,
  ): T | undefined {
    const ordenados = [...rangos].sort((a, b) => Number(a.kmDesde) - Number(b.kmDesde));
    return ordenados.find((r, i) => {
      const esPrimero = i === 0;
      const esUltimo = r.kmHasta == null;
      const kmDesde = Number(r.kmDesde);
      const cumpleDesde = esUltimo ? km > kmDesde : km >= kmDesde;
      const cumpleHasta = esUltimo ? true : esPrimero ? km < Number(r.kmHasta) : km <= Number(r.kmHasta);
      return cumpleDesde && cumpleHasta;
    });
  }

  async calcularQuincena(anio: number, mes: number, quincena: number) {
    const { desde, hasta } = this.rangoQuincena(anio, mes, quincena);
    // UTC, no hora local — mismo criterio que liquidacion.service.ts
    // (fechaDePeriodo): `vigenteDesde` se guarda como medianoche UTC exacta.
    const fechaVigencia = new Date(Date.UTC(anio, mes - 1, 1));

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

    // Sueldos mensualizados, tarifas por categoría, montos de novedad con
    // plus, bono no remunerativo y rangos de km: los 5 campos de precios por
    // período (ver ADR-018). Se busca SOLO la fila exacta del período — sin
    // fila propia, es "sin resolver" (alerta), nunca se hereda de otro mes.
    const [sueldosMensualizados, tarifas, montosPlus, bonos, rangosKm, plusIndividual] = await Promise.all([
      this.prisma.sueldoMensualizado.findMany({ where: { cuil: { in: cuils }, vigenteDesde: fechaVigencia } }),
      this.prisma.tarifaCategoriaUocra.findMany({ where: { vigenteDesde: fechaVigencia } }),
      this.prisma.montoNovedadPlus.findMany({ where: { vigenteDesde: fechaVigencia } }),
      this.prisma.bonoNoRemunerativo.findMany({ where: { vigenteDesde: fechaVigencia } }),
      this.prisma.rangoKmPorTantos.findMany({ where: { vigenteDesde: fechaVigencia } }),
      this.prisma.plusIndividual.findMany({ where: { cuil: { in: cuils }, anio, mes, quincena } }),
    ]);

    const kmsPorTantos = await this.prisma.kmPorTantos.findMany({ where: { anio, mes, quincena } });
    const kmPorCuil = new Map(kmsPorTantos.map((k) => [k.cuil, Number(k.kmTotal)]));
    const plusIndividualPorCuil = new Map(plusIndividual.map((p) => [p.cuil, p]));

    // Rango de km del período: ya viene filtrado por vigenteDesde exacto —
    // solo ordenar por bracket (kmDesde asc, ver buscarRangoKm).
    const rangosKmVigentes = rangosKm;
    const hayRangosKmDelPeriodo = rangosKm.length > 0;

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
        // Una novedad anulada nunca debe afectar la liquidación (ni quitar
        // presentismo ni sumar plus) — feature editar/anular ausencias 2026-08-19.
        estado: 'activa',
        fechaInicio: { lte: hasta },
        // Novedad sin fechaFin = de un solo dia (decision 2026-08-05): solapa la
        // quincena solo si su unico dia (fechaInicio) cae dentro del rango.
        OR: [{ fechaFin: { gte: desde } }, { fechaFin: null, fechaInicio: { gte: desde } }],
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
        ? (tarifas.find((t) => t.categoriaUocraId === perfil.categoriaUocraId)?.importeHora ?? null)
        : null;
      const tarifaHoraNum = tarifaHora != null ? Number(tarifaHora) : null;

      let horasTotal = 0;
      let horasCct = 0;
      let horasExtra = 0;
      let basico = 0;
      let montoExtra = 0;
      let datoFaltante: string | null = null;
      // Solo "por tantos": monto bruto de km × precio del rango, antes de
      // convertir a horas equivalentes — se expone aparte para la tabla
      // propia del panel (ver ADR-015). Null para el resto de los regímenes.
      let montoKmBruto: number | null = null;

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
      } else if (perfil.regimen === 'fijo_105') {
        // Igual que "fijo", pero con 17,5hs extra SIEMPRE fijas (nunca
        // dependen de horas reportadas) — 105hs totales. Ver ADR-020.
        horasTotal = 105;
        horasCct = 88;
        horasExtra = 17.5;
        if (tarifaHoraNum != null) {
          basico = tarifaHoraNum * 88;
          montoExtra = 17.5 * tarifaHoraNum * 1.5;
        } else {
          datoFaltante = 'Sin categoría UOCRA / tarifa asignada';
        }
      } else if (perfil.regimen === 'mensualizado') {
        const sueldo = sueldosMensualizados.find((s) => s.cuil === perfil.cuil) ?? null;
        horasCct = 1;
        if (sueldo != null) {
          basico = Number(sueldo.monto);
        } else {
          datoFaltante = 'Falta cargar el sueldo mensualizado (Tarifas > Sueldos mensualizados)';
        }
        // permiteHorasExtra (ADR-017): además del monto fijo, cobra horas
        // extra. Lo declarado por Reporte diario NO es el total trabajado
        // (a diferencia de jornalizado) — es directamente el excedente sobre
        // su jornal, que nunca se carga, así que no se resta nada. El básico
        // (monto fijo) no usa la categoría UOCRA, pero el extra sí la
        // necesita para la tarifa × 1.5.
        if (perfil.permiteHorasExtra) {
          horasExtra = horasAprobadasPorCuil.get(perfil.cuil) ?? 0;
          if (tarifaHoraNum != null) {
            montoExtra = horasExtra * tarifaHoraNum * 1.5;
          } else if (datoFaltante == null) {
            datoFaltante = 'Sin categoría UOCRA / tarifa asignada (necesaria para las horas extra)';
          }
          horasTotal = horasCct + horasExtra;
        } else {
          horasTotal = 1;
        }
      } else if (perfil.regimen === 'por_tantos') {
        const kmTotal = kmPorCuil.get(perfil.cuil);
        if (kmTotal == null) {
          datoFaltante = 'Falta cargar los km de esta quincena';
        } else if (tarifaHoraNum == null) {
          datoFaltante = 'Sin categoría UOCRA / tarifa asignada (necesaria para convertir km a horas)';
        } else if (!hayRangosKmDelPeriodo) {
          datoFaltante = 'Falta cargar los rangos de km de este período (Tarifas > Precios)';
        } else {
          const rango = this.buscarRangoKm(rangosKmVigentes, kmTotal);
          const montoKm = rango ? kmTotal * Number(rango.precioPorKm) : 0;
          montoKmBruto = montoKm;
          const divisorHoras = tarifaHoraNum * CalculoService.PRESENTISMO_Y_CARGAS_SOCIALES_FACTOR;
          horasTotal = divisorHoras > 0 ? montoKm / divisorHoras : 0;
          horasCct = Math.min(horasTotal, 88);
          horasExtra = Math.max(horasTotal - 88, 0);
          // básico usa la tarifa COMPLETA de categoría (sin el ajuste de
          // presentismo/cargas sociales, que solo se usa para despejar
          // horasTotal arriba y, más abajo, el residual del monto en B).
          basico = tarifaHoraNum * horasCct;
          // El monto en B NO es horasExtra × tarifa — pese al nombre de la
          // variable (se reusa el mismo campo que jornalizado/mensualizado
          // para no duplicar el shape del panel). Es lo que sobra del monto
          // neto de km una vez descontado el básico de 88hs llevado a su
          // equivalente "grossed up" (básico × presentismo × cargas
          // sociales) — el bono no remunerativo queda totalmente afuera de
          // esta cuenta, es una línea separada. Sin extra (horasTotal <=
          // 88), no hay residual que calcular. Ver explicación del usuario,
          // 2026-08-25, validada al centavo contra un recibo real.
          montoExtra = horasExtra > 0 ? montoKm - basico * CalculoService.PRESENTISMO_Y_CARGAS_SOCIALES_FACTOR : 0;
        }
      }

      const novedadesCuil = novedadesPorCuil.get(perfil.cuil) ?? [];

      // Presentismo: 20% del básico, salvo Ausencia (cualquier estadoHys —
      // pendiente, aprobada o desaprobada) o Suspensión en el período. Antes
      // solo la desaprobada lo hacía perder; cambio de regla 2026-08-18: con
      // Ausencia justificada o injustificada, o todavía sin resolver, igual
      // se pierde el presentismo (ver contexto sección "ausencias
      // justificada/injustificada").
      const tieneAusencia = novedadesCuil.some((n) => n.tipoNovedad.nombre === 'Ausencia');
      const suspension = novedadesCuil.some((n) => n.tipoNovedad.nombre === 'Suspensión');
      const tienePresentismo = !tieneAusencia && !suspension;
      const presentismo = tienePresentismo ? basico * 0.2 : 0;

      // Plus de novedades (Guardia Pasiva, Viáticos, etc.): se paga POR CARGA de
      // novedad, nunca por día (decisión 2026-08-05). Cada novedad del tipo cuenta
      // una vez, en la quincena donde INICIA — la fechaFin es informativa (cuánto
      // duró) y no multiplica el pago. `dias` conserva el nombre por compatibilidad
      // de shape, pero es la CANTIDAD de cargas del tipo en la quincena.
      const plus: { tipoNovedadId: number; nombre: string; dias: number; monto: number }[] = [];
      for (const tipo of tiposConPlus) {
        const cantidad = novedadesCuil.filter(
          (n) => n.tipoNovedadId === tipo.id && n.fechaInicio >= desde && n.fechaInicio <= hasta,
        ).length;
        if (cantidad > 0) {
          const montoVigente = montosPlus.find((m) => m.tipoNovedadId === tipo.id) ?? null;
          if (montoVigente == null && datoFaltante == null) {
            datoFaltante = `Falta cargar el monto de "${tipo.nombre}" de este período (Tarifas > Precios)`;
          }
          const montoPorNovedad = montoVigente ? Number(montoVigente.montoPorDia) : null;
          plus.push({ tipoNovedadId: tipo.id, nombre: tipo.nombre, dias: cantidad, monto: montoPorNovedad ? cantidad * montoPorNovedad : 0 });
        }
      }
      const totalPlus = plus.reduce((s, p) => s + p.monto, 0);

      // Bono no remunerativo (por categoría, único campo OPCIONAL de precios
      // — sin fila no se alerta ni se suma nada, ver ADR-018).
      let noRemunerativo = 0;
      if (perfil.categoriaUocraId) {
        const bono = bonos.find((b) => b.categoriaUocraId === perfil.categoriaUocraId) ?? null;
        if (bono) {
          noRemunerativo =
            bono.tipo === 'monto_fijo' ? Number(bono.valor) : (tarifaHoraNum ?? 0) * (Number(bono.valor) / 100);
        }
      }

      // Plus individual (ver ADR-018): monto puntual por empleado/quincena,
      // independiente de categoría y del bono — no versionado por período.
      const plusIndividualMonto = Number(plusIndividualPorCuil.get(perfil.cuil)?.monto ?? 0);

      const total = basico + montoExtra + presentismo + totalPlus + noRemunerativo + plusIndividualMonto;

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
        montoKmBruto,
        horasTotal,
        horasCct,
        totalBruto: basico,
        horasExtra,
        montoHorasExtra: montoExtra,
        tienePresentismo,
        montoPresentismo: presentismo,
        plus,
        noRemunerativo,
        plusIndividual: plusIndividualMonto || null,
        plusIndividualMotivo: plusIndividualPorCuil.get(perfil.cuil)?.motivo ?? null,
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

    const necesitaCategoria = ['jornalizado', 'fijo', 'fijo_105', 'por_tantos'];
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
