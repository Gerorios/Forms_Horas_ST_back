import { Module } from '@nestjs/common';
import { RegistrosHorasService } from './registros-horas.service';
import { RegistrosHorasController } from './registros-horas.controller';
import { EmpleadosModule } from '../empleados/empleados.module';

@Module({
  imports: [EmpleadosModule],
  providers: [RegistrosHorasService],
  controllers: [RegistrosHorasController],
})
export class RegistrosHorasModule {}
