import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { EmpleadosService } from './empleados.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('empleados')
export class EmpleadosController {
  constructor(private empleadosService: EmpleadosService) {}

  @Get()
  findAll(@Query('q') q?: string) {
    return this.empleadosService.findActivos(q);
  }

  @Get(':cuil')
  findOne(@Param('cuil') cuil: string) {
    return this.empleadosService.findOne(cuil);
  }
}
