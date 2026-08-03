import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CreateContratoDto, UpdateContratoDto } from './dto/contrato.dto';
import { CreateTareaDto, UpdateTareaDto, CreateMovilDto, UpdateMovilDto, CrearMovilesMasivoDto, CreateProvinciaDto, UpdateProvinciaDto, CreateTipoNovedadDto, UpdateTipoNovedadDto, ToggleActivoDto } from './dto/catalogo.dto';
import { CreateUsuarioDto, UpdateUsuarioDto, CrearUsuariosMasivoDto } from './dto/usuario.dto';
import {
  CreateEstacionServicioDto,
  UpdateEstacionServicioDto,
  CreateTipoCombustibleDto,
  UpdateTipoCombustibleDto,
  ToggleActivoCombustibleDto,
} from './dto/catalogo-combustible.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
@Controller('admin')
export class AdminController {
  constructor(private service: AdminService) {}

  @Get('roles')
  getRoles() { return this.service.getRoles(); }

  @Get('contratos')
  getContratos() { return this.service.getContratos(); }

  @Post('contratos')
  createContrato(@Body() dto: CreateContratoDto) { return this.service.createContrato(dto); }

  @Patch('contratos/:id')
  updateContrato(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateContratoDto) {
    return this.service.updateContrato(id, dto);
  }

  @Get('tareas')
  getTareas(@Query('contratoId', new ParseIntPipe({ optional: true })) contratoId?: number) {
    return this.service.getTareas(contratoId);
  }

  @Post('tareas')
  createTarea(@Body() dto: CreateTareaDto) { return this.service.createTarea(dto); }

  @Patch('tareas/:id/activo')
  toggleTarea(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoDto) {
    return this.service.toggleTarea(id, dto);
  }

  @Patch('tareas/:id')
  updateTarea(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTareaDto) {
    return this.service.updateTarea(id, dto);
  }

  @Get('moviles')
  getMoviles() { return this.service.getMoviles(); }

  @Post('moviles')
  createMovil(@Body() dto: CreateMovilDto) { return this.service.createMovil(dto); }

  @Post('moviles/masivo')
  createMovilesMasivo(@Body() dto: CrearMovilesMasivoDto) {
    return this.service.createMovilesMasivo(dto.identificadores);
  }

  @Patch('moviles/:id/activo')
  toggleMovil(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoDto) {
    return this.service.toggleMovil(id, dto);
  }

  @Patch('moviles/:id')
  updateMovil(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMovilDto) {
    return this.service.updateMovil(id, dto);
  }

  @Get('provincias')
  getProvincias() { return this.service.getProvincias(); }

  @Post('provincias')
  createProvincia(@Body() dto: CreateProvinciaDto) { return this.service.createProvincia(dto); }

  @Patch('provincias/:id')
  updateProvincia(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProvinciaDto) {
    return this.service.updateProvincia(id, dto);
  }

  // Liquidador necesita leer el catálogo para asignar montos a los tipos con
  // generaPlus (ver ADR-009) — el resto de /admin sigue siendo solo Admin.
  @Roles('Admin', 'Liquidador')
  @Get('tipos-novedad')
  getTiposNovedad() { return this.service.getTiposNovedad(); }

  @Post('tipos-novedad')
  createTipoNovedad(@Body() dto: CreateTipoNovedadDto) { return this.service.createTipoNovedad(dto); }

  @Patch('tipos-novedad/:id/activo')
  toggleTipoNovedad(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoDto) {
    return this.service.toggleTipoNovedad(id, dto);
  }

  @Patch('tipos-novedad/:id')
  updateTipoNovedad(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTipoNovedadDto) {
    return this.service.updateTipoNovedad(id, dto);
  }

  @Get('usuarios')
  getUsuarios() { return this.service.getUsuarios(); }

  @Post('usuarios')
  createUsuario(@Body() dto: CreateUsuarioDto) { return this.service.createUsuario(dto); }

  @Patch('usuarios/:cuil')
  updateUsuario(@Param('cuil') cuil: string, @Body() dto: UpdateUsuarioDto) {
    return this.service.updateUsuario(cuil, dto);
  }

  @Post('usuarios/:cuil/resetear-password')
  resetearPassword(@Param('cuil') cuil: string) {
    return this.service.resetearPassword(cuil);
  }

  @Post('usuarios/masivo')
  createUsuariosMasivo(@Body() dto: CrearUsuariosMasivoDto) {
    return this.service.createUsuariosMasivo(dto.cuils);
  }

  @Get('estaciones-servicio')
  getEstacionesServicio() { return this.service.getEstacionesServicio(); }

  @Post('estaciones-servicio')
  crearEstacionServicio(@Body() dto: CreateEstacionServicioDto) { return this.service.crearEstacionServicio(dto); }

  @Patch('estaciones-servicio/:id')
  actualizarEstacionServicio(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEstacionServicioDto) {
    return this.service.actualizarEstacionServicio(id, dto);
  }

  @Patch('estaciones-servicio/:id/activo')
  toggleEstacionServicio(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoCombustibleDto) {
    return this.service.toggleEstacionServicio(id, dto.activo);
  }

  @Get('tipos-combustible')
  getTiposCombustible() { return this.service.getTiposCombustible(); }

  @Post('tipos-combustible')
  crearTipoCombustible(@Body() dto: CreateTipoCombustibleDto) { return this.service.crearTipoCombustible(dto); }

  @Patch('tipos-combustible/:id')
  actualizarTipoCombustible(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTipoCombustibleDto) {
    return this.service.actualizarTipoCombustible(id, dto);
  }

  @Patch('tipos-combustible/:id/activo')
  toggleTipoCombustible(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoCombustibleDto) {
    return this.service.toggleTipoCombustible(id, dto.activo);
  }
}
