import { Module } from '@nestjs/common';
import { EmpleadosService } from './empleados.service';
import { EmpleadosController } from './empleados.controller';

@Module({
  providers: [EmpleadosService],
  controllers: [EmpleadosController],
  exports: [EmpleadosService],
})
export class EmpleadosModule {}
