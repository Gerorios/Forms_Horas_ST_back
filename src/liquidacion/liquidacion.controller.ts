import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import { CalculoService } from './calculo.service';
import { PanelService } from './panel.service';
import {
  CreateCategoriaUocraDto,
  UpdateCategoriaUocraDto,
  CargarRondaTarifasDto,
  EditarRondaTarifasDto,
  UpsertPerfilLiquidacionDto,
  UpsertPerfilesMasivoDto,
  CargarMontosMensualizadosDto,
  CargarKmPorTantosDto,
} from './dto/liquidacion.dto';
import { ToggleActivoDto } from '../admin/dto/catalogo.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'Liquidador')
@Controller('liquidacion')
export class LiquidacionController {
  constructor(
    private service: LiquidacionService,
    private calculo: CalculoService,
    private panel: PanelService,
  ) {}

  @Get('categorias-uocra')
  getCategorias() {
    return this.service.getCategorias();
  }

  @Post('categorias-uocra')
  createCategoria(@Body() dto: CreateCategoriaUocraDto) {
    return this.service.createCategoria(dto);
  }

  @Post('categorias-uocra/:id/activo')
  toggleCategoria(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoDto) {
    return this.service.toggleCategoria(id, dto.activo);
  }

  @Post('categorias-uocra/:id')
  updateCategoria(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoriaUocraDto) {
    return this.service.updateCategoria(id, dto);
  }

  // ---- Ronda mensual de tarifas (ver ADR-010) ----

  @Get('tarifas/estado')
  getEstadoTarifas() {
    return this.service.getEstadoTarifas();
  }

  @Post('tarifas/ronda')
  cargarRondaTarifas(@Body() dto: CargarRondaTarifasDto) {
    return this.service.cargarRondaTarifas(dto);
  }

  @Get('tarifas/ronda/:anio/:mes')
  getRondaTarifas(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.service.getRondaTarifas(anio, mes);
  }

  @Put('tarifas/ronda/:anio/:mes')
  editarRondaTarifas(
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
    @Body() dto: EditarRondaTarifasDto,
    @Request() req,
  ) {
    return this.service.editarRondaTarifas(anio, mes, dto, req.user.cuil);
  }

  @Get('perfiles')
  getPerfiles() {
    return this.service.getPerfiles();
  }

  @Post('perfiles/masivo')
  upsertPerfilesMasivo(@Body() dto: UpsertPerfilesMasivoDto) {
    const { cuils, ...resto } = dto;
    return this.service.upsertPerfilesMasivo(cuils, resto);
  }

  @Post('perfiles/:cuil')
  upsertPerfil(@Param('cuil') cuil: string, @Body() dto: UpsertPerfilLiquidacionDto) {
    return this.service.upsertPerfil(cuil, dto);
  }

  @Delete('perfiles/:cuil')
  deletePerfil(@Param('cuil') cuil: string) {
    return this.service.deletePerfil(cuil);
  }

  // ---- Datos variables por quincena (mensualizado / por tantos) — ver ADR-011 ----

  @Get('quincena/montos-mensualizados')
  getMontosMensualizados(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('quincena', ParseIntPipe) quincena: number,
  ) {
    return this.service.getMontosMensualizados(anio, mes, quincena);
  }

  @Post('quincena/montos-mensualizados')
  cargarMontosMensualizados(@Body() dto: CargarMontosMensualizadosDto) {
    return this.service.cargarMontosMensualizados(dto);
  }

  // Lectura: Admin/Liquidador (panel de liquidación) + JefeContrato (para
  // prellenar su propia pantalla de carga). Ver ADR-014.
  @Roles('Admin', 'Liquidador', 'JefeContrato')
  @Get('quincena/km-por-tantos')
  getKmPorTantos(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('quincena', ParseIntPipe) quincena: number,
  ) {
    return this.service.getKmPorTantos(anio, mes, quincena);
  }

  // Escritura: Admin y JefeContrato habilitado (Usuario.puedeCargarKmPorTantos).
  // El Liquidador deja de poder cargar este dato — ver ADR-014.
  @Roles('Admin', 'JefeContrato')
  @Post('quincena/km-por-tantos')
  cargarKmPorTantos(@Body() dto: CargarKmPorTantosDto, @Request() req) {
    return this.service.cargarKmPorTantos(dto, req.user);
  }

  // ---- Cálculo de la quincena ----

  @Get('quincena/calculo')
  calcularQuincena(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('quincena', ParseIntPipe) quincena: number,
  ) {
    return this.calculo.calcularQuincena(anio, mes, quincena);
  }

  @Get('quincena/alertas')
  getAlertasQuincena(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('quincena', ParseIntPipe) quincena: number,
  ) {
    return this.calculo.getAlertasQuincena(anio, mes, quincena);
  }

  // ---- Panel de quincenas y detalle con drill-down (ver plan 2026-08-04) ----

  @Get('quincenas')
  getQuincenas() {
    return this.panel.getQuincenas();
  }

  @Get('quincena/detalle')
  getDetalleQuincena(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('quincena', ParseIntPipe) quincena: number,
  ) {
    return this.panel.getDetalleQuincena(anio, mes, quincena);
  }
}
