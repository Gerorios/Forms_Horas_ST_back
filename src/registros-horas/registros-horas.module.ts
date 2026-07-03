import { Module } from '@nestjs/common';
import { RegistrosHorasService } from './registros-horas.service';
import { RegistrosHorasController } from './registros-horas.controller';

@Module({
  providers: [RegistrosHorasService],
  controllers: [RegistrosHorasController],
})
export class RegistrosHorasModule {}
