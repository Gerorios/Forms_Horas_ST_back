import { ForbiddenException, Injectable } from '@nestjs/common';
import { AnalisisService } from '../liquidacion/analisis.service';
import { CertClaim } from './accesos.service';

export interface IncidenciaMo {
  contratos: { codigo: string; montoMo: number }[];
  sinAsignar: number | null;
}

export interface IncidenciaMesSerie extends IncidenciaMo {
  anio: number;
  mes: number;
}

interface IncidenciaMesBruto {
  contratos: { codigo: string; montoMo: number }[];
  sinAsignar: number;
}

// Los montos de AnalisisService ya vienen redondeados a 2 decimales, pero
// sumar floats (aunque estén redondeados) puede dar restos de precisión
// binaria (ej. 10.1 + 5.2 = 15.299999999999999) — se redondea el acumulado.
const redondear2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Incidencia de mano de obra por contrato (K), consumida por el módulo de
 * certificaciones. Suma quincena 1 + quincena 2 del corte por contrato que
 * ya produce AnalisisService (prorrateo por horas aprobadas). Visibilidad
 * por claim `cert` (Task 3): la autorización vive acá, no en el controller.
 */
@Injectable()
export class IncidenciaService {
  constructor(private readonly analisis: AnalisisService) {}

  // Cache de meses CERRADOS (inmutables): clave "anio-mes" → agregado SIN
  // filtrar por claim. El mes corriente nunca se cachea. 1 solo proceso
  // (PM2) — mismo criterio que el cache del portal.
  private readonly cacheMes = new Map<string, IncidenciaMesBruto>();

  private esMesCerrado(anio: number, mes: number): boolean {
    const hoy = new Date();
    return anio < hoy.getFullYear() || (anio === hoy.getFullYear() && mes < hoy.getMonth() + 1);
  }

  private async calcularMes(anio: number, mes: number): Promise<IncidenciaMesBruto> {
    const clave = `${anio}-${mes}`;
    const cerrado = this.esMesCerrado(anio, mes);
    if (cerrado) {
      const cacheado = this.cacheMes.get(clave);
      if (cacheado) return cacheado;
    }

    const [q1, q2] = await Promise.all([
      this.analisis.getAnalisis(anio, mes, 1),
      this.analisis.getAnalisis(anio, mes, 2),
    ]);

    const acumuladoPorCodigo = new Map<string, number>();
    let sinAsignar = 0;
    for (const quincena of [q1, q2]) {
      for (const c of quincena.contratos) {
        if (c.contratoId === null) {
          sinAsignar += c.monto;
          continue;
        }
        acumuladoPorCodigo.set(c.codigo, (acumuladoPorCodigo.get(c.codigo) ?? 0) + c.monto);
      }
    }

    const bruto: IncidenciaMesBruto = {
      contratos: [...acumuladoPorCodigo.entries()].map(([codigo, monto]) => ({
        codigo,
        montoMo: redondear2(monto),
      })),
      sinAsignar: redondear2(sinAsignar),
    };

    if (cerrado) this.cacheMes.set(clave, bruto);
    return bruto;
  }

  private aplicarVisibilidad(mes: IncidenciaMesBruto, cert: CertClaim): IncidenciaMo {
    if (cert.nivel === 'carga') {
      return { contratos: mes.contratos.filter((c) => cert.ks.includes(c.codigo)), sinAsignar: null };
    }
    return { contratos: mes.contratos, sinAsignar: mes.sinAsignar };
  }

  async obtenerIncidencia(anio: number, mes: number, cert: CertClaim | null): Promise<IncidenciaMo> {
    if (!cert || (cert.nivel === 'carga' && !cert.inc)) {
      throw new ForbiddenException('No tenés acceso a la incidencia de mano de obra.');
    }

    const bruto = await this.calcularMes(anio, mes);
    return this.aplicarVisibilidad(bruto, cert);
  }

  async obtenerSerie(
    anio: number,
    mes: number,
    meses: number,
    cert: CertClaim | null,
  ): Promise<IncidenciaMesSerie[]> {
    if (!cert || (cert.nivel === 'carga' && !cert.inc)) {
      throw new ForbiddenException('No tenés acceso a la incidencia de mano de obra.');
    }

    const n = Math.min(Math.max(meses, 1), 24);
    const out: IncidenciaMesSerie[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(anio, mes - 1 - i, 1); // JS normaliza el cruce de año
      const a = d.getFullYear();
      const m = d.getMonth() + 1;
      const bruto = await this.calcularMes(a, m);
      out.push({ anio: a, mes: m, ...this.aplicarVisibilidad(bruto, cert) });
    }
    return out;
  }
}
