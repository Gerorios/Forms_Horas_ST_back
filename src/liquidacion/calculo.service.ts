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

  /** Días de una novedad que caen dentro de [desde, hasta], recortando a los bordes. Público: PanelService lo reusa para clipear el plus por novedad individual en el detalle de quincena. */
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

    // Sueldos mensualizados: "vigente" por empleado (igual patrón que las
    // tarifas de categoría), no por quincena exacta — ver ADR-016.
    const sueldosMensualizados = await this.prisma.sueldoMensualizado.findMany({
      where: { cuil: { in: cuils }, vigenteDesde: { lte: fechaVigencia } },
    });

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
      } else if (perfil.regimen === 'mensualizado') {
        const sueldo = this.masVigente(
          sueldosMensualizados.filter((s) => s.cuil === perfil.cuil),
          fechaVigencia,
        );
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
        } else {
          const rango = this.buscarRangoKm(rangosKmVigentes, kmTotal);
          const montoKm = rango ? kmTotal * Number(rango.precioPorKm) : 0;
          montoKmBruto = montoKm;
          horasTotal = tarifaHoraNum > 0 ? montoKm / tarifaHoraNum : 0;
          horasCct = Math.min(horasTotal, 88);
          horasExtra = Math.max(horasTotal - 88, 0);
          basico = tarifaHoraNum * horasCct;
          // A diferencia de jornalizado, el extra de "por tantos" NO lleva
          // el multiplicador ×1.5 (se paga al mismo precio de categoría) y
          // siempre se paga en B, sin relación con modalidadPago — ver ADR-015.
          montoExtra = horasExtra * tarifaHoraNum;
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
          const montoVigente = this.masVigente(
            montosPlus.filter((m) => m.tipoNovedadId === tipo.id),
            fechaVigencia,
          );
          const montoPorNovedad = montoVigente ? Number(montoVigente.montoPorDia) : null;
          plus.push({ tipoNovedadId: tipo.id, nombre: tipo.nombre, dias: cantidad, monto: montoPorNovedad ? cantidad * montoPorNovedad : 0 });
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
