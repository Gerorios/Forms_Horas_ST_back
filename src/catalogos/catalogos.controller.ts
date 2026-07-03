import { Controller, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { CatalogosService } from './catalogos.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('catalogos')
export class CatalogosController {
  constructor(private service: CatalogosService) {}

  @Get('tareas')
  getTareas(@Query('contratoId', ParseIntPipe) contratoId: number) {
    return this.service.getTareas(contratoId);
  }

  @Get('provincias')
  getProvincias() {
    return this.service.getProvincias();
  }

  @Get('moviles')
  getMoviles() {
    return this.service.getMoviles();
  }

  @Get('tipos-novedad')
  getTiposNovedad() {
    return this.service.getTiposNovedad();
  }
}
