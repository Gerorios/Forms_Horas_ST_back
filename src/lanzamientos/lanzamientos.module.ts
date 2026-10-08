import { Module } from '@nestjs/common';
import { LanzamientosService } from './lanzamientos.service';
import { LanzamientosController } from './lanzamientos.controller';
import { ModuloGuard } from './modulo.guard';

/** Lanzamiento de módulos (ADR-028). Lo importan el perfil (AuthModule) y
 * cada módulo que use `@Modulo(...)` + `ModuloGuard`. */
@Module({
  providers: [LanzamientosService, ModuloGuard],
  controllers: [LanzamientosController],
  exports: [LanzamientosService, ModuloGuard],
})
export class LanzamientosModule {}
