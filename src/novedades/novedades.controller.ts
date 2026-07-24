import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { NovedadesService } from './novedades.service';
import { CreateNovedadDto } from './dto/create-novedad.dto';
import { ResolverNovedadDto } from './dto/resolver-novedad.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('novedades')
export class NovedadesController {
  constructor(private service: NovedadesService) {}

  @Post()
  @Roles('Supervisor', 'JefeContrato', 'JefeCuadrilla', 'Admin')
  create(@Body() dto: CreateNovedadDto, @Request() req) {
    return this.service.create(dto, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Get()
  findAll(
    @Query('operarioCuil') operarioCuil?: string,
    @Query('estadoHys') estadoHys?: string,
  ) {
    return this.service.findAll({ operarioCuil, estadoHys });
  }

  @Patch(':id/resolver-hys')
  @Roles('HyS', 'Admin')
  resolverHys(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolverNovedadDto,
    @Request() req,
  ) {
    return this.service.resolverHys(id, dto, req.user.cuil);
  }
}
