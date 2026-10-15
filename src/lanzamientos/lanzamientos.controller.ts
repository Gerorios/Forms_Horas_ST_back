import { Body, Controller, Get, Param, Patch, Request, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { LanzamientosService } from './lanzamientos.service';

export class ActualizarLanzamientoDto {
  @IsOptional() @IsIn(['interno', 'todos'])
  estado?: 'interno' | 'todos';

  /** Nombres de rol habilitados mientras está interno (reemplaza la lista). */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  roles?: string[];

  /** CUIL de personas habilitadas mientras está interno (reemplaza la lista). */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true })
  usuarios?: string[];
}

/** Administración → Lanzamientos: solo Admin (ADR-028). */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
@Controller('admin/lanzamientos')
export class LanzamientosController {
  constructor(private lanzamientos: LanzamientosService) {}

  @Get()
  listar() {
    return this.lanzamientos.listar();
  }

  @Patch(':modulo')
  actualizar(@Param('modulo') modulo: string, @Body() dto: ActualizarLanzamientoDto, @Request() req) {
    return this.lanzamientos.actualizar(modulo, dto, req.user.cuil);
  }
}
