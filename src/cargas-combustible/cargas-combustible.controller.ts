import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Request, Res, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CargasCombustibleService } from './cargas-combustible.service';
import { CreateCargaCombustibleDto } from './dto/create-carga-combustible.dto';
import { UpdateCargaCombustibleDto } from './dto/update-carga-combustible.dto';
import { AnularCargaDto } from './dto/anular-carga.dto';
import { FiltroCargasDto } from './dto/filtro-cargas.dto';

const MAX_FOTO_BYTES = 5 * 1024 * 1024;

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cargas-combustible')
export class CargasCombustibleController {
  constructor(private readonly service: CargasCombustibleService) {}

  @Post()
  @Roles('JefeCuadrilla', 'Admin')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTES } }))
  crear(@UploadedFile() foto: Express.Multer.File | undefined, @Body() dto: CreateCargaCombustibleDto, @Request() req) {
    if (!foto) throw new BadRequestException('La foto del ticket es obligatoria');
    return this.service.crear(dto, { buffer: foto.buffer, mimetype: foto.mimetype }, req.user.cuil);
  }

  @Get('ultimo-km')
  @Roles('JefeCuadrilla', 'Admin')
  ultimoKm(@Query('movilId', ParseIntPipe) movilId: number) {
    return this.service.ultimoKm(movilId);
  }

  @Get()
  @Roles('JefeCuadrilla', 'JefeContrato', 'Admin')
  listar(@Query() filtro: FiltroCargasDto, @Request() req) {
    return this.service.listar(filtro, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Get(':id')
  @Roles('JefeCuadrilla', 'JefeContrato', 'Admin')
  detalle(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.detalle(id, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Get(':id/ticket')
  @Roles('JefeCuadrilla', 'JefeContrato', 'Admin')
  async ticket(@Param('id', ParseIntPipe) id: number, @Request() req, @Res() res: Response) {
    const { buffer, mimetype } = await this.service.ticket(id, { cuil: req.user.cuil, rol: req.user.rol });
    res.setHeader('Content-Type', mimetype);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }

  @Patch(':id')
  @Roles('JefeCuadrilla', 'Admin')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTES } }))
  editar(@Param('id', ParseIntPipe) id: number, @UploadedFile() foto: Express.Multer.File | undefined, @Body() dto: UpdateCargaCombustibleDto, @Request() req) {
    return this.service.editar(id, dto, foto && { buffer: foto.buffer, mimetype: foto.mimetype }, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Patch(':id/anular')
  @Roles('JefeCuadrilla', 'Admin')
  anular(@Param('id', ParseIntPipe) id: number, @Body() dto: AnularCargaDto, @Request() req) {
    return this.service.anular(id, dto.motivo, { cuil: req.user.cuil, rol: req.user.rol });
  }
}
