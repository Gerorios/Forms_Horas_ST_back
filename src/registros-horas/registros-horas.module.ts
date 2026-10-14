import { Module } from '@nestjs/common';
import { RegistrosHorasService } from './registros-horas.service';
import { RegistrosHorasController } from './registros-horas.controller';
import { ExportDetalleService } from './export-detalle.service';
import { EmpleadosModule } from '../empleados/empleados.module';

@Module({
  imports: [EmpleadosModule],
  providers: [RegistrosHorasService, ExportDetalleService],
  controllers: [RegistrosHorasController],
})
export class RegistrosHorasModule {}
