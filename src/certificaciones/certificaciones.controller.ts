import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AccesosService } from './accesos.service';
import { UpsertAccesoDto } from './dto/upsert-acceso.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin')
@Controller('certificaciones')
export class CertificacionesController {
  constructor(private readonly service: AccesosService) {}

  @Get('accesos')
  listar() {
    return this.service.listar();
  }

  @Put('accesos/:cuil')
  upsert(@Param('cuil') cuil: string, @Body() dto: UpsertAccesoDto) {
    return this.service.upsert(cuil, dto);
  }

  @Delete('accesos/:cuil')
  eliminar(@Param('cuil') cuil: string) {
    return this.service.eliminar(cuil);
  }
}
