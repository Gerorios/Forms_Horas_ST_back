import { ForbiddenException, Injectable } from '@nestjs/common';
import { AnalisisService } from '../liquidacion/analisis.service';
import { CertClaim } from './accesos.service';

export interface IncidenciaMo {
  contratos: { codigo: string; montoMo: number }[];
  sinAsignar: number | null;
}

/**
 * Incidencia de mano de obra por contrato (K), consumida por el módulo de
 * certificaciones. Suma quincena 1 + quincena 2 del corte por contrato que
 * ya produce AnalisisService (prorrateo por horas aprobadas). Visibilidad
 * por claim `cert` (Task 3): la autorización vive acá, no en el controller.
 */
@Injectable()
export class IncidenciaService {
  constructor(private readonly analisis: AnalisisService) {}

  async obtenerIncidencia(anio: number, mes: number, cert: CertClaim | null): Promise<IncidenciaMo> {
    if (!cert || (cert.nivel === 'carga' && !cert.inc)) {
      throw new ForbiddenException('No tenés acceso a la incidencia de mano de obra.');
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

    let contratos = [...acumuladoPorCodigo.entries()].map(([codigo, montoMo]) => ({ codigo, montoMo }));

    if (cert.nivel === 'carga') {
      contratos = contratos.filter((c) => cert.ks.includes(c.codigo));
      return { contratos, sinAsignar: null };
    }

    return { contratos, sinAsignar };
  }
}
