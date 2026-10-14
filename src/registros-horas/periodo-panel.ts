import { BadRequestException } from '@nestjs/common';
import { rangoQuincena } from '../common/quincena';

/** Período que consulta el panel Control general (ADR-030): una quincena, un
 * mes completo o un rango libre desde/hasta. Fechas LOCALES, como
 * `rangoQuincena`, ambas inclusive. */
export interface PeriodoPanel {
  desde: Date;
  hasta: Date;
  /** La quincena, cuando el período es exactamente una. null = mes completo o
   * rango libre: lo que solo tiene sentido por quincena (umbral de horas extra,
   * comparación con la anterior) no se calcula. */
  quincena: { anio: number; mes: number; quincena: number } | null;
}

/** Tope de un rango desde/hasta: el Excel y el Detalle diario traen todas las
 * filas del período, y un año ya cubre cualquier control de los jefes. */
export const MAX_MESES_PERIODO = 12;

export function periodoQuincena(anio: number, mes: number, quincena: number): PeriodoPanel {
  return { ...rangoQuincena(anio, mes, quincena), quincena: { anio, mes, quincena } };
}

/** "YYYY-MM-DD" → Date local; null si el texto no es una fecha real. */
function parseFecha(texto: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return null;
  const [anio, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const fecha = new Date(anio, mes - 1, dia);
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia ? fecha : null;
}

function mismaFecha(a: Date, b: Date) {
  return a.getTime() === b.getTime();
}

/** Arma el período desde los query params del panel. Desde/hasta mandan sobre
 * año/mes; sin ellos, año y mes son obligatorios y la quincena es opcional
 * (sin quincena = mes completo). Cualquier combinación inválida → 400. */
export function resolverPeriodo(q: {
  anio?: number;
  mes?: number;
  quincena?: number;
  desde?: string;
  hasta?: string;
}): PeriodoPanel {
  if (q.desde || q.hasta) {
    if (!q.desde || !q.hasta) throw new BadRequestException('El rango necesita fecha desde y fecha hasta.');
    const desde = parseFecha(q.desde);
    const hasta = parseFecha(q.hasta);
    if (!desde || !hasta) throw new BadRequestException('Las fechas del rango deben tener el formato AAAA-MM-DD.');
    if (hasta < desde) throw new BadRequestException('La fecha hasta no puede ser anterior a la fecha desde.');
    const tope = new Date(desde.getFullYear(), desde.getMonth() + MAX_MESES_PERIODO, desde.getDate() - 1);
    if (hasta > tope) throw new BadRequestException(`El rango no puede superar los ${MAX_MESES_PERIODO} meses.`);
    // Un rango que coincide con una quincena se trata como tal: así da lo
    // mismo elegirla por mes o por fechas.
    const parte = desde.getDate() === 1 ? 1 : desde.getDate() === 16 ? 2 : null;
    if (parte) {
      const exacta = periodoQuincena(desde.getFullYear(), desde.getMonth() + 1, parte);
      if (mismaFecha(exacta.desde, desde) && mismaFecha(exacta.hasta, hasta)) return exacta;
    }
    return { desde, hasta, quincena: null };
  }

  if (!Number.isInteger(q.anio) || !Number.isInteger(q.mes) || q.mes! < 1 || q.mes! > 12)
    throw new BadRequestException('Falta el período: año y mes, o fecha desde y hasta.');
  if (q.quincena === undefined) {
    return { desde: new Date(q.anio!, q.mes! - 1, 1), hasta: new Date(q.anio!, q.mes!, 0), quincena: null };
  }
  if (q.quincena !== 1 && q.quincena !== 2) throw new BadRequestException('La quincena debe ser 1 o 2.');
  return periodoQuincena(q.anio!, q.mes!, q.quincena);
}

/** La quincena calendario que contiene una fecha — para anclar el histórico
 * en el final de un período que no es una quincena. */
export function quincenaDeFecha(fecha: Date): { anio: number; mes: number; quincena: number } {
  return { anio: fecha.getFullYear(), mes: fecha.getMonth() + 1, quincena: fecha.getDate() <= 15 ? 1 : 2 };
}
