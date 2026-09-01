import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccesosService } from './accesos.service';
import { IncidenciaService } from './incidencia.service';
import { AnaliticaService } from './analitica.service';
import { ResumenService } from './resumen.service';
import { UpsertAccesoDto } from './dto/upsert-acceso.dto';
import { filtrosDesdeQuery } from './filtros-analitica';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('certificaciones')
export class CertificacionesController {
  constructor(
    private readonly service: AccesosService,
    private readonly incidenciaService: IncidenciaService,
    private readonly analiticaService: AnaliticaService,
    private readonly resumenService: ResumenService,
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
}
