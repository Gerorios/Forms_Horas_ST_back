import { Module } from '@nestjs/common';
import { AccesosService } from './accesos.service';
import { IncidenciaService } from './incidencia.service';
import { AnaliticaService } from './analitica.service';
import { ResumenService } from './resumen.service';
import { ItemsService } from './items.service';
import { ResolucionService } from './carga/resolucion.service';
import { PreviewStore } from './carga/preview-store';
import { CargaService } from './carga/carga.service';
import { HistorialService } from './carga/historial.service';
import { CertificacionesController } from './certificaciones.controller';
import { LiquidacionModule } from '../liquidacion/liquidacion.module';

@Module({
  imports: [LiquidacionModule],
  providers: [
    AccesosService,
    IncidenciaService,
    AnaliticaService,
    ResumenService,
    ItemsService,
    ResolucionService,
    PreviewStore,
    CargaService,
    HistorialService,
  ],
  controllers: [CertificacionesController],
  exports: [AccesosService, CargaService, HistorialService],
})
export class CertificacionesModule {}
