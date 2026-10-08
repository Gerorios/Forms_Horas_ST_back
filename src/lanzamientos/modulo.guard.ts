import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LanzamientosService } from './lanzamientos.service';

export const MODULO_KEY = 'modulo';

/** Marca un controlador (o un método) como parte de un módulo con
 * lanzamiento (ADR-028). Va junto a `ModuloGuard`, después de JwtAuthGuard. */
export const Modulo = (clave: string) => SetMetadata(MODULO_KEY, clave);

/**
 * Bloquea en el Backend a quien no ve el módulo (estado interno y fuera del
 * piloto): esconder el menú no alcanza, la ruta se puede escribir a mano.
 */
@Injectable()
export class ModuloGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private lanzamientos: LanzamientosService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const modulo = this.reflector.getAllAndOverride<string>(MODULO_KEY, [context.getHandler(), context.getClass()]);
    if (!modulo) return true;
    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;
    if (await this.lanzamientos.puedeVer(modulo, { cuil: user.cuil, rol: user.rol })) return true;
    throw new ForbiddenException('Este módulo todavía está en prueba interna');
  }
}
