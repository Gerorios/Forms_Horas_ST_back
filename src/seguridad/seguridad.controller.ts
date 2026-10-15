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
import { Modulo, ModuloGuard } from '../lanzamientos/modulo.guard';
import { ReportesService } from './reportes.service';
import { PuntosService } from './puntos.service';
import { InspectoresService } from './inspectores.service';
import { Catalogo, CatalogosSeguridadService } from './catalogos-seguridad.service';
import { AnularReporteDto, CalificarReporteDto, FiltrosPanelDto, FotoDto, ReporteDto } from './dto/reporte.dto';
import { CatalogoDto, InspectorDto, RangoDto } from './dto/config.dto';
import { hoyAr, rangoConsulta } from './reglas';

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
 * logueado; el panel, el ranking con nombres y los inspectores son de HyS y
 * Admin, y los catálogos, solo de Admin. Puntos, ranking y tableros se
 * consultan por rango de fechas (por defecto, el año en curso).
 */
// Lanzamiento (ADR-028): mientras esté interno, solo lo ven Admin y el piloto.
@UseGuards(JwtAuthGuard, RolesGuard, ModuloGuard)
@Modulo('seguridad')
@Controller('seguridad')
export class SeguridadController {
  constructor(
    private reportes: ReportesService,
    private puntos: PuntosService,
    private inspectores: InspectoresService,
    private catalogos: CatalogosSeguridadService,
  ) {}

  private usuario(req: any) {
    return { cuil: req.user.cuil as string, rol: req.user.rol as string };
  }

  // ---------------------------------------------------------- todos

  /** Catálogos del formulario, más si este usuario puede cargar inspecciones. */
  @Get('catalogos')
  async catalogosFormulario(@Request() req) {
    const u = this.usuario(req);
    return {
      ...(await this.catalogos.paraFormulario()),
      puedeInspeccionar: u.rol === 'HyS' || (await this.reportes.esInspector(u.cuil)),
    };
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
  misPuntos(@Query() q: RangoDto, @Request() req) {
    return this.puntos.misPuntos(req.user.cuil, rangoConsulta(q.desde, q.hasta, hoyAr()));
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
  ranking(@Query() q: RangoDto) {
    return this.puntos.ranking(rangoConsulta(q.desde, q.hasta, hoyAr()));
  }

  @Get('tableros')
  @Roles('HyS', 'Admin')
  tableros(@Query() q: RangoDto) {
    return this.puntos.tableros(rangoConsulta(q.desde, q.hasta, hoyAr()));
  }

  /** Mapa de reportes: un punto por reporte del rango con ubicación. */
  @Get('mapa')
  @Roles('HyS', 'Admin')
  mapa(@Query() q: RangoDto) {
    return this.puntos.mapa(rangoConsulta(q.desde, q.hasta, hoyAr()));
  }

  /** HyS corrige un reporte ajeno (tipo, clasificación, texto), en cualquier
   * estado salvo anulado; si estaba aprobado, se recalculan los puntos. */
  @Patch('reportes/:id/corregir')
  @Roles('HyS', 'Admin')
  corregir(@Param('id', ParseIntPipe) id: number, @Body() dto: ReporteDto, @Request() req) {
    return this.reportes.corregir(id, dto, this.usuario(req));
  }

  @Get('inspectores')
  @Roles('HyS', 'Admin')
  listarInspectores() {
    return this.inspectores.listar();
  }

  @Post('inspectores')
  @Roles('HyS', 'Admin')
  habilitarInspector(@Body() dto: InspectorDto, @Request() req) {
    return this.inspectores.habilitar(dto.cuil, req.user.cuil);
  }

  @Delete('inspectores/:cuil')
  @Roles('HyS', 'Admin')
  deshabilitarInspector(@Param('cuil') cuil: string) {
    return this.inspectores.deshabilitar(cuil);
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
