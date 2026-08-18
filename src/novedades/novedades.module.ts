import { Module } from '@nestjs/common';
import { NovedadesService } from './novedades.service';
import { NovedadesController } from './novedades.controller';
import { FsNovedadAdjuntoStorage } from './storage/fs-novedad-adjunto-storage.service';
import { NOVEDAD_ADJUNTO_STORAGE } from './storage/novedad-adjunto-storage.interface';
import { LiquidacionModule } from '../liquidacion/liquidacion.module';

@Module({
  imports: [LiquidacionModule],
  providers: [
    NovedadesService,
    { provide: NOVEDAD_ADJUNTO_STORAGE, useFactory: () => new FsNovedadAdjuntoStorage() },
  ],
  controllers: [NovedadesController],
})
export class NovedadesModule {}
