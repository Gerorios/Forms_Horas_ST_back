import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: dto.email },
      include: { rol: true },
    });

    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValida = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!passwordValida) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const payload = {
      cuil: usuario.cuil,
      email: usuario.email,
      rol: usuario.rol.nombre,
    };

    return { access_token: this.jwt.sign(payload) };
  }

  async perfil(cuil: string) {
    return this.prisma.usuario.findUnique({
      where: { cuil },
      select: {
        cuil: true,
        email: true,
        activo: true,
        rol: { select: { nombre: true } },
        empleado: { select: { apellido_nombre: true, legajo: true, cargo: true } },
        contratosHabilitados: {
          select: { contrato: { select: { id: true, codigo: true, nombre: true } } },
        },
      },
    });
  }
}
