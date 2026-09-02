import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccesosService, CertClaim } from '../accesos.service';

/**
 * Historial + deshacer de cargas de certificaciones, port de
 * app/routers/certificaciones.py (`GET /historial`) y app/routers/admin.py
 * (`DELETE /admin/cargas/{log_id}`) del portal. Ver
 * docs/superpowers/specs/2026-09-02-inventario-carga-portal.md §1 y el
 * brief de esta task.
 *
 * DECISIÓN — identidad del usuario en el filtro de "propias" (nivel
 * `carga`): `sth_cert_cargas_log.usuario_id` SIEMPRE vale 0 para logins de
 * Horas (mismo bug B1 del portal, documentado en CargaService — el claim
 * JWT no trae un id numérico de usuario, solo `cuil`), así que no sirve
 * para filtrar. La columna que SÍ identifica quién cargó es
 * `usuario_nombre` (la escribe CargaService.confirmar con el nombre
 * resuelto del cuil, vía `AccesosService.resolverNombre`). Este service
 * filtra "propias" comparando `usuario_nombre` contra el nombre resuelto
 * del cuil del pedido, con el MISMO criterio de resolución (snuempleados →
 * nombreFueraNomina → email), así ambos lados de la comparación coinciden
 * siempre. Limitación conocida y aceptada: si dos personas distintas
 * resuelven al mismo nombre para mostrar (colisión de `apellido_nombre` en
 * snuempleados, caso raro pero posible), un usuario nivel `carga` vería
 * también las cargas del otro. Arreglarlo bien requiere agregar una
 * columna `cuil` a `sth_cert_cargas_log` (DDL en las dos bases, fuera de
 * alcance de esta task) — queda propuesto para una próxima etapa si se
 * vuelve un problema real.
 */

const NIVELES_HISTORIAL = new Set(['admin', 'lectura', 'carga']);
const NIVELES_GLOBAL = new Set(['admin', 'lectura']);

export interface FilaHistorial {
  id: number;
  usuario_nombre: string;
  archivo_nombre: string;
  contrato: string | null;
  periodo: string | null;
  filas_cargadas: number;
  filas_error: number;
  estado: string;
  cargado_en: string;
}

@Injectable()
export class HistorialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accesos: AccesosService,
  ) {}

  async listar(cert: CertClaim | null, cuil: string): Promise<FilaHistorial[]> {
    if (!cert || !NIVELES_HISTORIAL.has(cert.nivel)) {
      throw new ForbiddenException('No tenés acceso al historial de cargas.');
    }

    if (NIVELES_GLOBAL.has(cert.nivel)) {
      return this.consultar(Prisma.sql`1 = 1`, 100);
    }

    const nombre = await this.accesos.resolverNombre(cuil);
    return this.consultar(Prisma.sql`usuario_nombre = ${nombre}`, 50);
  }

  private async consultar(where: Prisma.Sql, limite: number): Promise<FilaHistorial[]> {
    return this.prisma.$queryRaw<FilaHistorial[]>(Prisma.sql`
      SELECT id, usuario_nombre, archivo_nombre, contrato, periodo,
             filas_cargadas, filas_error, estado,
             DATE_FORMAT(cargado_en, '%Y-%m-%d %H:%i') AS cargado_en
      FROM sth_cert_cargas_log
      WHERE ${where}
      ORDER BY cargado_en DESC
      LIMIT ${limite}
    `);
  }

  /**
   * Deshacer carga (solo admin): borra las filas de la fact table que
   * entraron con esa carga (por archivo + período, sin FK — misma
   * limitación B13 del portal) y el log, en UNA transacción.
   */
  async deshacer(logId: number, cert: CertClaim | null): Promise<{ mensaje: string; filasBorradas: number }> {
    if (!cert || cert.nivel !== 'admin') {
      throw new ForbiddenException('Solo el nivel admin puede deshacer una carga.');
    }

    const log = await this.prisma.certCargaLog.findUnique({ where: { id: logId } });
    if (!log) throw new NotFoundException('La carga no existe.');

    const deleteFactSql = Prisma.sql`
      DELETE FROM sth_cert_certificaciones
      WHERE archivo_origen = ${log.archivoNombre}
        AND DATE_FORMAT(fecha, '%Y-%m') = ${log.periodo}
    `;

    const [filasBorradas] = await this.prisma.$transaction([
      this.prisma.$executeRaw(deleteFactSql),
      this.prisma.certCargaLog.delete({ where: { id: logId } }),
    ]);

    return { mensaje: 'Carga deshecha', filasBorradas: Number(filasBorradas) };
  }
}
