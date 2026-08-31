import { Module } from '@nestjs/common';
import { AccesosService } from './accesos.service';
import { CertificacionesController } from './certificaciones.controller';

@Module({
  providers: [AccesosService],
  controllers: [CertificacionesController],
  exports: [AccesosService],
})
export class CertificacionesModule {}
