import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import { CalculoService } from './calculo.service';
import { PanelService } from './panel.service';
import { AnalisisService } from './analisis.service';
import {
  CreateCategoriaUocraDto,
  UpdateCategoriaUocraDto,
  CategoriasPeriodoDto,
  BonosPeriodoDto,
  NovedadesPlusPeriodoDto,
  RangosKmPeriodoDto,
  UpsertPerfilLiquidacionDto,
  UpsertPerfilesMasivoDto,
  GuardarSueldosMensualizadosDto,
  CargarKmPorTantosDto,
  CargarPlusIndividualDto,
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
    private analisis: AnalisisService,
  ) {}

  // El LISTADO lo necesita el Liquidador (Perfiles asigna categoría, Tarifas
  // las muestra); el ABM (crear/editar/activar) es solo Admin — la gestión
  // del catálogo se movió al panel de Admin (decisión 2026-08-12).
  @Get('categorias-uocra')
  getCategorias() {
    return this.service.getCategorias();
  }

  @Post('categorias-uocra')
  @Roles('Admin')
  createCategoria(@Body() dto: CreateCategoriaUocraDto) {
    return this.service.createCategoria(dto);
  }

  @Post('categorias-uocra/:id/activo')
  @Roles('Admin')
  toggleCategoria(@Param('id', ParseIntPipe) id: number, @Body() dto: ToggleActivoDto) {
    return this.service.toggleCategoria(id, dto.activo);
  }

  @Post('categorias-uocra/:id')
  @Roles('Admin')
  updateCategoria(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoriaUocraDto) {
    return this.service.updateCategoria(id, dto);
  }

  // ---- Precios por período: cada sección se lee/guarda de forma
  // independiente, por período exacto — sin relleno de huecos ni bloqueo
  // entre meses (ver ADR-018, reemplaza la ronda mensual única de ADR-010) ----

  @Get('tarifas/categorias/:anio/:mes')
  getCategoriasPeriodo(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.service.getCategoriasPeriodo(anio, mes);
  }

  @Put('tarifas/categorias/:anio/:mes')
  guardarCategoriasPeriodo(
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
    @Body() dto: CategoriasPeriodoDto,
    @Request() req,
  ) {
    return this.service.guardarCategoriasPeriodo(anio, mes, dto, req.user.cuil);
  }

  @Get('tarifas/bonos/:anio/:mes')
  getBonosPeriodo(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.service.getBonosPeriodo(anio, mes);
  }

  @Put('tarifas/bonos/:anio/:mes')
  guardarBonosPeriodo(
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
    @Body() dto: BonosPeriodoDto,
    @Request() req,
  ) {
    return this.service.guardarBonosPeriodo(anio, mes, dto, req.user.cuil);
  }

  @Get('tarifas/novedades-plus/:anio/:mes')
  getNovedadesPlusPeriodo(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.service.getNovedadesPlusPeriodo(anio, mes);
  }

  @Put('tarifas/novedades-plus/:anio/:mes')
  guardarNovedadesPlusPeriodo(
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
    @Body() dto: NovedadesPlusPeriodoDto,
    @Request() req,
  ) {
    return this.service.guardarNovedadesPlusPeriodo(anio, mes, dto, req.user.cuil);
  }

  @Get('tarifas/rangos-km/:anio/:mes')
  getRangosKmPeriodo(@Param('anio', ParseIntPipe) anio: number, @Param('mes', ParseIntPipe) mes: number) {
    return this.service.getRangosKmPeriodo(anio, mes);
  }

  @Put('tarifas/rangos-km/:anio/:mes')
  guardarRangosKmPeriodo(
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
    @Body() dto: RangosKmPeriodoDto,
    @Request() req,
  ) {
    return this.service.guardarRangosKmPeriodo(anio, mes, dto, req.user.cuil);
  }

  // ---- Sueldos mensualizados: sección propia dentro de Tarifas, mismo
  // patrón de período independiente — ver ADR-018 (reemplaza ADR-016) ----

  @Get('tarifas/sueldos-mensualizados')
  getSueldosMensualizados(@Query('anio', ParseIntPipe) anio: number, @Query('mes', ParseIntPipe) mes: number) {
    return this.service.getSueldosMensualizados(anio, mes);
  }

  @Put('tarifas/sueldos-mensualizados')
  guardarSueldosMensualizados(@Body() dto: GuardarSueldosMensualizadosDto, @Request() req) {
    return this.service.guardarSueldosMensualizados(dto, req.user.cuil);
  }

  @Get('perfiles')
  getPerfiles() {
    return this.service.getPerfiles();
  }

  // Contratos activos para el selector de imputación en Perfiles: el
  // Liquidador no accede a /admin/contratos ni /registros-horas/mis-contratos
  // (addendum plan 2026-08-12).
  @Get('contratos')
  getContratos() {
    return this.service.getContratos();
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

  // ---- Datos variables por quincena (por tantos) — ver ADR-011 ----

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

  // ---- Plus individual (ver ADR-018): monto puntual por empleado/quincena,
  // con motivo — independiente de categoría, no versionado por período. ----

  @Get('plus-individual')
  getPlusIndividual(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('quincena', ParseIntPipe) quincena: number,
  ) {
    return this.service.getPlusIndividual(anio, mes, quincena);
  }

  @Post('plus-individual')
  cargarPlusIndividual(@Body() dto: CargarPlusIndividualDto, @Request() req) {
    return this.service.cargarPlusIndividual(dto, req.user.cuil);
  }

  @Delete('plus-individual/:id')
  eliminarPlusIndividual(@Param('id', ParseIntPipe) id: number) {
    return this.service.eliminarPlusIndividual(id);
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

  // ---- Análisis de la quincena (ver plan 2026-08-12). Roles heredados del
  // controller (Admin, Liquidador) — sin decorador propio, decisión del plan. ----

  @Get('analisis')
  getAnalisis(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('quincena', ParseIntPipe) quincena: number,
  ) {
    return this.analisis.getAnalisis(anio, mes, quincena);
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
