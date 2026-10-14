import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Request, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
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
import { parseIds, parseLista } from '../common/quincena';
import { PanelQueryDto } from './dto/panel-query.dto';
import { resolverPeriodo } from './periodo-panel';
import { ExportDetalleService } from './export-detalle.service';

/** Filtros del panel desde la query (listas separadas por coma). */
function filtrosDe(q: PanelQueryDto) {
  return {
    contratoIds: parseIds(q.contratoIds),
    provinciaIds: parseIds(q.provinciaIds),
    tareaIds: parseIds(q.tareaIds),
    operarioCuils: parseLista(q.operarioCuils),
  };
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('registros-horas')
export class RegistrosHorasController {
  constructor(
    private service: RegistrosHorasService,
    private exportDetalle: ExportDetalleService,
  ) {}

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
    @Request() req,
    @Query('fecha') fecha?: string,
    @Query('contratoId', new ParseIntPipe({ optional: true })) contratoId?: number,
    @Query('estado') estado?: string,
    @Query('operarioCuil') operarioCuil?: string,
    @Query('cargadoPorCuil') cargadoPorCuil?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.service.findAll(
      { fecha, contratoId, estado, operarioCuil, cargadoPorCuil, desde, hasta },
      { cuil: req.user.cuil, rol: req.user.rol },
    );
  }

  @Get('por-aprobar')
  @Roles('JefeContrato', 'Admin')
  porAprobar(
    @Query('estado') estado: string | undefined,
    @Query('contratoId', new ParseIntPipe({ optional: true })) contratoId: number | undefined,
    @Query('operarioCuil') operarioCuil: string | undefined,
    @Query('cargadoPorCuil') cargadoPorCuil: string | undefined,
    @Query('fecha') fecha: string | undefined,
    @Query('desde') desde: string | undefined,
    @Query('hasta') hasta: string | undefined,
    @Request() req,
  ) {
    return this.service.porAprobar({ cuil: req.user.cuil, rol: req.user.rol }, estado, {
      contratoId,
      operarioCuil,
      cargadoPorCuil,
      fecha,
      desde,
      hasta,
    });
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

  @Get('mis-contratos')
  @Roles('JefeContrato', 'Admin')
  misContratos(@Request() req) {
    return this.service.misContratos({ cuil: req.user.cuil, rol: req.user.rol });
  }

  @Get('mis-tareas')
  @Roles('JefeContrato', 'Admin')
  misTareas(@Request() req) {
    return this.service.misTareas({ cuil: req.user.cuil, rol: req.user.rol });
  }

  @Get('resumen-operarios')
  @Roles('JefeContrato', 'Admin')
  resumenOperarios(@Query() q: PanelQueryDto, @Request() req) {
    // Ignora el filtro de operario: el resumen se filtra por operario en el
    // cliente, porque su lista completa alimenta el selector de operarios.
    return this.service.resumenOperarios({ cuil: req.user.cuil, rol: req.user.rol }, resolverPeriodo(q), filtrosDe(q));
  }

  @Get('historico-quincenas')
  @Roles('JefeContrato', 'Admin')
  historicoQuincenas(@Query() q: PanelQueryDto, @Request() req) {
    return this.service.historicoQuincenas({ cuil: req.user.cuil, rol: req.user.rol }, resolverPeriodo(q), filtrosDe(q));
  }

  @Get('detalle-diario')
  @Roles('JefeContrato', 'Admin')
  detalleDiario(@Query() q: PanelQueryDto, @Request() req) {
    return this.service.detalleDiario({ cuil: req.user.cuil, rol: req.user.rol }, resolverPeriodo(q), filtrosDe(q));
  }

  /** Excel del Detalle diario: solo las filas que cumplen los filtros, en mis
   * contratos (ADR-030). */
  @Get('detalle-diario/excel')
  @Roles('JefeContrato', 'Admin')
  async detalleDiarioExcel(@Query() q: PanelQueryDto, @Request() req, @Res() res: Response) {
    const { buffer, filename } = await this.exportDetalle.generar(
      { cuil: req.user.cuil, rol: req.user.rol },
      resolverPeriodo(q),
      filtrosDe(q),
    );
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }

  @Get('control-diario')
  @Roles('JefeContrato', 'Admin')
  controlDiario(@Query() q: PanelQueryDto, @Request() req) {
    return this.service.controlDiario({ cuil: req.user.cuil, rol: req.user.rol }, resolverPeriodo(q), filtrosDe(q));
  }

  @Get('sin-carga')
  @Roles('JefeContrato', 'Admin')
  sinCarga(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('quincena', ParseIntPipe) quincena: number,
  ) {
    return this.service.sinCarga(anio, mes, quincena);
  }
}
