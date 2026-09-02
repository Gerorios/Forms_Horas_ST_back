import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AccesosService } from './accesos.service';
import { IncidenciaService } from './incidencia.service';
import { AnaliticaService } from './analitica.service';
import { ResumenService } from './resumen.service';
import { ItemsService } from './items.service';
import { CargaService } from './carga/carga.service';
import { HistorialService } from './carga/historial.service';
import { elegirTipoArchivo } from './carga/extension';
import { UpsertAccesoDto } from './dto/upsert-acceso.dto';
import { CrearItemDto, ActualizarItemDto } from './dto/item.dto';
import { PreviewCargaDto, ConfirmarCargaDto } from './dto/carga.dto';
import { filtrosDesdeQuery } from './filtros-analitica';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const MAX_ARCHIVO_CARGA_BYTES = 20 * 1024 * 1024;

@Controller('certificaciones')
export class CertificacionesController {
  constructor(
    private readonly service: AccesosService,
    private readonly incidenciaService: IncidenciaService,
    private readonly analiticaService: AnaliticaService,
    private readonly resumenService: ResumenService,
    private readonly itemsService: ItemsService,
    private readonly cargaService: CargaService,
    private readonly historialService: HistorialService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin')
  @Get('accesos')
  listar() {
    return this.service.listar();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin')
  @Put('accesos/:cuil')
  upsert(@Param('cuil') cuil: string, @Body() dto: UpsertAccesoDto) {
    return this.service.upsert(cuil, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin')
  @Delete('accesos/:cuil')
  eliminar(@Param('cuil') cuil: string) {
    return this.service.eliminar(cuil);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('incidencia-mo')
  incidenciaMo(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Req() req: any,
  ) {
    return this.incidenciaService.obtenerIncidencia(anio, mes, req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('incidencia-mo/serie')
  incidenciaMoSerie(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('meses', new DefaultValuePipe(12), ParseIntPipe) meses: number,
    @Req() req: any,
  ) {
    return this.incidenciaService.obtenerSerie(anio, mes, meses, req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('analytics/evolucion-mensual')
  evolucionMensual(@Query() q: Record<string, unknown>, @Req() req: any) {
    return this.analiticaService.evolucionMensual(filtrosDesdeQuery(q), req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('analytics/por-contrato-mes')
  porContratoMes(@Query() q: Record<string, unknown>, @Req() req: any) {
    return this.analiticaService.porContratoMes(filtrosDesdeQuery(q), req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('analytics/por-provincia')
  porProvincia(@Query() q: Record<string, unknown>, @Req() req: any) {
    return this.analiticaService.porProvincia(filtrosDesdeQuery(q), req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('analytics/top-items')
  topItems(@Query() q: Record<string, unknown>, @Req() req: any) {
    const n = parseInt(String(q.limite ?? ''), 10);
    const limite = Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 10;
    return this.analiticaService.topItems(filtrosDesdeQuery(q), req.user?.cert ?? null, limite);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('analytics/interanual')
  interanual(@Query() q: Record<string, unknown>, @Req() req: any) {
    return this.analiticaService.interanual(filtrosDesdeQuery(q), req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('analytics/contratos')
  contratos(@Req() req: any) {
    return this.analiticaService.contratos(req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('analytics/provincias')
  provincias(@Req() req: any) {
    return this.analiticaService.provincias(req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('analytics/estado-cargas')
  estadoCargas(@Req() req: any) {
    return this.analiticaService.estadoCargas(req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('resumen')
  resumen(@Req() req: any) {
    return this.resumenService.resumen(req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización por claim `cert` vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('analytics/presupuesto')
  presupuesto(@Req() req: any) {
    return this.resumenService.presupuesto(req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización (solo nivel admin) vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('items')
  listarItems(@Query() q: Record<string, unknown>, @Req() req: any) {
    return this.itemsService.listar(
      {
        codigoK: q.codigo_k ? String(q.codigo_k) : undefined,
        buscar: q.buscar ? String(q.buscar) : undefined,
      },
      req.user?.cert ?? null,
    );
  }

  // Sin @Roles: la autorización (solo nivel admin) vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Post('items')
  crearItem(@Body() dto: CrearItemDto, @Req() req: any) {
    return this.itemsService.crear(dto, req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización (solo nivel admin) vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Patch('items/:id')
  actualizarItem(@Param('id', ParseIntPipe) id: number, @Body() dto: ActualizarItemDto, @Req() req: any) {
    return this.itemsService.actualizar(id, dto, req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización (solo nivel admin) vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Delete('items/:id')
  eliminarItem(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.itemsService.eliminar(id, req.user?.cert ?? null);
  }

  // Sin @Roles: la autorización (niveles admin/carga) vive dentro del
  // service. El límite de 20MB lo aplica multer; si se excede, el
  // MulterExceptionFilter global (main.ts) lo traduce a un 4xx legible en
  // vez del 500 pelado por defecto.
  @UseGuards(JwtAuthGuard)
  @Post('carga/preview')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX_ARCHIVO_CARGA_BYTES } }))
  previewCarga(
    @UploadedFile() archivo: Express.Multer.File | undefined,
    @Body() dto: PreviewCargaDto,
    @Req() req: any,
  ) {
    if (!archivo) throw new BadRequestException('Adjuntá un archivo.');
    const tipoArchivo = elegirTipoArchivo(archivo.originalname);
    return this.cargaService.preview(
      archivo.buffer,
      archivo.originalname,
      dto.periodo_anio,
      dto.periodo_mes,
      tipoArchivo,
      req.user?.cert ?? null,
      req.user.cuil,
    );
  }

  // Sin @Roles: la autorización (niveles admin/carga) vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Post('carga/confirmar')
  async confirmarCarga(@Body() dto: ConfirmarCargaDto, @Req() req: any) {
    const nombre = await this.service.resolverNombre(req.user.cuil);
    return this.cargaService.confirmar(dto, req.user?.cert ?? null, req.user.cuil, nombre);
  }

  // Sin @Roles: la visibilidad (todos/propias por nivel) vive dentro del service.
  @UseGuards(JwtAuthGuard)
  @Get('carga/historial')
  historialCarga(@Req() req: any) {
    return this.historialService.listar(req.user?.cert ?? null, req.user.cuil);
  }

  // Sin @Roles: solo nivel admin, verificado dentro del service.
  @UseGuards(JwtAuthGuard)
  @Delete('carga/:logId')
  deshacerCarga(@Param('logId', ParseIntPipe) logId: number, @Req() req: any) {
    return this.historialService.deshacer(logId, req.user?.cert ?? null);
  }
}
