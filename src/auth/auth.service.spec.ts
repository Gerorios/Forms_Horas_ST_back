import { AuthService } from './auth.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService.login', () => {
  const usuarioBase = {
    cuil: '20-11111111-1',
    email: 'user@test.com',
    passwordHash: 'hash',
    activo: true,
    rol: { nombre: 'Carga' },
  };

  function buildService(accesoResuelto: any) {
    const prisma = {
      usuario: { findUnique: jest.fn().mockResolvedValue(usuarioBase) },
    } as any;
    const jwt = { sign: jest.fn().mockReturnValue('token') } as any;
    const accesos = { obtenerAcceso: jest.fn().mockResolvedValue(accesoResuelto) } as any;
    const service = new AuthService(prisma, jwt, accesos);
    return { service, prisma, jwt, accesos };
  }

  beforeEach(() => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  it('incluye cert en el payload firmado cuando el usuario tiene acceso', async () => {
    const { service, jwt, accesos } = buildService({ nivel: 'carga', ks: ['K6'], inc: false });

    await service.login({ email: usuarioBase.email, password: 'x' } as any);

    expect(accesos.obtenerAcceso).toHaveBeenCalledWith(usuarioBase.cuil);
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ cert: { nivel: 'carga', ks: ['K6'], inc: false } }),
    );
  });

  it('cert es null cuando el usuario no tiene acceso al módulo de certificaciones', async () => {
    const { service, jwt } = buildService(null);

    await service.login({ email: usuarioBase.email, password: 'x' } as any);

    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ cert: null }));
  });

  it('cert es null y el login no falla si obtenerAcceso rechaza (p.ej. migración no aplicada)', async () => {
    const prisma = {
      usuario: { findUnique: jest.fn().mockResolvedValue(usuarioBase) },
    } as any;
    const jwt = { sign: jest.fn().mockReturnValue('token') } as any;
    const accesos = {
      obtenerAcceso: jest.fn().mockRejectedValue(new Error('relation "sth_certificaciones_acceso" does not exist')),
    } as any;
    const service = new AuthService(prisma, jwt, accesos);

    await expect(
      service.login({ email: usuarioBase.email, password: 'x' } as any),
    ).resolves.toEqual({ access_token: 'token' });

    expect(jwt.sign).toHaveBeenCalledWith(expect.objectContaining({ cert: null }));
  });
});

describe('AuthService.perfil', () => {
  const usuarioPerfil = {
    cuil: '20-11111111-1',
    email: 'user@test.com',
    activo: true,
    nombreFueraNomina: null,
    puedeCargarKmPorTantos: false,
    rol: { nombre: 'Carga' },
    contratosHabilitados: [],
    tiposNovedadHabilitados: [],
  };

  function buildService(accesoResuelto: any) {
    const prisma = {
      usuario: { findUnique: jest.fn().mockResolvedValue(usuarioPerfil) },
      snuempleados: {
        findUnique: jest.fn().mockResolvedValue({ apellido_nombre: 'Test', legajo: 1, cargo: 'X' }),
      },
    } as any;
    const jwt = {} as any;
    const accesos = { obtenerAcceso: jest.fn().mockResolvedValue(accesoResuelto) } as any;
    const service = new AuthService(prisma, jwt, accesos);
    return { service, accesos };
  }

  it('incluye cert en la respuesta del perfil cuando el usuario tiene acceso', async () => {
    const { service } = buildService({ nivel: 'lectura', ks: [], inc: true });

    const resultado = await service.perfil(usuarioPerfil.cuil);

    expect(resultado).toEqual(
      expect.objectContaining({ cert: { nivel: 'lectura', ks: [], inc: true } }),
    );
  });
});
