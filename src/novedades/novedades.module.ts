import { Module } from '@nestjs/common';
import { NovedadesService } from './novedades.service';
import { NovedadesController } from './novedades.controller';

@Module({
  providers: [NovedadesService],
  controllers: [NovedadesController],
})
export class NovedadesModule {}
