import { Body, Controller, Delete, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AccesosService } from './accesos.service';
import { IncidenciaService } from './incidencia.service';
import { UpsertAccesoDto } from './dto/upsert-acceso.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('certificaciones')
export class CertificacionesController {
  constructor(
    private readonly service: AccesosService,
    private readonly incidenciaService: IncidenciaService,
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
  incidenciaMo(@Query('anio') anio: string, @Query('mes') mes: string, @Req() req: any) {
    return this.incidenciaService.obtenerIncidencia(Number(anio), Number(mes), req.user?.cert ?? null);
  }
}
