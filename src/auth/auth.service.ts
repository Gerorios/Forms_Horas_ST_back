import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { AccesosService } from '../certificaciones/accesos.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private accesosService: AccesosService,
  ) {}

  // El acceso al módulo de certificaciones se degrada (cert: null) si
  // obtenerAcceso falla (p.ej. migración de sth_certificaciones_* aún no
  // aplicada) — el login/perfil de Horas jamás debe romperse por esto.
  private async resolverCert(cuil: string) {
    try {
      return await this.accesosService.obtenerAcceso(cuil);
    } catch (error) {
      this.logger.warn(
        `No se pudo resolver el acceso a certificaciones de ${cuil}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

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

    const cert = await this.resolverCert(usuario.cuil);
    const payload = {
      cuil: usuario.cuil,
      email: usuario.email,
      rol: usuario.rol.nombre,
      cert,
    };

    return { access_token: this.jwt.sign(payload) };
  }

  async perfil(cuil: string) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { cuil },
      select: {
        cuil: true,
        email: true,
        activo: true,
        nombreFueraNomina: true,
        puedeCargarKmPorTantos: true,
        rol: { select: { nombre: true } },
        contratosHabilitados: {
          select: { contrato: { select: { id: true, codigo: true, nombre: true } } },
        },
        tiposNovedadHabilitados: {
          select: { tipoNovedad: { select: { id: true, nombre: true } } },
        },
      },
    });
    if (!usuario) return null;

    // snuempleados no tiene FK física (se sincroniza desde otro sistema, ver
    // ADR-008): un usuario fuera de nómina no tiene fila ahí.
    const empleado = await this.prisma.snuempleados.findUnique({
      where: { cuil },
      select: { apellido_nombre: true, legajo: true, cargo: true },
    });

    const cert = await this.resolverCert(cuil);

    const { nombreFueraNomina, ...resto } = usuario;
    return {
      ...resto,
      cert,
      empleado: empleado ?? {
        apellido_nombre: nombreFueraNomina ?? '',
        legajo: null,
        cargo: null,
      },
    };
  }
}
