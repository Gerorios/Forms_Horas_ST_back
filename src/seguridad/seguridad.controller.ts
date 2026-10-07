import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportesService } from './reportes.service';
import { PuntosService } from './puntos.service';
import { PeriodosService } from './periodos.service';
import { Catalogo, CatalogosSeguridadService } from './catalogos-seguridad.service';
import { AnularReporteDto, CalificarReporteDto, FiltrosPanelDto, FotoDto, ReporteDto } from './dto/reporte.dto';
import { CatalogoDto, PeriodoDto, RangoDto } from './dto/config.dto';

/** La foto llega achicada desde el celular (~300 KB); 10 MB es el techo para
 * cuando el navegador no pudo achicarla. */
const MAX_FOTO_BYTES = 10 * 1024 * 1024;
const FOTO_MIMES = new Set(['image/jpeg', 'image/png']);

function catalogoValido(c: string): Catalogo {
  if (c !== 'naturalezas' && c !== 'motivos') throw new BadRequestException('Catálogo inválido');
  return c;
}

/**
 * Autogestión de la Seguridad (ADR-027). Es el primer módulo abierto a
 * TODOS los roles: los endpoints sin @Roles los usa cualquier usuario
 * logueado; el panel, el ranking con nombres y los períodos son de HyS y
 * Admin, y los catálogos, solo de Admin.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('seguridad')
export class SeguridadController {
  constructor(
    private reportes: ReportesService,
    private puntos: PuntosService,
    private periodos: PeriodosService,
    private catalogos: CatalogosSeguridadService,
  ) {}

  private usuario(req: any) {
    return { cuil: req.user.cuil as string, rol: req.user.rol as string };
  }

  // ---------------------------------------------------------- todos

  @Get('catalogos')
  catalogosFormulario() {
    return this.catalogos.paraFormulario();
  }

  @Post('reportes')
  crear(@Body() dto: ReporteDto, @Request() req) {
    return this.reportes.crear(dto, this.usuario(req));
  }

  @Get('reportes/mios')
  mios(@Request() req) {
    return this.reportes.mios(this.usuario(req));
  }

  @Get('mis-puntos')
  async misPuntos(@Query('periodoId') periodoId: string | undefined, @Request() req) {
    const rango = await this.periodos.resolverRango({ periodoId: periodoId ? Number(periodoId) : undefined }, false);
    return this.puntos.misPuntos(req.user.cuil, rango);
  }

  @Get('periodos')
  listarPeriodos() {
    return this.periodos.listar();
  }

  @Get('reportes/:id')
  detalle(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.reportes.detalle(id, this.usuario(req));
  }

  @Patch('reportes/:id')
  editar(@Param('id', ParseIntPipe) id: number, @Body() dto: ReporteDto, @Request() req) {
    return this.reportes.editar(id, dto, this.usuario(req));
  }

  @Patch('reportes/:id/anular')
  anular(@Param('id', ParseIntPipe) id: number, @Body() dto: AnularReporteDto, @Request() req) {
    return this.reportes.anular(id, dto.motivo, this.usuario(req));
  }

  @Post('reportes/:id/fotos')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTES } }))
  agregarFoto(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() foto: Express.Multer.File | undefined,
    @Body() meta: FotoDto,
    @Request() req,
  ) {
    if (!foto) throw new BadRequestException('Falta la foto');
    if (!FOTO_MIMES.has(foto.mimetype)) throw new BadRequestException('La foto debe ser JPEG o PNG');
    return this.reportes.agregarFoto(
      id,
      { buffer: foto.buffer, mimetype: foto.mimetype as 'image/jpeg' | 'image/png' },
      meta,
      this.usuario(req),
    );
  }

  @Get('reportes/:id/fotos/:fotoId')
  async foto(
    @Param('id', ParseIntPipe) id: number,
    @Param('fotoId', ParseIntPipe) fotoId: number,
    @Request() req,
    @Res() res: Response,
  ) {
    const { buffer, mimetype } = await this.reportes.leerFoto(id, fotoId, this.usuario(req));
    res.setHeader('Content-Type', mimetype);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }

  @Delete('reportes/:id/fotos/:fotoId')
  quitarFoto(@Param('id', ParseIntPipe) id: number, @Param('fotoId', ParseIntPipe) fotoId: number, @Request() req) {
    return this.reportes.quitarFoto(id, fotoId, this.usuario(req));
  }

  // ------------------------------------------------------- HyS y Admin

  @Get('panel')
  @Roles('HyS', 'Admin')
  panel(@Query() filtros: FiltrosPanelDto) {
    return this.reportes.panel(filtros);
  }

  @Patch('reportes/:id/calificar')
  @Roles('HyS', 'Admin')
  calificar(@Param('id', ParseIntPipe) id: number, @Body() dto: CalificarReporteDto, @Request() req) {
    return this.reportes.calificar(id, dto, this.usuario(req));
  }

  @Patch('reportes/:id/reabrir')
  @Roles('HyS', 'Admin')
  reabrir(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.reportes.reabrir(id, this.usuario(req));
  }

  @Get('ranking')
  @Roles('HyS', 'Admin')
  async ranking(@Query() q: RangoDto) {
    return this.puntos.ranking(await this.periodos.resolverRango(q, true));
  }

  @Get('tableros')
  @Roles('HyS', 'Admin')
  async tableros(@Query() q: RangoDto) {
    return this.puntos.tableros(await this.periodos.resolverRango(q, true));
  }

  @Post('periodos')
  @Roles('HyS', 'Admin')
  crearPeriodo(@Body() dto: PeriodoDto, @Request() req) {
    return this.periodos.crear(dto, req.user.cuil);
  }

  @Patch('periodos/:id')
  @Roles('HyS', 'Admin')
  editarPeriodo(@Param('id', ParseIntPipe) id: number, @Body() dto: PeriodoDto) {
    return this.periodos.editar(id, dto);
  }

  @Delete('periodos/:id')
  @Roles('HyS', 'Admin')
  borrarPeriodo(@Param('id', ParseIntPipe) id: number) {
    return this.periodos.borrar(id);
  }

  // ------------------------------------------------------------- Admin

  @Get('admin/:catalogo')
  @Roles('Admin')
  listarCatalogo(@Param('catalogo') catalogo: string) {
    return this.catalogos.listar(catalogoValido(catalogo));
  }

  @Post('admin/:catalogo')
  @Roles('Admin')
  crearEnCatalogo(@Param('catalogo') catalogo: string, @Body() dto: CatalogoDto) {
    return this.catalogos.crear(catalogoValido(catalogo), dto);
  }

  @Patch('admin/:catalogo/:id')
  @Roles('Admin')
  editarEnCatalogo(@Param('catalogo') catalogo: string, @Param('id', ParseIntPipe) id: number, @Body() dto: CatalogoDto) {
    return this.catalogos.editar(catalogoValido(catalogo), id, dto);
  }
}
