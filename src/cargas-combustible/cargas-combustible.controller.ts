import { Body, Controller, Get, ParseIntPipe, Post, Query, Request, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CargasCombustibleService } from './cargas-combustible.service';
import { CreateCargaCombustibleDto } from './dto/create-carga-combustible.dto';

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
}
