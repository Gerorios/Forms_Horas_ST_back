import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { RegistrosHorasService } from './registros-horas.service';
import { CreateRegistroHorasDto } from './dto/create-registro-horas.dto';
import { CreateRegistroBatchDto } from './dto/create-registro-batch.dto';
import { UpdateRegistroHorasDto } from './dto/update-registro-horas.dto';
import { ResolverRegistroDto } from './dto/resolver-registro.dto';
import { ResolverLoteDto } from './dto/resolver-lote.dto';
import { CorregirLoteDto } from './dto/corregir-lote.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('registros-horas')
export class RegistrosHorasController {
  constructor(private service: RegistrosHorasService) {}

  @Post()
  @Roles('JefeCuadrilla', 'JefeContrato', 'Admin')
  create(@Body() dto: CreateRegistroHorasDto, @Request() req) {
    return this.service.create(dto, req.user.cuil);
  }

  @Post('batch')
  @Roles('JefeCuadrilla', 'JefeContrato', 'Admin')
  createBatch(@Body() dto: CreateRegistroBatchDto, @Request() req) {
    return this.service.createBatch(dto, req.user.cuil);
  }

  @Get()
  findAll(
    @Query('fecha') fecha?: string,
    @Query('contratoId', new ParseIntPipe({ optional: true })) contratoId?: number,
    @Query('estado') estado?: string,
    @Query('operarioCuil') operarioCuil?: string,
    @Query('cargadoPorCuil') cargadoPorCuil?: string,
  ) {
    return this.service.findAll({ fecha, contratoId, estado, operarioCuil, cargadoPorCuil });
  }

  @Get('por-aprobar')
  @Roles('JefeContrato', 'Admin')
  porAprobar(@Query('estado') estado: string | undefined, @Request() req) {
    return this.service.porAprobar({ cuil: req.user.cuil, rol: req.user.rol }, estado);
  }

  @Patch(':id')
  @Roles('JefeCuadrilla', 'JefeContrato', 'Admin')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRegistroHorasDto,
    @Request() req,
  ) {
    return this.service.update(id, dto, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Patch(':id/resolver')
  @Roles('JefeContrato', 'Admin')
  resolver(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolverRegistroDto,
    @Request() req,
  ) {
    return this.service.resolver(id, dto, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Patch('lote/:loteId/resolver')
  @Roles('JefeContrato', 'Admin')
  resolverLote(
    @Param('loteId') loteId: string,
    @Body() dto: ResolverLoteDto,
    @Request() req,
  ) {
    return this.service.resolverLote(loteId, dto, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Patch('lote/:loteId/corregir')
  @Roles('JefeContrato', 'Admin')
  corregirLote(
    @Param('loteId') loteId: string,
    @Body() dto: CorregirLoteDto,
    @Request() req,
  ) {
    return this.service.corregirLote(loteId, dto, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Patch(':id/reabrir')
  @Roles('JefeContrato', 'Admin')
  reabrir(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.reabrir(id, { cuil: req.user.cuil, rol: req.user.rol });
  }
}
