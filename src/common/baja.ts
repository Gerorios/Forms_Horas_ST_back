/** Baja de Operario (ADR-026): novedad que informa el ÚLTIMO DÍA TRABAJADO de
 * una persona (`fechaInicio`; `fechaFin` no aplica). La confirma HyS con el
 * circuito de aprobación de siempre: solo una baja `aprobada` tiene efecto
 * (bloquea horas posteriores, $0 en quincenas posteriores); `pendiente` se
 * muestra como "informada, sin confirmar" y no hace nada. Nombre exacto del
 * tipo en `sth_tipos_novedad` — mismo criterio por nombre que 'Ausencia'. */
export const TIPO_BAJA = 'Baja de Operario';

export interface BajaOperario {
  /** Último día trabajado, como clave 'YYYY-MM-DD'. */
  fechaBaja: string;
  confirmada: boolean;
}

/** Clave de día de un `@db.Date` de Prisma (medianoche UTC). */
export function claveDiaUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Clave de día de una fecha armada en hora local (`rangoQuincena`). Mezclar
 * las dos convenciones con `getTime()` corre el borde un día en UTC-3. */
export function claveDiaLocal(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' para mensajes. */
export function formatearClave(clave: string): string {
  const [a, m, d] = clave.split('-');
  return `${d}/${m}/${a}`;
}

type PrismaConNovedad = {
  novedad: { findMany: (args: any) => Promise<{ operarioCuil: string; fechaInicio: Date; estadoHys: string }[]> };
};

/** Bajas vigentes (activas, pendientes o confirmadas) por cuil. Una sola por
 * persona por regla de carga; si por datos viejos hubiera más de una, gana
 * la confirmada y, entre iguales, la de fecha más temprana. */
export async function bajasPorCuil(
  prisma: PrismaConNovedad,
  cuils?: string[],
): Promise<Map<string, BajaOperario>> {
  const filas = await prisma.novedad.findMany({
    where: {
      tipoNovedad: { nombre: TIPO_BAJA },
      estado: 'activa',
      estadoHys: { in: ['pendiente', 'aprobada'] },
      ...(cuils ? { operarioCuil: { in: cuils } } : {}),
    },
    select: { operarioCuil: true, fechaInicio: true, estadoHys: true },
  });
  const mapa = new Map<string, BajaOperario>();
  for (const f of filas) {
    const nueva: BajaOperario = { fechaBaja: claveDiaUtc(f.fechaInicio), confirmada: f.estadoHys === 'aprobada' };
    const actual = mapa.get(f.operarioCuil);
    if (
      !actual ||
      (nueva.confirmada && !actual.confirmada) ||
      (nueva.confirmada === actual.confirmada && nueva.fechaBaja < actual.fechaBaja)
    ) {
      mapa.set(f.operarioCuil, nueva);
    }
  }
  return mapa;
}

/** ¿El día (clave) cae después de una baja CONFIRMADA? Una pendiente no corta nada. */
export function esPosteriorABaja(claveDia: string, baja: BajaOperario | undefined): boolean {
  return !!baja && baja.confirmada && claveDia > baja.fechaBaja;
}
