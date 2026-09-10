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
import { NovedadesService } from './novedades.service';
import { CreateNovedadDto } from './dto/create-novedad.dto';
import { UpdateNovedadDto } from './dto/update-novedad.dto';
import { ResolverNovedadDto } from './dto/resolver-novedad.dto';
import { AnularNovedadDto } from './dto/anular-novedad.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;
const ADJUNTO_MIMES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

type MimeAdjunto = 'image/jpeg' | 'image/png' | 'application/pdf';

function validarAdjunto(adjunto: Express.Multer.File | undefined) {
  if (adjunto && !ADJUNTO_MIMES.has(adjunto.mimetype)) {
    throw new BadRequestException('El adjunto debe ser JPEG, PNG o PDF');
  }
}

/** Roles que pueden tocar los certificados de una novedad. Espejo del alcance
 * de lectura: los mismos que ven el listado, con el recorte del JefeCuadrilla
 * (solo lo que cargó él) aplicado en el service. */
const ROLES_ADJUNTOS = ['HyS', 'JefeContrato', 'Supervisor', 'Admin', 'JefeCuadrilla'] as const;

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
    @Query('estado') estado: string | undefined,
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
      { operarioCuil, estadoHys, estado, periodo },
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

  @Get(':id/adjuntos/:adjuntoId')
  @Roles('HyS', 'JefeContrato', 'Supervisor', 'Liquidador', 'Admin', 'JefeCuadrilla')
  async adjunto(
    @Param('id', ParseIntPipe) id: number,
    @Param('adjuntoId', ParseIntPipe) adjuntoId: number,
    @Request() req,
    @Res() res: Response,
  ) {
    const { buffer, mimetype } = await this.service.obtenerAdjunto(id, adjuntoId, {
      cuil: req.user.cuil,
      rol: req.user.rol,
    });
    res.setHeader('Content-Type', mimetype);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }

  /** Agrega un certificado a una novedad ya cargada. Sube SOLO el archivo: no
   * es el editor de la novedad y no cambia el estado de HyS. */
  @Patch(':id/adjunto')
  @Roles(...ROLES_ADJUNTOS)
  @UseInterceptors(FileInterceptor('adjunto', { limits: { fileSize: MAX_ADJUNTO_BYTES } }))
  agregarAdjunto(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() adjunto: Express.Multer.File | undefined,
    @Request() req,
  ) {
    if (!adjunto) throw new BadRequestException('Falta el archivo del certificado');
    validarAdjunto(adjunto);
    return this.service.agregarAdjunto(
      id,
      { buffer: adjunto.buffer, mimetype: adjunto.mimetype as MimeAdjunto },
      { cuil: req.user.cuil, rol: req.user.rol },
    );
  }

  /** Baja lógica del certificado (el archivo se conserva). `?definitivo=true`
   * borra además el archivo del disco y es solo del Admin. */
  @Delete(':id/adjuntos/:adjuntoId')
  @Roles(...ROLES_ADJUNTOS)
  quitarAdjunto(
    @Param('id', ParseIntPipe) id: number,
    @Param('adjuntoId', ParseIntPipe) adjuntoId: number,
    @Query('definitivo') definitivo: string | undefined,
    @Request() req,
  ) {
    return this.service.quitarAdjunto(
      id,
      adjuntoId,
      { cuil: req.user.cuil, rol: req.user.rol },
      definitivo === 'true',
    );
  }

  @Patch(':id')
  @Roles('HyS', 'Admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateNovedadDto, @Request() req) {
    return this.service.update(id, dto, { cuil: req.user.cuil, rol: req.user.rol });
  }

  @Patch(':id/anular')
  @Roles('HyS', 'Admin')
  anular(@Param('id', ParseIntPipe) id: number, @Body() dto: AnularNovedadDto, @Request() req) {
    return this.service.anular(id, dto.motivo, { cuil: req.user.cuil, rol: req.user.rol });
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
