import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import {
  CreateCategoriaUocraDto,
  UpdateCategoriaUocraDto,
  CreateTarifaCategoriaDto,
  CreateMontoNovedadPlusDto,
  CreateRangoKmDto,
  UpsertPerfilLiquidacionDto,
} from './dto/liquidacion.dto';
import { ToggleActivoDto } from '../admin/dto/catalogo.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'Liquidador')
@Controller('liquidacion')
export class LiquidacionController {
  constructor(private service: LiquidacionService) {}

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

  @Get('tarifas-categoria')
  getTarifas(@Query('categoriaUocraId', new ParseIntPipe({ optional: true })) categoriaUocraId?: number) {
    return this.service.getTarifas(categoriaUocraId);
  }

  @Post('tarifas-categoria')
  createTarifa(@Body() dto: CreateTarifaCategoriaDto) {
    return this.service.createTarifa(dto);
  }

  @Get('montos-novedad-plus')
  getMontosNovedadPlus(@Query('tipoNovedadId', new ParseIntPipe({ optional: true })) tipoNovedadId?: number) {
    return this.service.getMontosNovedadPlus(tipoNovedadId);
  }

  @Post('montos-novedad-plus')
  createMontoNovedadPlus(@Body() dto: CreateMontoNovedadPlusDto) {
    return this.service.createMontoNovedadPlus(dto);
  }

  @Get('rangos-km')
  getRangosKm() {
    return this.service.getRangosKm();
  }

  @Post('rangos-km')
  createRangoKm(@Body() dto: CreateRangoKmDto) {
    return this.service.createRangoKm(dto);
  }

  @Get('perfiles')
  getPerfiles() {
    return this.service.getPerfiles();
  }

  @Post('perfiles/:cuil')
  upsertPerfil(@Param('cuil') cuil: string, @Body() dto: UpsertPerfilLiquidacionDto) {
    return this.service.upsertPerfil(cuil, dto);
  }

  @Delete('perfiles/:cuil')
  deletePerfil(@Param('cuil') cuil: string) {
    return this.service.deletePerfil(cuil);
  }
}
