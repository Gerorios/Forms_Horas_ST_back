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
});
