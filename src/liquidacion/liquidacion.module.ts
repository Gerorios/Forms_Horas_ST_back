import { Module } from '@nestjs/common';
import { LiquidacionService } from './liquidacion.service';
import { CalculoService } from './calculo.service';
import { LiquidacionController } from './liquidacion.controller';

@Module({
  providers: [LiquidacionService, CalculoService],
  controllers: [LiquidacionController],
})
export class LiquidacionModule {}
