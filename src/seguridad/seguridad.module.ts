import { Module } from '@nestjs/common';
import { SeguridadController } from './seguridad.controller';
import { ReportesService, SEG_FOTO_STORAGE } from './reportes.service';
import { PuntosService } from './puntos.service';
import { InspectoresService } from './inspectores.service';
import { CatalogosSeguridadService } from './catalogos-seguridad.service';
import { FsNovedadAdjuntoStorage } from '../novedades/storage/fs-novedad-adjunto-storage.service';

@Module({
  providers: [
    ReportesService,
    PuntosService,
    InspectoresService,
    CatalogosSeguridadService,
    {
      provide: SEG_FOTO_STORAGE,
      useFactory: () => new FsNovedadAdjuntoStorage(process.env.SEGURIDAD_FOTOS_DIR ?? './storage/seguridad'),
    },
  ],
  controllers: [SeguridadController],
})
export class SeguridadModule {}
