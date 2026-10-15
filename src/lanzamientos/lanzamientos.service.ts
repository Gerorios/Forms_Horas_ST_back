import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Admin ve siempre todos los módulos, también los internos. */
export const ROL_ADMIN = 'Admin';

export interface UsuarioVisor {
  cuil: string;
  rol: string;
}

interface LanzamientoResuelto {
  estado: 'interno' | 'todos';
  roles: string[];
  cuils: string[];
}

/**
 * Regla de visibilidad de un módulo con lanzamiento (ADR-028). `null` = el
 * módulo no está registrado: se ve como siempre (decide solo el rol).
 */
export function ve(l: LanzamientoResuelto | null, u: UsuarioVisor): boolean {
  if (!l || l.estado === 'todos' || u.rol === ROL_ADMIN) return true;
  return l.roles.includes(u.rol) || l.cuils.includes(u.cuil);
}

const INCLUDE = {
  roles: { select: { rol: { select: { nombre: true } } } },
  usuarios: { select: { cuil: true } },
};

type Fila = {
  modulo: string;
  nombre: string;
  estado: 'interno' | 'todos';
  roles: { rol: { nombre: string } }[];
  usuarios: { cuil: string }[];
};

const resolver = (f: Fila): LanzamientoResuelto => ({
  estado: f.estado,
  roles: f.roles.map((r) => r.rol.nombre),
  cuils: f.usuarios.map((u) => u.cuil),
});

/** Lanzamiento de módulos: interno (piloto) o para todos. Lo maneja solo Admin. */
@Injectable()
export class LanzamientosService {
  constructor(private prisma: PrismaService) {}

  async puedeVer(modulo: string, u: UsuarioVisor): Promise<boolean> {
    const f = (await this.prisma.moduloLanzamiento.findUnique({ where: { modulo }, include: INCLUDE })) as Fila | null;
    return ve(f ? resolver(f) : null, u);
  }

  /** Qué módulos registrados ve esta persona: va en el perfil, para que el
   * menú, el inicio y las rutas sepan qué esconder. */
  async visibles(u: UsuarioVisor): Promise<Record<string, boolean>> {
    const filas = (await this.prisma.moduloLanzamiento.findMany({ include: INCLUDE })) as Fila[];
    return Object.fromEntries(filas.map((f) => [f.modulo, ve(resolver(f), u)]));
  }

  // ------------------------------------------------------------- Admin

  async listar() {
    const filas = await this.prisma.moduloLanzamiento.findMany({
      orderBy: { nombre: 'asc' },
      include: {
        roles: { select: { rol: { select: { nombre: true } } } },
        usuarios: { select: { cuil: true, usuario: { select: { email: true, nombreFueraNomina: true, rol: { select: { nombre: true } } } } } },
      },
    });
    const cuils = filas.flatMap((f) => f.usuarios.map((u) => u.cuil));
    const nomina = cuils.length
      ? await this.prisma.snuempleados.findMany({ where: { cuil: { in: cuils } }, select: { cuil: true, apellido_nombre: true } })
      : [];
    const nombres = new Map(nomina.map((e) => [e.cuil, e.apellido_nombre.trim()]));
    return filas.map((f) => ({
      modulo: f.modulo,
      nombre: f.nombre,
      estado: f.estado,
      actualizadoEn: f.updatedAt,
      roles: f.roles.map((r) => r.rol.nombre).sort(),
      usuarios: f.usuarios.map((u) => ({
        cuil: u.cuil,
        nombre: nombres.get(u.cuil) || u.usuario.nombreFueraNomina || u.usuario.email,
        rol: u.usuario.rol.nombre,
      })),
    }));
  }

  /** Cambia el estado y/o el piloto. `roles` y `usuarios` reemplazan la lista
   * entera (lo que no viene, no se toca). */
  async actualizar(
    modulo: string,
    cambios: { estado?: 'interno' | 'todos'; roles?: string[]; usuarios?: string[] },
    porCuil: string,
  ) {
    if (!(await this.prisma.moduloLanzamiento.findUnique({ where: { modulo } }))) {
      throw new NotFoundException('Módulo sin lanzamiento registrado');
    }
    const rolesIds = cambios.roles
      ? await this.prisma.rol.findMany({ where: { nombre: { in: cambios.roles } }, select: { id: true, nombre: true } })
      : null;
    if (rolesIds && rolesIds.length !== new Set(cambios.roles).size) throw new BadRequestException('Algún rol no existe');
    const usuarios = cambios.usuarios ? [...new Set(cambios.usuarios)] : null;
    if (usuarios?.length) {
      const existen = await this.prisma.usuario.count({ where: { cuil: { in: usuarios } } });
      if (existen !== usuarios.length) {
        throw new BadRequestException('Alguna persona no tiene usuario en el sistema: primero hay que darla de alta');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.moduloLanzamiento.update({
        where: { modulo },
        data: { ...(cambios.estado ? { estado: cambios.estado } : {}), actualizadoPorCuil: porCuil },
      });
      if (rolesIds) {
        await tx.moduloPilotoRol.deleteMany({ where: { modulo } });
        if (rolesIds.length) await tx.moduloPilotoRol.createMany({ data: rolesIds.map((r) => ({ modulo, rolId: r.id })) });
      }
      if (usuarios) {
        await tx.moduloPilotoUsuario.deleteMany({ where: { modulo } });
        if (usuarios.length) await tx.moduloPilotoUsuario.createMany({ data: usuarios.map((cuil) => ({ modulo, cuil })) });
      }
    });
    return this.listar();
  }
}
