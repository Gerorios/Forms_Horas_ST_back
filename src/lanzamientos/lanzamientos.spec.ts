import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LanzamientosService, ve } from './lanzamientos.service';
import { ModuloGuard } from './modulo.guard';

/** Lanzamiento de módulos (ADR-028): interno = Admin + piloto; para todos = como siempre. */
describe('lanzamiento de módulos', () => {
  const interno = { estado: 'interno' as const, roles: ['HyS'], cuils: ['20333333333'] };
  const op = { cuil: '20111111111', rol: 'Operario' };

  describe('ve', () => {
    it('un módulo no registrado se ve como siempre', () => {
      expect(ve(null, op)).toBe(true);
    });

    it('interno: lo ven Admin, los roles y las personas del piloto, nadie más', () => {
      expect(ve(interno, { cuil: '1', rol: 'Admin' })).toBe(true);
      expect(ve(interno, { cuil: '2', rol: 'HyS' })).toBe(true);
      expect(ve(interno, { cuil: '20333333333', rol: 'Supervisor' })).toBe(true);
      expect(ve(interno, op)).toBe(false);
      expect(ve(interno, { cuil: '4', rol: 'Supervisor' })).toBe(false);
    });

    it('para todos: lo ve cualquiera', () => {
      expect(ve({ ...interno, estado: 'todos' }, op)).toBe(true);
    });
  });

  describe('visibles (perfil)', () => {
    it('devuelve un booleano por módulo registrado', async () => {
      const prisma: any = {
        moduloLanzamiento: {
          findMany: jest.fn().mockResolvedValue([
            { modulo: 'seguridad', nombre: 'S', estado: 'interno', roles: [{ rol: { nombre: 'HyS' } }], usuarios: [] },
            { modulo: 'flota', nombre: 'F', estado: 'todos', roles: [], usuarios: [] },
          ]),
        },
      };
      const s = new LanzamientosService(prisma);
      expect(await s.visibles(op)).toEqual({ seguridad: false, flota: true });
      expect(await s.visibles({ cuil: 'x', rol: 'HyS' })).toEqual({ seguridad: true, flota: true });
    });
  });

  describe('ModuloGuard', () => {
    function contexto(user: any) {
      return {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      } as any;
    }
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('seguridad') } as unknown as Reflector;

    it('deja pasar a quien ve el módulo', async () => {
      const guard = new ModuloGuard(reflector, { puedeVer: jest.fn().mockResolvedValue(true) } as any);
      await expect(guard.canActivate(contexto(op))).resolves.toBe(true);
    });

    it('bloquea con 403 a quien no está en el piloto, aunque escriba la ruta a mano', async () => {
      const guard = new ModuloGuard(reflector, { puedeVer: jest.fn().mockResolvedValue(false) } as any);
      await expect(guard.canActivate(contexto(op))).rejects.toThrow(ForbiddenException);
    });

    it('un controlador sin @Modulo no se toca', async () => {
      const sinModulo = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
      const puedeVer = jest.fn();
      const guard = new ModuloGuard(sinModulo, { puedeVer } as any);
      await expect(guard.canActivate(contexto(op))).resolves.toBe(true);
      expect(puedeVer).not.toHaveBeenCalled();
    });
  });
});
