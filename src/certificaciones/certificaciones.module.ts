import { Module } from '@nestjs/common';
import { AccesosService } from './accesos.service';
import { IncidenciaService } from './incidencia.service';
import { AnaliticaService } from './analitica.service';
import { ResumenService } from './resumen.service';
import { CertificacionesController } from './certificaciones.controller';
import { LiquidacionModule } from '../liquidacion/liquidacion.module';

@Module({
  imports: [LiquidacionModule],
  providers: [AccesosService, IncidenciaService, AnaliticaService, ResumenService],
  controllers: [CertificacionesController],
  exports: [AccesosService],
})
export class CertificacionesModule {}
