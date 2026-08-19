import {
  BadRequestException,
  Body,
  Controller,
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
import { NovedadesService } from './novedades.service';
import { CreateNovedadDto } from './dto/create-novedad.dto';
import { UpdateNovedadDto } from './dto/update-novedad.dto';
import { ResolverNovedadDto } from './dto/resolver-novedad.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;
const ADJUNTO_MIMES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

function validarAdjunto(adjunto: Express.Multer.File | undefined) {
  if (adjunto && !ADJUNTO_MIMES.has(adjunto.mimetype)) {
    throw new BadRequestException('El adjunto debe ser JPEG, PNG o PDF');
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('novedades')
export class NovedadesController {
  constructor(private service: NovedadesService) {}

  @Post()
  @Roles('Supervisor', 'JefeContrato', 'JefeCuadrilla', 'Admin')
  @UseInterceptors(FileInterceptor('adjunto', { limits: { fileSize: MAX_ADJUNTO_BYTES } }))
  create(
    @UploadedFile() adjunto: Express.Multer.File | undefined,
    @Body() dto: CreateNovedadDto,
    @Request() req,
  ) {
    validarAdjunto(adjunto);
    return this.service.create(
      dto,
      adjunto && { buffer: adjunto.buffer, mimetype: adjunto.mimetype as 'image/jpeg' | 'image/png' | 'application/pdf' },
      { cuil: req.user.cuil, rol: req.user.rol },
    );
  }

  @Get()
  @Roles('HyS', 'JefeContrato', 'Supervisor', 'Liquidador', 'Admin', 'JefeCuadrilla')
  findAll(
    @Query('operarioCuil') operarioCuil: string | undefined,
    @Query('estadoHys') estadoHys: string | undefined,
    @Query('anio') anio: string | undefined,
    @Query('mes') mes: string | undefined,
    @Query('quincena') quincena: string | undefined,
    @Request() req,
  ) {
    const periodo =
      anio && mes && quincena
        ? { anio: Number(anio), mes: Number(mes), quincena: Number(quincena) }
        : undefined;
    return this.service.findAll(
      { operarioCuil, estadoHys, periodo },
      { cuil: req.user.cuil, rol: req.user.rol },
    );
  }

  @Get('resumen-ausencias')
  @Roles('HyS', 'Admin')
  resumenAusencias(
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('quincena', ParseIntPipe) quincena: number,
  ) {
    return this.service.resumenAusencias(anio, mes, quincena);
  }

  @Get(':id/adjunto')
  @Roles('HyS', 'JefeContrato', 'Supervisor', 'Liquidador', 'Admin', 'JefeCuadrilla')
  async adjunto(@Param('id', ParseIntPipe) id: number, @Request() req, @Res() res: Response) {
    const { buffer, mimetype } = await this.service.obtenerAdjunto(id, {
      cuil: req.user.cuil,
      rol: req.user.rol,
    });
    res.setHeader('Content-Type', mimetype);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }

  @Patch(':id')
  @Roles('Admin')
  @UseInterceptors(FileInterceptor('adjunto', { limits: { fileSize: MAX_ADJUNTO_BYTES } }))
  update(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() adjunto: Express.Multer.File | undefined,
    @Body() dto: UpdateNovedadDto,
    @Request() req,
  ) {
    validarAdjunto(adjunto);
    return this.service.update(
      id,
      dto,
      adjunto && { buffer: adjunto.buffer, mimetype: adjunto.mimetype as 'image/jpeg' | 'image/png' | 'application/pdf' },
      { cuil: req.user.cuil, rol: req.user.rol },
    );
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

  @Patch(':id/reabrir')
  @Roles('HyS', 'Admin')
  reabrir(@Param('id', ParseIntPipe) id: number, @Request() req) {
    return this.service.reabrir(id, { cuil: req.user.cuil, rol: req.user.rol });
  }
}
